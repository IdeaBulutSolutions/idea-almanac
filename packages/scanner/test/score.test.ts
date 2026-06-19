import { describe, expect, it } from 'vitest';
import { stalenessScore } from '../src/core/score.js';

const w = (weight: number) => ({ weight });

describe('staleness score', () => {
  it('is 0 for an empty inventory', () => expect(stalenessScore([])).toBe(0));
  it('is 0 when everything is current', () =>
    expect(stalenessScore([w(0), w(0), w(0)])).toBe(0));
  it('is 100 when all items are max weight', () =>
    expect(stalenessScore([w(1), w(1)])).toBe(100));
  it('rounds: one max-weight item among four current => 20', () =>
    expect(stalenessScore([w(1), w(0), w(0), w(0), w(0)])).toBe(20));
  it('mixes weights per the documented formula', () =>
    // (0.6 + 0.3 + 0) / 3 = 0.3 -> 30
    expect(stalenessScore([w(0.6), w(0.3), w(0)])).toBe(30));
});
