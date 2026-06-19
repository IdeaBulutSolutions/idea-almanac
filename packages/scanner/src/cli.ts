#!/usr/bin/env node
/**
 * `almanac` CLI. No interactive prompts, no telemetry, no update
 * checks. Repo scans make zero network calls.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { scanRepo } from './adapters/repo.js';
import { scanOrg, OrgUnavailableError } from './adapters/org.js';
import { loadSchedule, scheduleFreshness } from './core/tiering.js';
import { buildReport, renderJson, type Report } from './reporters/json.js';
import { renderHtml } from './reporters/html.js';
import { renderMarkdown } from './reporters/md.js';
import { computeImpact, loadCorpus, renderImpactMarkdown, spanUnion } from './analysis/impact.js';
import {
  assembleBundle,
  collectValidIds,
  generateNarrative,
} from './analysis/impact-narrative.js';
import { configuredProvider, defaultRunModel, isProviderConfigured } from './analysis/llm.js';

const HELP = `almanac — Salesforce API version maintenance scanner (repo scans: zero network calls)

Usage:
  almanac scan [path]              scan an sfdx repo (default: current directory)
  almanac scan --org <alias>       scan a live org via your existing sf CLI session
                                   (omit <alias> to use your default org)
  almanac scan --mode <tier>       run a whole pipeline in one command (see below)
  almanac impact --report <json>   upgrade-impact review from corpus data

Scan options:
  --json <file>     write JSON report   (default: ./almanac-report.json)
  --html <file>     write HTML report   (default: ./almanac-report.html)
  --md <file>       write Markdown report (off by default)
  --mode <tier>     after scanning, also run (cumulative):
                      scan     report only (default)
                      impact   + upgrade-impact (almanac-impact.md + bundle)
                      manager  + manager explanation + effort estimate
                      full     + agent upgrade guide
                      roast    + cheeky org roast (standalone — no impact step)
                    AI steps use ALMANAC_LLM_PROVIDER if set, else write a
                    paste-ready bundle. Honors --target/--corpus/--llm/--no-llm/
                    --lang/--out/--bundle.
  --fail-on <tier>  exit 1 if any item lands in this tier (CI gate),
                    e.g. far-behind | behind | breaks-2027
  --schedule <file> override the built-in retirement-schedule.json
  -h, --help        this help

Impact options:
  --report <json>   almanac-report.json from a scan (required)
  --target <ver>    target API version (default: schedule's current version)
  --corpus <dir>    corpus data dir with v{NN}.yaml files
                    (default: ../corpus/data relative to the scanner package)
  --out <file>      write deterministic Markdown findings (default: ./almanac-impact.md)
  --no-llm          write a self-contained prompt bundle to run in your own
                    assistant instead of calling a model (default when no
                    ALMANAC_LLM_PROVIDER is configured)
  --llm             force the model narrative (needs ALMANAC_LLM_PROVIDER)
  --lang <language> output language for the AI narrative/bundle (default: English)
  --bundle <file>   bundle output path (default: ./almanac-impact-bundle.md)
  --limit <n|all>   how many of the most urgent components the AI reviews.
                    Default: top 50 (reports over 50 are capped unless you say
                    otherwise). Use --limit all for every component; --limit 80
                    for a custom count. The scan report always lists them all.
  -y, --yes         skip the large-review confirmation prompt (for scripts/CI;
                    uses the top-50 default)

  -v, --version     print version
`;

/**
 * Corpus resolution for `impact` (single-repo packaging):
 *   1. ALMANAC_CORPUS_DIR env var
 *   2. corpus-data/ bundled into the published npm package (copied at build)
 *   3. ../corpus/data — monorepo checkout layout
 */
