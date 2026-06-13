/**
 * Golden-questions harness runner. Runs every question in questions.yaml
 * through the configured model and prints a pass/fail report.
 *
 *   ALMANAC_LLM_PROVIDER=claude-cli npm run golden   # from packages/corpus
 *
 * Exits 1 if any question fails. Spends tokens and is non-deterministic — run it
 * per release / when the corpus or questions change, not on every build and never
 * as a merge gate (the structural guard test gates merges).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRunModel, loadQuestions, runHarness, type RunModel } from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const questionsFile = join(here, 'questions.yaml');

function main(runModel: RunModel): number {
  const questions = loadQuestions(questionsFile);
  process.stdout.write(`Running ${questions.length} golden questions against ${dataDir}\n\n`);

  let run;
  try {
    run = runHarness(questions, dataDir, runModel);
  } catch (err) {
    process.stderr.write(`Model call failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write('Set ALMANAC_LLM_PROVIDER (claude-cli | anthropic | cmd) and ensure the CLI/key is available.\n');
    return 2;
  }
  const { results, passed, total, ok } = run;
  for (const r of results) {
    const mark = r.pass ? '✓' : '✗';
    process.stdout.write(`${mark} ${r.questionId} — ${r.citedIds.length} citation(s)\n`);
    if (!r.pass) {
      if (r.missingExpectAll.length) process.stdout.write(`    missing expectAll: ${r.missingExpectAll.join(', ')}\n`);
      if (r.unmetAnyOf.length) process.stdout.write(`    unmet anyOf: ${r.unmetAnyOf.map((g) => `[${g.join('|')}]`).join(', ')}\n`);
      if (r.ungrounded.length) process.stdout.write(`    ungrounded (not in slices): ${r.ungrounded.join(', ')}\n`);
    }
  }
  process.stdout.write(`\n${passed}/${total} passed.\n`);
  return ok ? 0 : 1;
}

process.exit(main(defaultRunModel()));
