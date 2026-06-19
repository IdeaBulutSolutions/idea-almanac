/**
 * Report assembly. The Report object is the single source of
 * truth for every reporter and prompt — headlines are pre-computed here so
 * all outputs show identical dates.
 */
import type { Inventory } from '../core/inventory.js';
import { assignTier, recommendedFloor, type Schedule, type TierResult } from '../core/tiering.js';
import { stalenessScore, stalenessBreakdown, REVIEW_ONLY_WEIGHT_FACTOR, type StalenessBreakdown } from '../core/score.js';

/** Flow, LWC, Aura — review-only types count at REVIEW_ONLY_WEIGHT_FACTOR in the score. */
const REVIEW_ONLY_COMPONENT_TYPES = new Set(['Flow', 'LWC', 'Aura']);

export const REPORT_SCHEMA_VERSION = '1.4.0';

export interface ReportComponent {
  id: string;
  type: string;
  /** Metadata API/developer name (e.g. "AccountTrigger"); friendlier than id/location. */
  name?: string;
  apiVersion: string | null;
  versionSource: 'explicit' | 'inherited';
  location: string;
  tier: string;
  tierLabel?: string;
  retirementDate?: string;
  severity?: 'critical' | 'high' | 'medium' | 'info';
}

export interface ReportIntegration {
  type: 'api-usage' | 'soap-login';
  clientName: string;
  apiFamily: string;
  apiVersion: string;
  requestCount?: number;
  tier: string;
  tierLabel?: string;
  retirementDate?: string;
  severity?: 'critical' | 'high' | 'medium' | 'info';
}

export interface Headline {
  date: string;
  count: number;
  message: string;
}

export interface Report {
  schemaVersion: string;
  generatedAt: string;
  scanner: { name: string; version: string };
  mode: 'repo' | 'org';
  /** `isSandbox` is present only on org scans; absent on repo scans and when the org denied the query. */
  target: { path?: string; org?: string; isSandbox?: boolean };
  schedule: { currentApiVersion: string; source: string };
  /** Lowest API version in the `current` tier — the recommended upgrade target. */
  recommendedFloor: string;
  stalenessScore: number;
  stalenessBreakdown: StalenessBreakdown;
  headlines: Headline[];
  summary: {
    totalComponents: number;
    totalIntegrations: number;
    byTier: Record<string, number>;
  };
  components: ReportComponent[];
  integrations: ReportIntegration[];
  warnings: { code: string; message: string; location?: string }[];
}

export interface BuildReportOptions {
  mode: 'repo' | 'org';
  target: { path?: string; org?: string };
  scheduleSource: string;
  scannerVersion: string;
  now?: Date;
}

export function buildReport(
  inventory: Inventory,
  schedule: Schedule,
  opts: BuildReportOptions,
): Report {
  const ruleOrder = new Map(schedule.rules.map((r, i) => [r.tier, i]));
  const tierRank = (tier: string) => ruleOrder.get(tier) ?? schedule.rules.length;

  const tiered: TierResult[] = [];

  const components: ReportComponent[] = inventory.items.map((item) => {
    const t = assignTier(item, schedule);
    const effectiveWeight = REVIEW_ONLY_COMPONENT_TYPES.has(item.type)
      ? t.weight * REVIEW_ONLY_WEIGHT_FACTOR
      : t.weight;
    tiered.push({ ...t, weight: effectiveWeight });
    return {
      id: item.id,
      type: item.type,
      ...(item.name !== undefined && { name: item.name }),
      apiVersion: item.apiVersion,
      versionSource: item.versionSource,
      location: item.location,
      tier: t.tier,
      ...(t.label !== undefined && { tierLabel: t.label }),
      // Metadata items never carry retirementDate — dated retirement applies only to
      // org-scan integration findings. This is enforced here regardless of
      // what the schedule rule returns, so future schedule edits can't accidentally
      // leak dates onto metadata components.
      ...(t.severity !== undefined && { severity: t.severity }),
    };
  });

  const integrations: ReportIntegration[] = inventory.integrations.map((finding) => {
    const t = assignTier(
      { apiVersion: finding.apiVersion, soapLogin: finding.type === 'soap-login' },
      schedule,
    );
    tiered.push(t);
    return {
      ...finding,
      tier: t.tier,
      ...(t.label !== undefined && { tierLabel: t.label }),
      ...(t.date !== undefined && { retirementDate: t.date }),
      ...(t.severity !== undefined && { severity: t.severity }),
    };
  });

  // Ranked: most urgent tier first, then lowest version first.
  components.sort(
    (a, b) =>
      tierRank(a.tier) - tierRank(b.tier) ||
      versionNum(a.apiVersion) - versionNum(b.apiVersion) ||
      a.id.localeCompare(b.id),
  );
  integrations.sort(
    (a, b) =>
      tierRank(a.tier) - tierRank(b.tier) ||
      versionNum(a.apiVersion) - versionNum(b.apiVersion) ||
      a.clientName.localeCompare(b.clientName),
  );

  const byTier: Record<string, number> = {};
  for (const entry of [...components, ...integrations]) {
    byTier[entry.tier] = (byTier[entry.tier] ?? 0) + 1;
  }

  // Headlines: one per dated (date, label) group, soonest date first.
  const groups = new Map<string, { date: string; label: string; count: number }>();
  for (const entry of [...components, ...integrations]) {
    if (entry.retirementDate === undefined) continue;
    const label = entry.tierLabel ?? entry.tier;
    const key = `${entry.retirementDate}|${label}`;
    const group = groups.get(key) ?? { date: entry.retirementDate, label, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const headlines: Headline[] = [...groups.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((g) => ({
      date: g.date,
      count: g.count,
      message: `${g.count} item${g.count === 1 ? '' : 's'} — ${g.label}`,
    }));

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    scanner: { name: 'idea-almanac', version: opts.scannerVersion },
    mode: opts.mode,
    target: {
      ...opts.target,
      ...(inventory.isSandbox !== undefined && { isSandbox: inventory.isSandbox }),
    },
    schedule: { currentApiVersion: schedule.currentApiVersion, source: opts.scheduleSource },
    recommendedFloor: recommendedFloor(schedule),
    stalenessScore: stalenessScore(tiered),
    stalenessBreakdown: stalenessBreakdown(tiered),
    headlines,
    summary: {
      totalComponents: components.length,
      totalIntegrations: integrations.length,
      byTier,
    },
    components,
    integrations,
    warnings: inventory.warnings,
  };
}

function versionNum(v: string | null): number {
  return v === null ? Number.POSITIVE_INFINITY : Number.parseFloat(v);
}

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
