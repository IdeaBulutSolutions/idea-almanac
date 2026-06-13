/**
 * Stage 3 — AI extraction.
 *
 * For each filtered section, calls an LLM with prompts/extract-changes.md and
 * collects schema-conformant change entries.
 *
 * Providers (ALMANAC_LLM_PROVIDER, default "claude-cli"):
 *   claude-cli   — shells out to `claude -p` (runs on a Claude subscription,
 *                  no API key needed; the expected path for this project)
 *   copilot-cli  — shells out to `copilot -p` (experimental; override the
 *                  binary/flags with ALMANAC_COPILOT_CMD if yours differ)
 *   anthropic    — Anthropic Messages API via fetch (needs ANTHROPIC_API_KEY)
 *
 * Model override: ALMANAC_LLM_MODEL (passed to the provider as-is).
 *
 * Responses are cached in pipeline/cache/v{NN}/ keyed by a content hash of
 * (prompt, provider, model) — re-runs are free; delete a cache file to redo
 * one section.
 *
 * Post-checks on every emitted entry:
 *   - ajv validation against change-entry.schema.json (entry definition)
 *   - own-words: rejected if the summary shares an 8-word shingle with the
 *     source section text
 *   - vague appliesWhen => confidence downgraded to "low"
 *
 * Usage:
 *   node --experimental-strip-types pipeline/src/extract-entries.ts v67 [--limit N] [--dry-run]
 *
 * Reads  work/v{NN}/filtered.jsonl
 * Writes work/v{NN}/entries.yaml        (draft — promoted to data/ only after
 *                                        human review, §4.6)
 *        work/v{NN}/rejects.jsonl       (rejected entries + reasons, for review)
 *        work/v{NN}/extraction-stats.json
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { stringify as yamlStringify } from 'yaml';

// --------------------------------------------------------------------------
// Pure helpers (exported for tests)
// --------------------------------------------------------------------------

const normalizeWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');

/**
 * Own-words check: true when `summary` shares a run of
 * `size` consecutive words with `sourceText`.
 */
export function sharesShingle(summary: string, sourceText: string, size = 8): boolean {
  const words = normalizeWords(summary);
  if (words.length < size) return false;
  const haystack = ` ${normalizeWords(sourceText).join(' ')} `;
  for (let i = 0; i + size <= words.length; i++) {
    if (haystack.includes(` ${words.slice(i, i + size).join(' ')} `)) return true;
  }
  return false;
}

/** Vague appliesWhen => confidence "low" (validator rule). */
export function isVagueAppliesWhen(appliesWhen: string): boolean {
  const s = appliesWhen.toLowerCase();
  const mentionsComponentVersion = /api\s*(version)?\s*[<>=]+\s*\d{2}(\.\d)?|compiled at|pinned/.test(s);
  // Request-versioned phrasing ("at/targeting version 66.0 and later") and
  // runtime-version bounds are precise too (learned in the v67 pilot review).
  const mentionsRequestVersion = /(at|targeting|in) (api )?version \d{2}(\.\d)?( and later)?|runtime version (of )?\d{2}/.test(s);
  const mentionsOrgWide = /org-wide|regardless|all orgs|every org|release update/.test(s);
  return !mentionsComponentVersion && !mentionsRequestVersion && !mentionsOrgWide;
}

/** Parse a model response into an array of candidate entries. */
export function parseResponse(raw: string): Record<string, unknown>[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('no JSON array in response');
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('response is not an array');
  return parsed as Record<string, unknown>[];
}

const AREA_SLUGS: Record<string, string> = {
  'apex-runtime': 'apex',
  'apex-testing': 'apex',
  'soql-sosl': 'soql',
  'sharing-security': 'sharing',
  'api-rest': 'rest',
  'api-soap': 'soap',
  'api-bulk': 'bulk',
  'flow-runtime': 'flow',
  lwc: 'lwc',
  aura: 'aura',
  visualforce: 'vf',
  'packaging-metadata': 'packaging',
  authentication: 'auth',
  other: 'other',
};

/** Deterministic id assignment: v{NN}-{area}-{seq} in stable order. */
export function assignIds(entries: { behaviorArea?: unknown }[], versionArg: string): void {
  const counters: Record<string, number> = {};
  for (const entry of entries) {
    const slug = AREA_SLUGS[String(entry.behaviorArea)] ?? 'other';
    counters[slug] = (counters[slug] ?? 0) + 1;
    (entry as Record<string, unknown>).id =
      `${versionArg}-${slug}-${String(counters[slug]).padStart(3, '0')}`;
  }
}

