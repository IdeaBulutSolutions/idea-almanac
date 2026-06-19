/**
 * Staleness score — secondary to dates, and deliberately simple:
 *
 *   stalenessScore = round(100 × Σ weight(tier_i) / N)
 *
 * over all components + integrations. Weights come from the schedule file
 * (far-behind 0.6, breaks-2027 0.9, behind 0.3, current 0).
 * 0 = all current. Resist making it cleverer.
 *
 * Review-only types (Flow, LWC, Aura) contribute at REVIEW_ONLY_WEIGHT_FACTOR
 * of their tier weight — their upgrade path is manual review, not test-gated
 * automation, so they pull the score down less than automatable Apex changes.
 * The factor is applied in buildReport before the score is computed here.
 */
import type { TierResult } from './tiering.js';

/** Weight multiplier for Flow/LWC/Aura — review-only types count at half weight. */
export const REVIEW_ONLY_WEIGHT_FACTOR = 0.5;

export function stalenessScore(tiered: ReadonlyArray<Pick<TierResult, 'weight'>>): number {
  if (tiered.length === 0) return 0;
  const sum = tiered.reduce((acc, t) => acc + t.weight, 0);
  return Math.round((100 * sum) / tiered.length);
}

export type StalenessBand = 'clean' | 'low' | 'moderate' | 'high' | 'severe';

export interface StalenessContribution {
  tier: string;
  label?: string;
  count: number;
  weight: number;
  /** count × weight, rounded — the tier's share of the weighted sum. */
  contribution: number;
}

/**
 * The "why" behind the staleness score: the formula, each tier's contribution,
 * and a plain-language band so a reader knows whether the number is good or bad.
 * The score is a weighted average of how far behind things are — secondary to
 * the retirement dates, which are the real signal.
 */
export interface StalenessBreakdown {
  formula: string;
  totalItems: number;
  weightedSum: number;
  score: number;
  band: StalenessBand;
  interpretation: string;
  contributions: StalenessContribution[];
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

function band(score: number): StalenessBand {
  if (score === 0) return 'clean';
  if (score <= 10) return 'low';
  if (score <= 30) return 'moderate';
  if (score <= 60) return 'high';
  return 'severe';
}

const BAND_TEXT: Record<StalenessBand, string> = {
  clean: 'All components are current — no version drift.',
  low: 'Mostly current, with minor drift. Low upgrade effort.',
  moderate: 'A meaningful share of components are behind. Consider scheduling a remediation pass.',
  high: 'Significant version drift across many components. Upgrade effort will be substantial.',
  severe: 'Most components are far behind. Plan a phased upgrade.',
};

export function stalenessBreakdown(
  tiered: ReadonlyArray<Pick<TierResult, 'tier' | 'label' | 'weight'>>,
): StalenessBreakdown {
  const score = stalenessScore(tiered);
  const byTier = new Map<string, StalenessContribution>();
  for (const t of tiered) {
    const existing = byTier.get(t.tier);
    if (existing) {
      existing.count += 1;
      existing.contribution = round(existing.contribution + t.weight);
    } else {
      byTier.set(t.tier, {
        tier: t.tier,
        ...(t.label !== undefined && { label: t.label }),
        count: 1,
        weight: t.weight,
        contribution: round(t.weight),
      });
    }
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
