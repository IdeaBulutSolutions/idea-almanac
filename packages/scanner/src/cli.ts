#!/usr/bin/env node
/**
 * `almanac` CLI. No interactive prompts, no telemetry, no update
 * checks. Repo scans make zero network calls.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanRepo } from './adapters/repo.js';
import { scanOrg, OrgUnavailableError } from './adapters/org.js';
import { loadSchedule } from './core/tiering.js';
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

const HELP = `almanac — Salesforce API version debt scanner (repo scans: zero network calls)

Usage:
  almanac scan [path]              scan an sfdx repo (default: current directory)
  almanac scan --org <alias>       scan a live org via your existing sf CLI session
                                   (omit <alias> to use your default org)
  almanac impact --report <json>   upgrade-impact review from corpus data

Scan options:
  --json <file>     write JSON report   (default: ./almanac-report.json)
  --html <file>     write HTML report   (default: ./almanac-report.html)
  --md <file>       write Markdown report (off by default)
  --fail-on <tier>  exit 1 if any item lands in this tier (CI gate),
                    e.g. retired | breaks-2027 | breaks-2028 | stale
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
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
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
    const versions = spanUnion(report.components, target);
    const corpus = loadCorpus(corpusDir, versions);
    const result = computeImpact(report, corpus, target);
    const deterministicMd = renderImpactMarkdown(result, values.report);
    const outPath = resolve(cwd, values.out ?? 'almanac-impact.md');
    writeFileSync(outPath, deterministicMd);

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
      reportJson: readFileSync(reportPath, 'utf8'),
      deterministicMd,
      target,
      language: values.lang,
    });

    const extra: string[] = [];
    const useLlm = values.llm === true || (values['no-llm'] !== true && isProviderConfigured());
    if (useLlm) {
      try {
        const { markdown, groundedness } = generateNarrative(
          bundle,
          collectValidIds(corpus),
          defaultRunModel(),
        );
        const narrativePath = resolve(
          cwd,
          (values.out ?? 'almanac-impact.md').replace(/\.md$/i, '') + '.llm.md',
        );
        writeFileSync(narrativePath, markdown);
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
      writeFileSync(bundlePath, bundle);
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

  if (command !== 'scan') {
    process.stderr.write(`Unknown command "${command}". Try: almanac --help\n`);
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
    report = buildReport(inventory, schedule, {
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

  const jsonPath = resolve(cwd, values.json ?? 'almanac-report.json');
  const htmlPath = resolve(cwd, values.html ?? 'almanac-report.html');
  writeFileSync(jsonPath, renderJson(report));
  writeFileSync(htmlPath, renderHtml(report));
  if (values.md !== undefined) {
    writeFileSync(resolve(cwd, values.md), renderMarkdown(report));
  }

  printSummary(report, jsonPath, htmlPath);

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
    out.push('✅ No dated API version debt found.');
  } else {
    for (const h of report.headlines) {
      out.push(`⚠ ${h.message} (${h.date})`);
    }
  }
  out.push('');
  out.push(
    `Debt score: ${report.debtScore} (0 = clean) · ${report.summary.totalComponents} components · ${report.summary.totalIntegrations} integrations`,
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