export function cacheKey(prompt: string, provider: string, model: string): string {
  return createHash('sha256').update(`${provider}\n${model}\n${prompt}`).digest('hex');
}

// --------------------------------------------------------------------------
// Providers
// --------------------------------------------------------------------------

type Provider = (prompt: string, model: string) => string;

const runCli = (cmd: string, args: string[], prompt: string): string => {
  const res = spawnSync(cmd, args, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} exited ${res.status}: ${res.stderr.slice(0, 400)}`);
  return res.stdout;
};

const providers: Record<string, Provider> = {
  'claude-cli': (prompt, model) =>
    runCli('claude', ['-p', '--output-format', 'text', ...(model ? ['--model', model] : [])], prompt),
  'copilot-cli': (prompt, model) => {
    const override = process.env.ALMANAC_COPILOT_CMD;
    const [cmd = 'copilot', ...baseArgs] = override ? override.split(' ') : ['copilot', '-p'];
    return runCli(cmd, [...baseArgs, ...(model ? ['--model', model] : [])], prompt);
  },
  anthropic: (prompt, model) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    // Sync-over-async kept simple: providers run sequentially anyway.
    const res = spawnSync(
      'curl',
      ['-s', 'https://api.anthropic.com/v1/messages', '-H', `x-api-key: ${key}`,
        '-H', 'anthropic-version: 2023-06-01', '-H', 'content-type: application/json',
        '-d', JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        })],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000 },
    );
    if (res.status !== 0) throw new Error(`anthropic api call failed: ${res.stderr.slice(0, 400)}`);
    const body = JSON.parse(res.stdout) as { content?: { type: string; text?: string }[]; error?: { message: string } };
    if (body.error) throw new Error(`anthropic api: ${body.error.message}`);
    return (body.content ?? []).map((c) => c.text ?? '').join('');
  },
};

// --------------------------------------------------------------------------
// CLI entry
// --------------------------------------------------------------------------

const invokedDirectly = process.argv[1]?.endsWith('extract-entries.ts') ?? false;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const versionArg = args.find((a) => /^v\d{2}$/.test(a));
  if (!versionArg) {
    process.stderr.write('usage: extract-entries.ts v67 [--limit N] [--dry-run]\n');
    process.exit(1);
  }
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx === -1 ? Number.POSITIVE_INFINITY : Number.parseInt(args[limitIdx + 1] ?? '0', 10);
  const dryRun = args.includes('--dry-run');

  const providerName = process.env.ALMANAC_LLM_PROVIDER ?? 'claude-cli';
  const model = process.env.ALMANAC_LLM_MODEL ?? '';
  const provider = providers[providerName];
  if (!provider) {
    process.stderr.write(`unknown provider "${providerName}" (have: ${Object.keys(providers).join(', ')})\n`);
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const corpusRoot = join(here, '..', '..');
  const workDir = join(corpusRoot, 'pipeline', 'work', versionArg);
  const cacheDir = join(corpusRoot, 'pipeline', 'cache', versionArg);
  mkdirSync(cacheDir, { recursive: true });

  const meta = JSON.parse(readFileSync(join(workDir, 'meta.json'), 'utf8')) as {
    file: string;
    release: string;
  };
  const apiVersion = `${versionArg.slice(1)}.0`;
  const promptTemplate = readFileSync(join(corpusRoot, 'pipeline', 'prompts', 'extract-changes.md'), 'utf8');

  const schema = JSON.parse(
    readFileSync(join(corpusRoot, 'schema', 'change-entry.schema.json'), 'utf8'),
  ) as Record<string, unknown> & { definitions: { entry: Record<string, unknown> } };
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateEntry: ValidateFunction = ajv.compile({
    ...schema.definitions.entry,
    definitions: schema.definitions,
  });

  interface Section {
    heading: string;
    breadcrumb: string[];
    page: number;
    text: string;
  }
  const sections: Section[] = readFileSync(join(workDir, 'filtered.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Section);

  const accepted: Record<string, unknown>[] = [];
  const rejects: { reason: string; heading: string; entry?: unknown }[] = [];
  let calls = 0;
  let cacheHits = 0;
  let processed = 0;

  for (const section of sections) {
    if (processed >= limit) break;
    processed++;

    const prompt = promptTemplate
      .replaceAll('{{API_VERSION}}', apiVersion)
      .replaceAll('{{RELEASE}}', meta.release)
      .replaceAll('{{DOCUMENT}}', meta.file)
      .replaceAll('{{PAGE}}', String(section.page))
      .replace('{{SECTION_JSON}}', JSON.stringify(section, null, 2));

    const key = cacheKey(prompt, providerName, model);
    const cacheFile = join(cacheDir, `${key}.json`);
    let raw: string;
    if (existsSync(cacheFile)) {
      raw = (JSON.parse(readFileSync(cacheFile, 'utf8')) as { response: string }).response;
      cacheHits++;
    } else if (dryRun) {
      continue;
    } else {
      try {
        raw = provider(prompt, model);
        calls++;
      } catch (err) {
        rejects.push({ reason: `provider-error: ${(err as Error).message}`, heading: section.heading });
        continue;
      }
      writeFileSync(
        cacheFile,
        JSON.stringify({ response: raw, provider: providerName, model, heading: section.heading, ts: new Date().toISOString() }),
      );
    }

    let candidates: Record<string, unknown>[];
    try {
      candidates = parseResponse(raw);
    } catch (err) {
      rejects.push({ reason: `unparseable-response: ${(err as Error).message}`, heading: section.heading });
      continue;
    }

    for (const entry of candidates) {
      // Pin pipeline-owned fields regardless of what the model said.
      entry.apiVersion = apiVersion;
      entry.release = meta.release;
      const source = (entry.source ?? {}) as Record<string, unknown>;
      source.document = meta.file;
      // Always pin page + heading from the section record — the model tends to
      // emit the PRINTED page number from the section text (v65–v67 review
      // finding: ~40 entries cited printed/TOC pages) and normalizes
      // typographic quotes in headings.
      source.page = section.page;
      source.heading = section.heading;
      entry.source = source;
      entry.id = 'v00-other-000'; // placeholder; reassigned below

      if (typeof entry.appliesWhen === 'string' && isVagueAppliesWhen(entry.appliesWhen)) {
        entry.confidence = 'low';
      }
      if (typeof entry.summary === 'string' && sharesShingle(entry.summary, section.text)) {
        rejects.push({ reason: 'shingle: summary copies source text', heading: section.heading, entry });
        continue;
      }
      // Own-words applies to detail too (prompt: "Summaries and
      // details must be REWRITTEN"); v60–v67 reviews kept finding copied
      // details slipping through the summary-only check.
      if (typeof entry.detail === 'string' && sharesShingle(entry.detail, section.text)) {
        rejects.push({ reason: 'shingle: detail copies source text', heading: section.heading, entry });
        continue;
      }
      if (!validateEntry(entry)) {
        rejects.push({
          reason: `schema: ${ajv.errorsText(validateEntry.errors)}`,
          heading: section.heading,
          entry,
        });
        continue;
      }
      accepted.push(entry);
    }
  }

  assignIds(accepted as { behaviorArea?: unknown }[], versionArg);

  const fileDoc = { apiVersion, release: meta.release, reviewed: false, entries: accepted };
  writeFileSync(join(workDir, 'entries.yaml'), yamlStringify(fileDoc));
  writeFileSync(
    join(workDir, 'rejects.jsonl'),
    rejects.map((r) => JSON.stringify(r)).join('\n') + (rejects.length ? '\n' : ''),
  );

  const stats = {
    provider: providerName,
    model: model || '(default)',
    sectionsProcessed: processed,
    sectionsTotal: sections.length,
    llmCalls: calls,
    cacheHits,
    entriesAccepted: accepted.length,
    entriesRejected: rejects.length,
    target: '15-60 valid entries for a full version run',
    targetPass: accepted.length >= 15 && accepted.length <= 60,
  };
  writeFileSync(join(workDir, 'extraction-stats.json'), JSON.stringify(stats, null, 2));
  process.stdout.write(
    `extract-entries: ${versionArg}: ${accepted.length} accepted, ${rejects.length} rejected ` +
      `(${processed}/${sections.length} sections, ${cacheHits} cached, ${calls} LLM calls)` +
      `${processed >= sections.length ? (stats.targetPass ? ' ✓ within target' : ' ✗ outside 15-60 target band') : ' — partial run'}\n`,
  );
}
