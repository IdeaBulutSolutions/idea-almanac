/**
 * Impact layer — deterministic core.
 *
 * `almanac impact --report almanac-report.json --target 67.0`
 *
 * A deterministic, fully grounded rendering:
 *   1. For each non-current component, compute the version span
 *      `(componentVersion, target]`.
 *   2. Load ONLY corpus files for versions in the union of spans; warn on
 *      missing/unreviewed versions.
 *   3. (deterministic) Per component-group findings ranked by impact, each
 *      citing entry ids — every claim IS a corpus entry, so the groundedness
 *      gate holds by construction. The optional LLM narrative layers on top
 *      later; this output is also the input bundle for the `--no-llm`
 *      assistant-handoff mode.
 *
 * Span math uses `introducedIn ?? apiVersion` (schema 1.1.0): republished
 * entries sit in a later file than their behavioral version, and file
 * placement must NOT decide span membership (REVIEW-LOG rest-015).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Report, ReportComponent } from '../reporters/json.js';

// ---------------------------------------------------------------------------
// Corpus types (subset of change-entry.schema.json the impact layer reads)
// ---------------------------------------------------------------------------

export interface CorpusEntry {
  id: string;
  apiVersion: string;
  introducedIn?: string;
  release: string;
  changeType: string;
  impact: 'breaking' | 'behavior-change' | 'deprecation' | 'retirement' | 'additive';
  affectedMetadataTypes: string[];
  behaviorArea: string;
  appliesWhen: string;
  summary: string;
  detail?: string;
  upgradeAction?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CorpusFile {
  apiVersion: string;
  release: string;
  reviewed?: boolean;
  entries: CorpusEntry[];
}

export interface Corpus {
  files: Map<number, CorpusFile>; // keyed by numeric version (65 for "65.0")
  warnings: string[];
}

/** Versions (numeric) in the union of `(componentVersion, target]` spans. */
export function spanUnion(components: ReportComponent[], target: number): number[] {
  let lowest = target;
  for (const c of components) {
    if (c.apiVersion === null) continue;
    const v = Number.parseFloat(c.apiVersion);
    if (v < lowest) lowest = v;
  }
  const versions: number[] = [];
  for (let v = Math.floor(lowest) + 1; v <= target; v++) versions.push(v);
  return versions;
}

export function loadCorpus(dataDir: string, versions: number[]): Corpus {
  const files = new Map<number, CorpusFile>();
  const warnings: string[] = [];
  const missing: number[] = [];
  for (const v of versions) {
    const path = join(dataDir, `v${v}.yaml`);
    if (!existsSync(path)) {
      missing.push(v);
      continue;
    }
    const doc = parseYaml(readFileSync(path, 'utf8')) as CorpusFile;
    if (doc.reviewed !== true) {
      warnings.push(`v${v}.yaml is not human-reviewed — findings from it are provisional`);
    }
    files.set(v, doc);
  }
  for (const range of contiguousRanges(missing)) {
    warnings.push(
      range[0] === range[1]
        ? `corpus has no v${range[0]}.yaml — changes introduced in ${range[0]}.0 are not covered`
        : `corpus has no v${range[0]}–v${range[1]} files — changes introduced in ${range[0]}.0–${range[1]}.0 are not covered`,
    );
  }
  return { files, warnings };
}

function contiguousRanges(sorted: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const v of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && v === last[1] + 1) last[1] = v;
    else ranges.push([v, v]);
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Span query
// ---------------------------------------------------------------------------

/** Report component type → corpus affectedMetadataTypes value. */
const TYPE_MAP: Record<string, string> = {
  ApexClass: 'ApexClass',
  ApexTrigger: 'ApexTrigger',
  Flow: 'Flow',
  LWC: 'LWC',
  Aura: 'AuraDefinitionBundle',
  VisualforcePage: 'VisualforcePage',
  VisualforceComponent: 'VisualforceComponent',
};

const IMPACT_RANK: Record<CorpusEntry['impact'], number> = {
  breaking: 0,
  'behavior-change': 1,
  retirement: 2,
  deprecation: 3,
  additive: 4,
};

export const effectiveVersion = (e: CorpusEntry): number =>
  Number.parseFloat(e.introducedIn ?? e.apiVersion);

export const isOrgWide = (e: CorpusEntry): boolean => /org-wide/i.test(e.appliesWhen);

