import { describe, expect, it } from 'vitest';
import { debtScore } from '../src/core/score.js';

const w = (weight: number) => ({ weight });

describe('debt score', () => {
  it('is 0 for an empty inventory', () => expect(debtScore([])).toBe(0));
  it('is 0 when everything is current', () =>
    expect(debtScore([w(0), w(0), w(0)])).toBe(0));
  it('is 100 when everything is retired', () =>
    expect(debtScore([w(1), w(1)])).toBe(100));
  it('rounds: one retired among four current => 20', () =>
    expect(debtScore([w(1), w(0), w(0), w(0), w(0)])).toBe(20));
  it('mixes weights per the documented formula', () =>
    // (1.0 + 0.7 + 0.15 + 0) / 4 = 0.4625 -> 46
    expect(debtScore([w(1.0), w(0.7), w(0.15), w(0)])).toBe(46));
});
