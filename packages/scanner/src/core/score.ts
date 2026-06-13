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

export type DebtBand = 'clean' | 'low' | 'moderate' | 'high' | 'severe';

export interface DebtScoreContribution {
  tier: string;
  label?: string;
  count: number;
  weight: number;
  /** count × weight, rounded — the tier's share of the weighted sum. */
  contribution: number;
}

/**
 * The "why" behind the debt score: the formula, each tier's contribution, and a
 * plain-language band so a reader knows whether the number is good or bad. The
 * score is a weighted average of how far behind things are — secondary to the
 * retirement dates, which are the real signal.
 */
export interface DebtScoreBreakdown {
  formula: string;
  totalItems: number;
  weightedSum: number;
  score: number;
  band: DebtBand;
  interpretation: string;
  contributions: DebtScoreContribution[];
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

function band(score: number): DebtBand {
  if (score === 0) return 'clean';
  if (score <= 10) return 'low';
  if (score <= 30) return 'moderate';
  if (score <= 60) return 'high';
  return 'severe';
}

const BAND_TEXT: Record<DebtBand, string> = {
  clean: 'No dated API-version debt — nothing is aging out.',
  low: 'Mostly current, with a little drift. Low risk, easy to keep clean.',
  moderate: 'A meaningful share of the org is behind. Plan remediation before the dated items come due.',
  high: 'A large, heavily-weighted backlog — much of it near or past a retirement date. Prioritize now.',
  severe: 'Most of the org is critically behind, weighted toward already-failing or imminent breakage. Urgent.',
};

export function debtScoreBreakdown(
  tiered: ReadonlyArray<Pick<TierResult, 'tier' | 'label' | 'weight'>>,
): DebtScoreBreakdown {
  const score = debtScore(tiered);
  const byTier = new Map<string, DebtScoreContribution>();
  for (const t of tiered) {
    const entry =
      byTier.get(t.tier) ??
      ({ tier: t.tier, ...(t.label !== undefined && { label: t.label }), count: 0, weight: t.weight, contribution: 0 } as DebtScoreContribution);
    entry.count += 1;
    entry.contribution = round(entry.count * entry.weight);
    byTier.set(t.tier, entry);
  }
  const contributions = [...byTier.values()].sort((a, b) => b.weight - a.weight || b.count - a.count);
  const weightedSum = round(contributions.reduce((s, c) => s + c.contribution, 0));
  const b = band(score);
  return {
    formula: 'round(100 × Σ tier_weight / total_items)',
    totalItems: tiered.length,
    weightedSum,
    score,
    band: b,
    interpretation: BAND_TEXT[b],
    contributions,
  };
}
