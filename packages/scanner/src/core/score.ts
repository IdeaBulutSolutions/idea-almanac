/**
 * Debt score — secondary to dates, and deliberately simple:
 *
 *   debtScore = round(100 × Σ weight(tier_i) / N)
 *
 * over all components + integrations. Weights come from the schedule file
 * (retired 1.0, breaks-2027 0.9, breaks-2028 0.7, stale 0.15, current 0).
 * 0 = clean. Resist making it cleverer.
 */
import type { TierResult } from './tiering.js';

export function debtScore(tiered: ReadonlyArray<Pick<TierResult, 'weight'>>): number {
  if (tiered.length === 0) return 0;
  const sum = tiered.reduce((acc, t) => acc + t.weight, 0);
  return Math.round((100 * sum) / tiered.length);
}
