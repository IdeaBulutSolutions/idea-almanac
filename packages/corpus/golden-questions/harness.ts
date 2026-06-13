/**
 * Golden-questions grading harness. The acceptance
 * test for the corpus: can a model answer real upgrade questions using ONLY the
 * relevant corpus slices, citing entry ids that actually exist?
 *
 * Per question (contract in golden-questions/README.md):
 *   1. SLICE  — load only data/v{NN}.yaml for versions in (span.from, span.to].
 *   2. ASK    — feed the slices + question to a model; require id citations.
 *   3. GRADE  — every `expectAll` id appears; each `expectAnyOf` group contributes
 *               at least one; and the GROUNDEDNESS gate: any cited id not in the
 *               loaded slices fails the question.
 *
 * The model is injected (`RunModel`), so the slicing + grading are unit-tested
 * offline; the real env-based provider lives at the bottom and only runs when
 * the user invokes the harness for real (it spends tokens; keep it manual /
 * nightly, not a merge gate — LLM grading is flaky).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface Question {
  id: string;
  question: string;
  span: { from: string; to: string };
  expectAll?: string[];
  expectAnyOf?: string[][];
  notes?: string;
}

interface CorpusEntry {
  id: string;
  impact?: string;
  summary?: string;
  upgradeAction?: string;
}

/** Corpus entry id, e.g. `v66-sharing-002`. */
const ENTRY_ID_RE = /\bv\d{2,3}-[a-z]+-\d{1,3}\b/g;

export function loadQuestions(file: string): Question[] {
  const doc = parseYaml(readFileSync(file, 'utf8')) as { questions: Question[] };
  return doc.questions;
}

/** Integer versions in the half-open span (from, to]. */
export function spanVersions(span: { from: string; to: string }): number[] {
  const from = Math.floor(Number.parseFloat(span.from));
  const to = Math.floor(Number.parseFloat(span.to));
  const out: number[] = [];
  for (let v = from + 1; v <= to; v++) out.push(v);
  return out;
}

export interface Slice {
  entries: CorpusEntry[];
  validIds: Set<string>;
  missingVersions: number[];
}

/** Load the corpus entries for a question's span. */
export function sliceForSpan(dataDir: string, span: { from: string; to: string }): Slice {
  const entries: CorpusEntry[] = [];
  const validIds = new Set<string>();
  const missingVersions: number[] = [];
  for (const v of spanVersions(span)) {
    const path = join(dataDir, `v${v}.yaml`);
    if (!existsSync(path)) {
      missingVersions.push(v);
      continue;
    }
    const doc = parseYaml(readFileSync(path, 'utf8')) as { entries: CorpusEntry[] };
    for (const e of doc.entries ?? []) {
      entries.push(e);
      validIds.add(e.id);
    }
  }
  return { entries, validIds, missingVersions };
}

/** Assemble the model prompt: the question + the sliced corpus, cite-only. */
export function buildPrompt(question: Question, slice: Slice): string {
  const lines: string[] = [];
  lines.push(
    'Answer the question using ONLY the corpus entries below. Cite the entry id',
    '(e.g. v66-sharing-002) for every change you mention. Do not use any id that',
    'is not listed here.',
    '',
    `# Question (${question.id})`,
    '',
    question.question.trim(),
    '',
    '# Corpus entries in scope',
    '',
  );
  for (const e of slice.entries) {
    lines.push(`- ${e.id} [${e.impact ?? '?'}] ${e.summary ?? ''}`);
  }
  return lines.join('\n');
}

export function extractCitedIds(answer: string): string[] {
  return [...new Set(answer.match(ENTRY_ID_RE) ?? [])];
}

export interface GradeResult {
  questionId: string;
  pass: boolean;
  citedIds: string[];
  /** expectAll ids the answer failed to cite. */
  missingExpectAll: string[];
  /** expectAnyOf groups where no member was cited. */
  unmetAnyOf: string[][];
  /** cited ids that are not in the loaded slices (hallucinated). */
  ungrounded: string[];
}

export function grade(question: Question, answer: string, validIds: Set<string>): GradeResult {
  const citedIds = extractCitedIds(answer);
  const cited = new Set(citedIds);

  const missingExpectAll = (question.expectAll ?? []).filter((id) => !cited.has(id));
  const unmetAnyOf = (question.expectAnyOf ?? []).filter(
    (group) => !group.some((id) => cited.has(id)),
  );
  const ungrounded = citedIds.filter((id) => !validIds.has(id));

  return {
    questionId: question.id,
    pass: missingExpectAll.length === 0 && unmetAnyOf.length === 0 && ungrounded.length === 0,
    citedIds,
    missingExpectAll,
    unmetAnyOf,
    ungrounded,
  };
}

/** A model invocation: prompt in, answer out. */
export type RunModel = (prompt: string) => string;

export interface HarnessResult {
  results: GradeResult[];
  passed: number;
  total: number;
  ok: boolean;
}

/** Run every question through the model and grade. Returns aggregate pass/fail. */
export function runHarness(
  questions: Question[],
  dataDir: string,
  runModel: RunModel,
): HarnessResult {
  const results: GradeResult[] = [];
  for (const q of questions) {
    const slice = sliceForSpan(dataDir, q.span);
    const answer = runModel(buildPrompt(q, slice));
    results.push(grade(q, answer, slice.validIds));
  }
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, total: results.length, ok: passed === results.length };
}

// ---------------------------------------------------------------------------
// Default (real) provider — mirrors the corpus stage-3 / scanner llm.ts setup.
// Only runs when the user invokes the harness for real (spends tokens).
// ---------------------------------------------------------------------------

export function defaultRunModel(): RunModel {
  const provider = process.env.ALMANAC_LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'claude-cli');
  const model = process.env.ALMANAC_LLM_MODEL ?? '';
  const cli = (cmd: string, args: string[], stdin: string): string => {
    const res = spawnSync(cmd, args, { input: stdin, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`${cmd} exited ${res.status}: ${String(res.stderr).slice(0, 300)}`);
    return res.stdout;
  };
  switch (provider) {
    case 'claude-cli':
      return (p) => cli('claude', ['-p', '--output-format', 'text', ...(model ? ['--model', model] : [])], p);
    case 'cmd': {
      const cmd = process.env.ALMANAC_LLM_CMD;
      if (!cmd) throw new Error('provider "cmd" needs ALMANAC_LLM_CMD');
      return (p) => cli('bash', ['-c', cmd], p);
    }
    case 'anthropic':
      return (p) => {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) throw new Error('ANTHROPIC_API_KEY not set');
        const body = JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: p }],
        });
        const res = cli('curl', [
          '-sS', 'https://api.anthropic.com/v1/messages',
          '-H', `x-api-key: ${key}`, '-H', 'anthropic-version: 2023-06-01',
          '-H', 'content-type: application/json', '-d', '@-',
        ], body);
        const parsed = JSON.parse(res) as { content?: { text?: string }[] };
        return parsed.content?.map((c) => c.text ?? '').join('') ?? '';
      };
    default:
      throw new Error(`unknown ALMANAC_LLM_PROVIDER "${provider}"`);
  }
}