export interface ComponentGroupFinding {
  type: string;
  apiVersion: string;
  componentCount: number;
  components: string[]; // ids (capped in rendering, complete here)
  entries: CollapsedEntry[]; // ranked, component-versioned only, chains collapsed
}

export interface ImpactResult {
  target: number;
  groups: ComponentGroupFinding[]; // groups with ≥1 finding, plus clean groups (entries: [])
  orgWide: CollapsedEntry[]; // ranked org-wide changes across the span union, chains collapsed
  uncovered: { type: string; apiVersion: string; componentCount: number; missingFrom: number }[];
  warnings: string[];
}

const rank = (a: CorpusEntry, b: CorpusEntry): number =>
  IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] ||
  effectiveVersion(a) - effectiveVersion(b) ||
  a.id.localeCompare(b.id);

// ---------------------------------------------------------------------------
// Chain collapsing — the corpus keeps every republication of a long-running
// release update (REVIEW-LOG 2026-06-10 dedup policy: KEEP ALL, each with
// introducedIn). For rendering, collapse same-origin near-identical entries
// to the FRESHEST republication (latest file carries the current enforcement
// date) and cite the superseded ids alongside.
// ---------------------------------------------------------------------------

export interface CollapsedEntry extends CorpusEntry {
  /** ids of earlier republications collapsed into this entry. */
  chainIds: string[];
}

const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

