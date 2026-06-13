/**
 * The Action's report->outputs/badge helper. The action.yml composite
 * itself can only be exercised by a real CI run (the dogfood workflow), but the
 * parsing + badge logic is pure and tested here.
 */
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBadge, summarize } from '../action/summarize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const exampleReport = join(here, '..', 'examples', 'almanac-report.json');

describe('action summarize', () => {
  it('badge color reflects severity', () => {
    expect(buildBadge(2, 40)).toContain('-red'); // any retired => red
    expect(buildBadge(0, 40)).toContain('-orange'); // high score
    expect(buildBadge(0, 10)).toContain('-yellow'); // some debt
    expect(buildBadge(0, 0)).toContain('-brightgreen'); // clean
  });

  it('badge message is "N retired" and url-encodes the label', () => {
    const badge = buildBadge(1, 27);
    expect(badge).toContain('API%20debt-1%20retired');
    expect(badge.startsWith('![Almanac API debt](https://img.shields.io/badge/')).toBe(true);
  });

  it('summarizes the committed example report (score 27, 1 retired)', () => {
    const { retiredCount, debtScore, badge } = summarize(exampleReport);
    expect(debtScore).toBe(27);
    expect(retiredCount).toBe(1);
    expect(badge).toContain('1%20retired');
  });
});
