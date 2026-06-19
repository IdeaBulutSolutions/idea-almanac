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
    expect(buildBadge(2, 40)).toContain('-red'); // any far-behind => red
    expect(buildBadge(0, 40)).toContain('-orange'); // high staleness score
    expect(buildBadge(0, 10)).toContain('-yellow'); // some drift
    expect(buildBadge(0, 0)).toContain('-brightgreen'); // clean
  });

  it('badge message is "N far-behind" and url-encodes the label', () => {
    const badge = buildBadge(1, 27);
    expect(badge).toContain('Almanac-1%20far--behind');
    expect(badge.startsWith('![Almanac](https://img.shields.io/badge/')).toBe(true);
  });

  it('summarizes the committed example report (score 41, 7 far-behind)', () => {
    const { farBehindCount, stalenessScore, badge } = summarize(exampleReport);
    expect(stalenessScore).toBe(41);
    expect(farBehindCount).toBe(7);
    expect(badge).toContain('7%20far--behind');
  });
});