function defaultCorpusDir(): string | null {
  if (process.env.ALMANAC_CORPUS_DIR) return process.env.ALMANAC_CORPUS_DIR;
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..'); // dist/.. or src/..
  const candidates = [
    join(pkgRoot, 'corpus-data'),
    join(pkgRoot, '..', 'corpus', 'data'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const PARSE_CONFIG = {
  allowPositionals: true,
  options: {
    json: { type: 'string' },
    html: { type: 'string' },
    md: { type: 'string' },
    'fail-on': { type: 'string' },
    mode: { type: 'string' },
    schedule: { type: 'string' },
    org: { type: 'string' },
    report: { type: 'string' },
    target: { type: 'string' },
    corpus: { type: 'string' },
    out: { type: 'string' },
    lang: { type: 'string' },
    llm: { type: 'boolean' },
    'no-llm': { type: 'boolean' },
    bundle: { type: 'string' },
    limit: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
} as const;

function scannerVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Progress to stderr (artifacts go to stdout/files, so this never pollutes
 * output). The CLI is otherwise silent during the slow parts — corpus loading
 * and, especially, synchronous model calls — leaving users unsure if it froze.
 */
function progress(msg: string): void {
  process.stderr.write(`→ ${msg}\n`);
}

const sec = (t0: number): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

/** Options consumed by the upgrade-impact step (shared by `impact` and `scan --mode full-impact`). */
interface ImpactOpts {
  schedule?: string;
  target?: string;
  corpus?: string;
  out?: string;
  lang?: string;
  llm?: boolean;
  'no-llm'?: boolean;
  bundle?: string;
  limit?: string;
  yes?: boolean;
}

/** Default AI-review size: review the top-N most urgent components unless told otherwise. */
const DEFAULT_REVIEW = 50;

/**
 * Prepended to every impact/effort artifact and shown once on screen. Almanac's
 * outputs are AI-assisted and corpus-grounded, but the user owns testing and
 * deployment — make that unmissable.
 */
const DISCLAIMER_MD =
  '> ⚠ **Disclaimer.** Almanac\'s impact and effort figures are produced by automated analysis and AI, ' +
  'grounded in the Almanac corpus of Salesforce release notes. **AI can make mistakes** — every AI ' +
  'provider advises double-checking its responses — and corpus coverage is not exhaustive. **Always ' +
  'test and review thoroughly in a non-production environment before deploying any change to ' +
  'production.** Testing and deployment are entirely your responsibility. Idea Bulut Solutions is not ' +
  'liable for any bug, regression, data loss, or disruption introduced into your systems.';

const DISCLAIMER_LINE =
  'Note: these figures are AI-assisted and corpus-grounded — AI can make mistakes. Test and review ' +
  'in a non-production environment before deploying; you are responsible for testing and deployment.';

/** Prepend the disclaimer to a written artifact. */
const withDisclaimer = (body: string): string => `${DISCLAIMER_MD}\n\n${body}`;

/** Read one line from stdin (interactive prompts only; caller guarantees a TTY). */
function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question('', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Decide how many components to send to the model. Returns a positive number to
 * cap the review to the top-N most urgent, `null` for the full set, or
 * `'cancel'` to abort. Default is the top 50; `--limit all` (or a number) and a
 * report already ≤ 50 give the full set. On an interactive terminal a larger
 * report is confirmed (default 50). In CI / piped runs we never block — large
 * reports default to the top 50 rather than silently spending tokens on all.
 */
async function resolveReviewScope(
  values: ImpactOpts,
  count: number,
  useLlm: boolean,
): Promise<number | null | 'cancel'> {
  // Explicit --limit wins. `--limit all|full|0` means the whole report.
  if (values.limit !== undefined) {
    const v = values.limit.trim().toLowerCase();
    if (v === 'all' || v === 'full' || v === '0') return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_REVIEW;
  }
  // Small enough? Review it all.
  if (count <= DEFAULT_REVIEW) return null;
  // Larger, and we're calling a model interactively: confirm, defaulting to 50.
  if (useLlm && values.yes !== true && process.stdin.isTTY) {
    process.stderr.write(
      `\n⚠ This report has ${count} components. By default Almanac reviews the top ${DEFAULT_REVIEW} ` +
        `most urgent to keep tokens and time reasonable.\n` +
        `  • press Enter to review the top ${DEFAULT_REVIEW} (default)\n` +
        `  • type a number for a different count\n` +
        `  • type "all" to review every component (more tokens and time)\n` +
        `  • type c to cancel\n> `,
    );
    const answer = (await readLine()).trim().toLowerCase();
    if (answer === 'c' || answer === 'cancel') return 'cancel';
    if (answer === 'all' || answer === 'full') return null;
    if (answer === '') return DEFAULT_REVIEW;
    const n = Number.parseInt(answer, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_REVIEW;
  }
  // Larger, non-interactive (CI / --yes / no model): default to the top 50, never block.
  return DEFAULT_REVIEW;
}

/**
 * Run the upgrade-impact step against an already-written report on disk.
 * Shared by the `impact` command and `scan --mode full-impact` so the two
 * paths can never drift. Writes the deterministic findings plus either a
 * paste-ready bundle or a model narrative (groundedness-gated), prints a
 * summary, and returns an exit code.
 */
async function runImpact(values: ImpactOpts, cwd: string, reportPath: string, reportLabel: string): Promise<number> {
  let report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
  const schedule = loadSchedule(values.schedule ? resolve(cwd, values.schedule) : undefined);
  const target = Number.parseFloat(values.target ?? schedule.currentApiVersion);
  if (Number.isNaN(target)) {
    process.stderr.write(`Invalid --target: ${values.target}\n`);
    return 2;
  }
  const corpusDir = values.corpus ? resolve(cwd, values.corpus) : defaultCorpusDir();
  if (corpusDir === null || !existsSync(corpusDir)) {
    process.stderr.write(
      'Corpus data not found — pass --corpus <dir> pointing at v{NN}.yaml files, or set ALMANAC_CORPUS_DIR.\n',
    );
    return 2;
  }

  // Large AI review? Confirm scope before spending tokens. --limit also caps a
  // --no-llm bundle. Only affects the review — the scan report already wrote the
  // full inventory.
  const useLlm = values.llm === true || (values['no-llm'] !== true && isProviderConfigured());
  const total = report.components.length;
  const scope = await resolveReviewScope(values, total, useLlm);
  if (scope === 'cancel') {
    process.stderr.write('Cancelled — no AI review run. The scan report is still available.\n');
    return 0;
  }
  if (typeof scope === 'number' && scope < total) {
    report = { ...report, components: report.components.slice(0, scope) };
    progress(
      `Reviewing the top ${scope} most urgent of ${total} components ` +
        `(use --limit all, or answer "all", to review every component).`,
    );
  }
  if (useLlm) progress(DISCLAIMER_LINE);

  progress('Computing upgrade impact — loading corpus slices across the span…');
  const tImpact = Date.now();
  const versions = spanUnion(report.components, target);
  const corpus = loadCorpus(corpusDir, versions);
  const result = computeImpact(report, corpus, target);
  const deterministicMd = renderImpactMarkdown(result, reportLabel);
  const outPath = resolve(cwd, values.out ?? 'almanac-impact.md');
  writeFileSync(outPath, withDisclaimer(deterministicMd));
  progress(`Impact findings written in ${sec(tImpact)}: ${outPath}`);

  // Narrative layer. Assemble a self-contained bundle (prompt + report
  // + corpus slices + the deterministic scaffold). Either write it for the
  // user's own assistant (--no-llm / no provider) or run a model + apply the
  // groundedness gate.
  const promptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'prompts',
    'upgrade-impact-review.md',
  );
  const bundle = assembleBundle({
    promptText: existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '',
    reportJson: JSON.stringify(report, null, 2),
    deterministicMd,
    target,
    language: values.lang,
  });

  const extra: string[] = [];
  if (useLlm) {
    try {
      progress(
        `Generating impact narrative via ${configuredProvider()} — working. This runs quietly and ` +
          `can take a few minutes on a large org; please keep the process running.`,
      );
      const tLlm = Date.now();
      const { markdown, groundedness } = await generateNarrative(
        bundle,
        collectValidIds(corpus),
        defaultRunModel(),
      );
      progress(`Impact narrative done in ${sec(tLlm)} (${groundedness.citedIds.length} citations verified)`);
      const narrativePath = resolve(
        cwd,
        (values.out ?? 'almanac-impact.md').replace(/\.md$/i, '') + '.llm.md',
      );
      writeFileSync(narrativePath, withDisclaimer(markdown));
      extra.push(
        `Narrative (${configuredProvider()}, ${groundedness.citedIds.length} citations verified): ${narrativePath}`,
      );
    } catch (err) {
      process.stderr.write(
        `LLM narrative failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
  } else {
    const bundlePath = resolve(cwd, values.bundle ?? 'almanac-impact-bundle.md');
    writeFileSync(bundlePath, withDisclaimer(bundle));
    extra.push(
      `Bundle: ${bundlePath}` +
        (isProviderConfigured()
          ? ''
          : '  (no LLM provider — set ALMANAC_LLM_PROVIDER, or run this bundle in your own assistant)'),
    );
  }

  const dirty = result.groups.filter((g) => g.entries.length > 0);
  const clean = result.groups.filter((g) => g.entries.length === 0);
  const lines: string[] = [''];
  lines.push(
    `Impact vs API ${target.toFixed(1)}: ${dirty.length} component group(s) cross recorded changes · ${clean.length} clean · ${result.orgWide.length} org-wide change(s)`,
  );
  if (result.uncovered.length > 0) {
    const n = result.uncovered.reduce((s, u) => s + u.componentCount, 0);
    lines.push(`⚠ ${n} component(s) not fully assessable — corpus gap (see report)`);
  }
  for (const w of result.warnings) lines.push(`⚠ ${w}`);
  lines.push('', `Findings: ${outPath}`, ...extra, '');
  process.stdout.write(lines.join('\n'));
  return 0;
}

/**
 * Assemble a self-contained bundle for a report-based prompt (manager
 * explanation, effort estimate, upgrade guide): the instructions plus the
 * inputs they need, ready to paste into any assistant. Unlike the impact
 * bundle there is no corpus groundedness gate — these prompts reformat the
 * report (and optionally the impact findings); they don't cite corpus ids.
 */
function assembleReportBundle(
  title: string,
  promptText: string,
  reportJson: string,
  lang: string | undefined,
  extras: { label: string; md: string }[],
): string {
  const langLine =
    lang && lang.trim() !== ''
      ? [
          `**Output language: ${lang.trim()}.** Write every sentence of prose in ${lang.trim()}; ` +
            'keep dates, counts, and component names exactly as in the inputs.',
          '',
        ]
      : [];
  return [
    `# ${title}`,
    '',
    'Self-contained: the instructions plus the inputs they need. Paste into your assistant.',
    '',
    ...langLine,
    '---',
    '',
    '## Instructions (prompt)',
    '',
    promptText.trim(),
    '',
    '---',
    '',
    '## Scan report (JSON)',
    '',
    '```json',
    reportJson.trim(),
    '```',
    '',
    ...extras.flatMap((e) => ['---', '', `## ${e.label}`, '', e.md.trim(), '']),
  ].join('\n');
}

/**
 * Run one report-based prompt: write the model output (provider configured +
 * useLlm) or a paste-ready bundle. Prints a one-line result; returns an exit
 * code. Mirrors runImpact's llm/no-llm split, without the groundedness gate.
 */
async function runReportPrompt(opts: {
  cwd: string;
  promptFileName: string;
  title: string;
  outBase: string;
  reportJson: string;
  extras: { label: string; md: string }[];
  lang?: string;
  useLlm: boolean;
}): Promise<number> {
  const promptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', opts.promptFileName);
  if (!existsSync(promptPath)) {
    process.stderr.write(`Prompt not found: ${opts.promptFileName}\n`);
    return 2;
  }
  const bundle = assembleReportBundle(
    opts.title,
    readFileSync(promptPath, 'utf8'),
    opts.reportJson,
    opts.lang,
    opts.extras,
  );
  if (opts.useLlm) {
    try {
      progress(
        `Generating ${opts.title} via ${configuredProvider()} — working. This runs quietly; ` +
          `please keep the process running until it finishes.`,
      );
      const tLlm = Date.now();
      const markdown = await defaultRunModel()(bundle);
      const out = resolve(opts.cwd, `${opts.outBase}.md`);
      writeFileSync(out, withDisclaimer(markdown));
      progress(`${opts.title} done in ${sec(tLlm)}`);
      process.stdout.write(`${opts.title} (${configuredProvider()}): ${out}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(
        `${opts.title} (LLM) failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
  }
  const out = resolve(opts.cwd, `${opts.outBase}-bundle.md`);
  writeFileSync(out, withDisclaimer(bundle));
  process.stdout.write(
    `${opts.title} bundle: ${out}` +
      (isProviderConfigured() ? '' : '  (paste into your assistant, or set ALMANAC_LLM_PROVIDER)') +
      '\n',
  );
  return 0;
}

/** Modes that chain extra steps onto `scan`. `scan` (or no mode) = report only. */
const MODES = ['scan', 'impact', 'full-impact', 'manager', 'full', 'roast'] as const;

export async function run(argv: string[], cwd: string = process.cwd()): Promise<number> {
  // parseArgs is strict: an unknown flag throws. Catch it — a typo'd flag must
  // produce a one-line message and exit code 2, never a stack trace.
  const doParse = () => parseArgs({ ...PARSE_CONFIG, args: argv });
  let parsed: ReturnType<typeof doParse>;
  try {
    parsed = doParse();
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('.')[0] : String(err);
    process.stderr.write(`${msg}. Try: almanac --help\n`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    process.stdout.write(`idea-almanac ${scannerVersion()}\n`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return positionals.length === 0 && !values.help ? 2 : 0;
  }

  const command = positionals[0];

  if (command === 'impact') {
    if (values.report === undefined) {
      process.stderr.write('almanac impact requires --report <almanac-report.json>\n');
      return 2;
    }
    const reportPath = resolve(cwd, values.report);
    if (!existsSync(reportPath)) {
      process.stderr.write(`Report not found: ${reportPath}\n`);
      return 2;
    }
    return await runImpact(values, cwd, reportPath, values.report);
  }

  if (command !== 'scan') {
    process.stderr.write(`Unknown command "${command}". Try: almanac --help\n`);
    return 2;
  }

  // Validate --mode up front so a typo fails before we scan an org.
  if (values.mode !== undefined && !MODES.includes(values.mode as (typeof MODES)[number])) {
    process.stderr.write(`Unknown --mode "${values.mode}". Supported: scan, impact, manager, full, roast\n`);
    return 2;
  }

  const schedulePath = values.schedule ? resolve(cwd, values.schedule) : undefined;
  const schedule = loadSchedule(schedulePath);
  const scheduleSource = schedulePath ?? 'built-in retirement-schedule.json';

  let report: Report;
  if (values.org !== undefined) {
    // Org mode makes network calls — but only to the user's own org, via the
    // access token their `sf` CLI already holds. See adapters/org.ts.
    let inventory;
    try {
      inventory = await scanOrg(values.org || undefined);
    } catch (err) {
      if (err instanceof OrgUnavailableError) {
        process.stderr.write(`${err.message}\n`);
        return 2;
      }
      throw err;
    }
    // Tier against the org's own current version (sandbox-preview safety).
    const effectiveSchedule = inventory.resolvedApiVersion
      ? { ...schedule, currentApiVersion: inventory.resolvedApiVersion }
      : schedule;
    report = buildReport(inventory, effectiveSchedule, {
      mode: 'org',
      target: { org: values.org || '(default org)' },
      scheduleSource,
      scannerVersion: scannerVersion(),
    });
  } else {
    const targetPath = resolve(cwd, positionals[1] ?? '.');
    if (!existsSync(targetPath)) {
      process.stderr.write(`Path not found: ${targetPath}\n`);
      return 2;
    }
    report = buildReport(scanRepo(targetPath), schedule, {
      mode: 'repo',
      target: { path: targetPath },
      scheduleSource,
      scannerVersion: scannerVersion(),
    });
  }

  // Staleness guard: if the built-in schedule's currentApiVersion looks out of
  // date, every drift distance is understated. Warn loudly and record it in the
  // report — but never fail; the numbers are still directionally useful.
  const freshness = scheduleFreshness(schedule);
  if (freshness) {
    report.warnings = [{ code: 'schedule-stale', message: freshness.message }, ...report.warnings];
    process.stderr.write(`⚠ ${freshness.message}\n`);
  }

  const jsonPath = resolve(cwd, values.json ?? 'almanac-report.json');
  const htmlPath = resolve(cwd, values.html ?? 'almanac-report.html');
  writeFileSync(jsonPath, renderJson(report));
  writeFileSync(htmlPath, renderHtml(report));
  if (values.md !== undefined) {
    writeFileSync(resolve(cwd, values.md), renderMarkdown(report));
  }

  printSummary(report, jsonPath, htmlPath);

  // Tiered modes: chain extra steps onto the report we just wrote, so a whole
  // pipeline runs in one command. Cumulative:
  //   impact / full-impact → + upgrade-impact
  //   manager              → + impact + manager explanation + effort estimate
  //   full                 → + manager + agent upgrade guide
  if (values.mode !== undefined && values.mode !== 'scan') {
    const mode = values.mode;
    const reportLabel = values.json ?? 'almanac-report.json';
    const reportJson = readFileSync(jsonPath, 'utf8');
    const useLlm = values.llm === true || (values['no-llm'] !== true && isProviderConfigured());

    // Roast is standalone — no impact step, no chaining.
    if (mode === 'roast') {
      progress(
        useLlm
          ? `--mode roast: 1 model call via ${configuredProvider()}. Running quietly…`
          : `--mode roast: writing paste-ready bundle. Add --llm with ALMANAC_LLM_PROVIDER set for the real thing.`,
      );
      const r = await runReportPrompt({
        cwd, promptFileName: 'roast-my-org.md', title: 'Org roast',
        outBase: 'almanac-roast', reportJson, extras: [], lang: values.lang, useLlm,
      });
      if (r !== 0) return r;
    } else {
      const modelCalls = useLlm ? (mode === 'manager' ? 3 : mode === 'full' ? 4 : 1) : 0;
      if (modelCalls > 0) {
        progress(
          `--mode ${mode} with --llm: ${modelCalls} model call(s) ahead via ${configuredProvider()}. ` +
            `They run quietly and can take a few minutes each on a large org — please keep the ` +
            `process running until it finishes.`,
        );
      } else {
        progress(
          `--mode ${mode}: writing paste-ready bundles (no model calls). ` +
            `Add --llm with ALMANAC_LLM_PROVIDER set for finished docs.`,
        );
      }

      // Every non-scan, non-roast mode runs the upgrade-impact step first.
      const impactCode = await runImpact(values, cwd, jsonPath, reportLabel);
      if (impactCode !== 0) return impactCode;
      const impactPath = resolve(cwd, values.out ?? 'almanac-impact.md');
      const impactExtras = existsSync(impactPath)
        ? [{ label: 'Upgrade-impact findings (almanac-impact.md)', md: readFileSync(impactPath, 'utf8') }]
        : [];

      if (mode === 'manager' || mode === 'full') {
        const m = await runReportPrompt({
          cwd, promptFileName: 'explain-to-my-manager.md', title: 'Manager explanation',
          outBase: 'almanac-manager', reportJson, extras: [], lang: values.lang, useLlm,
        });
        if (m !== 0) return m;
        const e = await runReportPrompt({
          cwd, promptFileName: 'effort-estimate.md', title: 'Effort estimate',
          outBase: 'almanac-estimate', reportJson, extras: impactExtras, lang: values.lang, useLlm,
        });
        if (e !== 0) return e;
      }

      if (mode === 'full') {
        const g = await runReportPrompt({
          cwd, promptFileName: 'upgrade-guide.md', title: 'Agent upgrade guide',
          outBase: 'almanac-upgrade-guide', reportJson, extras: impactExtras, lang: values.lang, useLlm,
        });
        if (g !== 0) return g;
      }
    }
  }

  if (values['fail-on'] !== undefined) {
    const tier = values['fail-on'];
    const count = report.summary.byTier[tier] ?? 0;
    if (count > 0) {
      process.stderr.write(`--fail-on ${tier}: ${count} item(s) in tier "${tier}" — failing.\n`);
      return 1;
    }
  }
  return 0;
}

function printSummary(report: Report, jsonPath: string, htmlPath: string): void {
  const out: string[] = [];
  out.push('');
  if (report.headlines.length === 0) {
    out.push('✅ No dated API retirement items.');
  } else {
    for (const h of report.headlines) {
      out.push(`⚠ ${h.message} (${h.date})`);
    }
  }
  out.push('');
  out.push(
    `Staleness score: ${report.stalenessScore} (0 = clean) · ${report.summary.totalComponents} components · ${report.summary.totalIntegrations} integrations`,
  );
  const byTier = Object.entries(report.summary.byTier)
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(' · ');
  if (byTier) out.push(byTier);
  if (report.warnings.length > 0) out.push(`Warnings: ${report.warnings.length} (see report)`);
  out.push('');
  out.push(`Report: ${jsonPath}`);
  out.push(`        ${htmlPath}`);
  out.push('');
  process.stdout.write(out.join('\n'));
}

// Bin entry — only run when executed directly (also via npm bin symlink),
// not when imported by tests.
const invokedPath = process.argv[1] ? safeRealpath(process.argv[1]) : undefined;
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
