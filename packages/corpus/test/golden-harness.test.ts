/**
 * Golden-questions harness. The model is injected, so slicing + grading run
 * offline. The "oracle" run also proves every question's expected ids actually
 * fall inside its span's loaded slices (i.e. the golden set is gradeable).
 */
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPrompt,
  grade,
  loadQuestions,
  runHarness,
  sliceForSpan,
  spanVersions,
  type Question,
} from '../golden-questions/harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const questionsFile = join(here, '..', 'golden-questions', 'questions.yaml');

const Q: Question = {
  id: 'q-test',
  question: 'demo',
  span: { from: '64.0', to: '67.0' },
  expectAll: ['v67-sharing-002'],
  expectAnyOf: [['v66-sharing-002', 'v66-sharing-003']],
};
const valid = new Set(['v67-sharing-002', 'v66-sharing-002', 'v66-sharing-003']);

describe('golden harness', () => {
  it('spanVersions is the half-open interval (from, to]', () => {
    expect(spanVersions({ from: '64.0', to: '67.0' })).toEqual([65, 66, 67]);
    expect(spanVersions({ from: '46.0', to: '52.0' })).toEqual([47, 48, 49, 50, 51, 52]);
  });

  it('passes when expectAll is cited, an anyOf member is cited, and all grounded', () => {
    const r = grade(Q, 'see v67-sharing-002 and v66-sharing-003', valid);
    expect(r.pass).toBe(true);
    expect(r.ungrounded).toEqual([]);
  });

  it('fails on a missing expectAll id', () => {
    const r = grade(Q, 'only v66-sharing-002 here', valid);
    expect(r.pass).toBe(false);
    expect(r.missingExpectAll).toEqual(['v67-sharing-002']);
  });

  it('fails when no anyOf group member is cited', () => {
    const r = grade(Q, 'just v67-sharing-002', valid);
    expect(r.pass).toBe(false);
    expect(r.unmetAnyOf).toEqual([['v66-sharing-002', 'v66-sharing-003']]);
  });

  it('fails on an ungrounded (hallucinated) citation', () => {
    const r = grade(Q, 'v67-sharing-002, v66-sharing-002, and v99-fake-001', valid);
    expect(r.pass).toBe(false);
    expect(r.ungrounded).toEqual(['v99-fake-001']);
  });

  it('oracle run: every real question is gradeable and its expected ids are in-slice', () => {
    const questions = loadQuestions(questionsFile);
    // A perfect model: cite every expectAll id + one from each anyOf group.
    const oracle = (_prompt: string, q: Question): string =>
      [...(q.expectAll ?? []), ...(q.expectAnyOf ?? []).map((g) => g[0])].join(' ');
    // runHarness calls runModel(prompt); thread the question through a closure.
    let i = 0;
    const run = runHarness(questions, dataDir, (prompt) => oracle(prompt, questions[i++]!));
    expect(run.ok).toBe(true);
    expect(run.passed).toBe(questions.length);
  });

  it('sliceForSpan loads real corpus entries and a prompt that lists ids', () => {
    const slice = sliceForSpan(dataDir, { from: '64.0', to: '67.0' });
    expect(slice.validIds.has('v67-sharing-002')).toBe(true);
    expect(slice.missingVersions).toEqual([]);
    const prompt = buildPrompt(Q, slice);
    expect(prompt).toContain('v67-sharing-002');
    expect(prompt).toContain('Cite the entry id');
  });
});