const jaccard = (a: Set<string>, b: Set<string>): number => {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

export function collapseChains(entries: CorpusEntry[], threshold = 0.55): CollapsedEntry[] {
  // bucket by effective version — chain members share an origin by definition
  const buckets = new Map<number, CorpusEntry[]>();
  for (const e of entries) {
    const v = effectiveVersion(e);
    const list = buckets.get(v) ?? [];
    list.push(e);
    buckets.set(v, list);
  }
  const out: CollapsedEntry[] = [];
  for (const list of buckets.values()) {
    const toks = list.map((e) => tokens(`${e.summary} ${e.behaviorArea}`));
    const used = new Array<boolean>(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const chain = [i];
      for (let j = i + 1; j < list.length; j++) {
        if (!used[j] && jaccard(toks[i]!, toks[j]!) > threshold) {
          chain.push(j);
          used[j] = true;
        }
      }
      // freshest = highest file apiVersion (latest republication)
      chain.sort(
        (x, y) =>
          Number.parseFloat(list[y]!.apiVersion) - Number.parseFloat(list[x]!.apiVersion),
      );
      const head = list[chain[0]!]!;
      out.push({ ...head, chainIds: chain.slice(1).map((k) => list[k]!.id) });
    }
  }
  return out.sort(rank);
}

export function computeImpact(report: Report, corpus: Corpus, target: number): ImpactResult {
  const warnings = [...corpus.warnings];
  const allEntries: CorpusEntry[] = [];
  for (const f of corpus.files.values()) allEntries.push(...f.entries);

  const covered = new Set(corpus.files.keys());
  const lowestCovered = covered.size > 0 ? Math.min(...covered) : target + 1;

  // group components by (type, apiVersion)
  const groupsMap = new Map<string, ReportComponent[]>();
  for (const c of report.components) {
    if (c.apiVersion === null || TYPE_MAP[c.type] === undefined) continue;
    const v = Number.parseFloat(c.apiVersion);
    if (v >= target) continue; // already at/over target
    const key = `${c.type}@${c.apiVersion}`;
    const list = groupsMap.get(key) ?? [];
    list.push(c);
    groupsMap.set(key, list);
  }

  const groups: ComponentGroupFinding[] = [];
  const uncovered: ImpactResult['uncovered'] = [];
  for (const [, comps] of [...groupsMap.entries()].sort()) {
    const { type, apiVersion } = comps[0]!;
    const compVer = Number.parseFloat(apiVersion!);
    const metadataType = TYPE_MAP[type]!;
    // span (compVer, target] fully covered only when corpus has every version
    // from floor(compVer)+1 up — report partial coverage honestly.
    if (Math.floor(compVer) + 1 < lowestCovered) {
      uncovered.push({
        type,
        apiVersion: apiVersion!,
        componentCount: comps.length,
        missingFrom: Math.floor(compVer) + 1,
      });
    }
    const entries = collapseChains(
      allEntries.filter(
        (e) =>
          !isOrgWide(e) &&
          effectiveVersion(e) > compVer &&
          effectiveVersion(e) <= target &&
          (e.affectedMetadataTypes.includes('Any') ||
            e.affectedMetadataTypes.includes(metadataType)),
      ),
    );
    groups.push({
      type,
      apiVersion: apiVersion!,
      componentCount: comps.length,
      components: comps.map((c) => c.id),
      entries,
    });
  }

  const typesPresent = new Set(
    report.components.map((c) => TYPE_MAP[c.type]).filter((t): t is string => t !== undefined),
  );
  const orgWide = collapseChains(
    allEntries.filter(
      (e) =>
        isOrgWide(e) &&
        e.impact !== 'additive' &&
        (e.affectedMetadataTypes.includes('Any') ||
          e.affectedMetadataTypes.some((t) => typesPresent.has(t) || t === 'Integration')),
    ),
  );

  return { target, groups, orgWide, uncovered, warnings };
}

// ---------------------------------------------------------------------------
// Rendering — almanac-impact.md (grounded by construction: every line cites ids)
// ---------------------------------------------------------------------------

const MAX_LISTED_COMPONENTS = 8;

export function renderImpactMarkdown(result: ImpactResult, reportPath: string): string {
  const out: string[] = [];
  const dirty = result.groups.filter((g) => g.entries.length > 0);
  const clean = result.groups.filter((g) => g.entries.length === 0);

  out.push(`# Upgrade impact — target API ${result.target.toFixed(1)}`);
  out.push('');
  out.push(`Source report: \`${reportPath}\`. Every finding cites corpus entry ids;`);
  out.push('see `upgradeAction` per entry for what to test.');
  out.push('');

  if (result.warnings.length > 0) {
    out.push('## Coverage warnings');
    out.push('');
    for (const w of result.warnings) out.push(`- ${w}`);
    out.push('');
  }

  if (result.uncovered.length > 0) {
    out.push('## Not fully assessable (corpus gap)');
    out.push('');
    for (const u of result.uncovered) {
      out.push(
        `- **${u.type} @ ${u.apiVersion}** ×${u.componentCount} — needs corpus back to v${u.missingFrom}`,
      );
    }
    out.push('');
  }

  out.push('## Component groups');
  out.push('');
  for (const g of dirty) {
    out.push(`### ${g.type} @ ${g.apiVersion} ×${g.componentCount}`);
    out.push('');
    const listed = g.components.slice(0, MAX_LISTED_COMPONENTS);
    out.push(
      `Components: ${listed.map((c) => `\`${c}\``).join(', ')}${g.components.length > listed.length ? ` … +${g.components.length - listed.length} more` : ''}`,
    );
    out.push('');
    // Low-confidence entries render in a separate trailing block so weak
    // provenance never visually blends into the firm findings.
    const firm = g.entries.filter((e) => e.confidence !== 'low');
    const weak = g.entries.filter((e) => e.confidence === 'low');
    for (const e of firm) {
      out.push(`- **[${e.impact}]** ${e.summary} _(${cite(e)})_`);
      if (e.upgradeAction !== undefined) out.push(`  - Test: ${e.upgradeAction}`);
    }
    if (weak.length > 0) {
      out.push('');
      out.push('<details><summary>Weak provenance (low extraction confidence — verify against the release notes)</summary>');
      out.push('');
      for (const e of weak) {
        out.push(`- **[${e.impact}]** ${e.summary} _(${cite(e)})_`);
        if (e.upgradeAction !== undefined) out.push(`  - Test: ${e.upgradeAction}`);
      }
      out.push('');
      out.push('</details>');
    }
    out.push('');
  }

  if (clean.length > 0) {
    out.push('### Safe to upgrade now (no versioned changes recorded in covered span)');
    out.push('');
    for (const g of clean) {
      out.push(`- ${g.type} @ ${g.apiVersion} ×${g.componentCount}`);
    }
    out.push('');
  }

  if (result.orgWide.length > 0) {
    out.push('## Org-wide changes in span (apply regardless of component version)');
    out.push('');
    for (const e of result.orgWide) {
      out.push(`- **[${e.impact}]** ${e.summary} _(${cite(e)})_`);
    }
    out.push('');
  }

  return out.join('\n');
}

/** Citation: kept entry id + collapsed chain ids (groundedness: all ids are real). */
function cite(e: CollapsedEntry): string {
  const low = e.confidence === 'low' ? ', low confidence' : '';
  const chain = e.chainIds.length > 0 ? `; supersedes ${e.chainIds.join(', ')}` : '';
  return `${e.id}, ${e.release}${low}${chain}`;
}
