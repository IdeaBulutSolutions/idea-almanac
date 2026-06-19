import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeImpact,
  loadCorpus,
  renderImpactMarkdown,
  spanUnion,
  type CorpusEntry,
  type Corpus,
} from '../src/analysis/impact.ts';
import type { Report, ReportComponent } from '../src/reporters/json.ts';

const component = (over: Partial<ReportComponent>): ReportComponent => ({
  id: 'force-app/x.cls-meta.xml',
  type: 'ApexClass',
  apiVersion: '64.0',
  versionSource: 'explicit',
  location: 'force-app/x.cls-meta.xml',
  tier: 'stale',
  ...over,
});

const entry = (over: Partial<CorpusEntry>): CorpusEntry => ({
  id: 'v67-apex-001',
  apiVersion: '67.0',
  release: "Summer '26",
  changeType: 'changed',
  impact: 'breaking',
  affectedMetadataTypes: ['ApexClass'],
  behaviorArea: 'apex-runtime',
  appliesWhen: 'components compiled at API >= 67.0',
  summary: 'A breaking change for test purposes with enough length.',
  upgradeAction: 'Run the tests covering this path.',
  confidence: 'high',
  ...over,
});

const report = (components: ReportComponent[]): Report =>
  ({ components, integrations: [], summary: { byTier: {} } }) as unknown as Report;

const corpusOf = (byVersion: Record<number, CorpusEntry[]>): Corpus => ({
  files: new Map(
    Object.entries(byVersion).map(([v, entries]) => [
      Number(v),
      { apiVersion: `${v}.0`, release: "Summer '26", reviewed: true, entries },
    ]),
  ),
  warnings: [],
});

describe('impact layer — deterministic core', () => {
  it('computes the span union from the oldest component', () => {
    const comps = [component({ apiVersion: '63.0' }), component({ apiVersion: '65.0' })];
    expect(spanUnion(comps, 67)).toEqual([64, 65, 66, 67]);
  });

  it('uses introducedIn, not file placement, for span membership (REVIEW-LOG rest-015)', () => {
    // filed in v67 but behaviorally introduced in 65.0
    const e = entry({ id: 'v67-rest-015', introducedIn: '65.0', affectedMetadataTypes: ['Any'] });
    const corpus = corpusOf({ 67: [e] });
    // component already at 65.0 — does NOT cross the change
    const at65 = computeImpact(report([component({ apiVersion: '65.0' })]), corpus, 67);
    expect(at65.groups[0]!.entries).toHaveLength(0);
    // component at 64.0 — crosses it
    const at64 = computeImpact(report([component({ apiVersion: '64.0' })]), corpus, 67);
    expect(at64.groups[0]!.entries.map((x) => x.id)).toEqual(['v67-rest-015']);
  });

  it('separates org-wide entries from component-versioned ones and matches metadata types', () => {
    const versioned = entry({ id: 'v67-apex-001' });
    const orgWide = entry({
      id: 'v67-auth-003',
      appliesWhen: 'org-wide regardless of component API version',
      affectedMetadataTypes: ['Integration'],
      impact: 'retirement',
    });
    const otherType = entry({ id: 'v67-lwc-001', affectedMetadataTypes: ['LWC'] });
    const corpus = corpusOf({ 67: [versioned, orgWide, otherType] });
    const result = computeImpact(report([component({ apiVersion: '66.0' })]), corpus, 67);
    expect(result.groups[0]!.entries.map((x) => x.id)).toEqual(['v67-apex-001']);
    expect(result.orgWide.map((x) => x.id)).toEqual(['v67-auth-003']);
  });

  it('flags groups whose span reaches below corpus coverage', () => {
    const corpus = corpusOf({ 66: [], 67: [] }); // covers 66–67 only
    const result = computeImpact(
      report([component({ apiVersion: '60.0' }), component({ apiVersion: '65.0' })]),
      corpus,
      67,
    );
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0]).toMatchObject({ apiVersion: '60.0', missingFrom: 61 });
  });

  it('warns on missing and unreviewed corpus files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'almanac-corpus-'));
    writeFileSync(
      join(dir, 'v67.yaml'),
      'apiVersion: "67.0"\nrelease: "Summer \'26"\nreviewed: false\nentries: []\n',
    );
    const corpus = loadCorpus(dir, [66, 67]);
    expect(corpus.warnings.some((w) => w.includes('no v66.yaml'))).toBe(true);
    expect(corpus.warnings.some((w) => w.includes('not human-reviewed'))).toBe(true);
    expect(corpus.files.has(67)).toBe(true);
  });

  it('renders markdown where every finding cites an entry id (groundedness)', () => {
    const corpus = corpusOf({ 67: [entry({ id: 'v67-apex-001' })] });
    const result = computeImpact(
      report([
        component({ apiVersion: '66.0' }),
        component({ apiVersion: '66.0', type: 'Flow', id: 'f1' }),
      ]),
      corpus,
      67,
    );
    const md = renderImpactMarkdown(result, 'almanac-report.json');
    expect(md).toContain('v67-apex-001');
    expect(md).toContain('Test: Run the tests covering this path.');
    expect(md).toContain('Safe to upgrade now');
    expect(md).toContain('Flow @ 66.0 ×1');
  });

  it('handoff lists type/version corpus candidates and states the tool did not match them to code (E1)', () => {
    // v40 Apex class; corpus carries an Apex entry introduced in 41.0.
    const v41apex = entry({
      id: 'v41-apex-001',
      apiVersion: '41.0',
      release: "Winter '18",
      summary: 'API 41 changes how this Apex runtime behavior is evaluated at compile.',
    });
    const corpus = corpusOf({ 41: [v41apex] });
    const result = computeImpact(report([component({ apiVersion: '40.0' })]), corpus, 67);
    // the v41 Apex entry is selected into the component's group
    expect(result.groups[0]!.entries.map((x) => x.id)).toEqual(['v41-apex-001']);

    const md = renderImpactMarkdown(result, 'almanac-report.json');
    expect(md).toContain('v41-apex-001');
    // and the handoff states plainly the tool did not analyze the source
    expect(md).toContain('the tool does not analyze it');
    expect(md).toContain('Almanac did not read this source');
  });

  it('collapses republication chains to the freshest entry, citing superseded ids', () => {
    const origin = entry({
      id: 'v60-auth-005',
      apiVersion: '60.0',
      release: "Spring '24",
      appliesWhen: 'org-wide regardless of component API version',
      affectedMetadataTypes: ['Integration'],
      impact: 'breaking',
      summary: 'The legacy single-configuration SAML framework is being retired and orgs must migrate.',
    });
    const repub = entry({
      id: 'v67-auth-007',
      apiVersion: '67.0',
      introducedIn: '60.0',
      release: "Summer '26",
      appliesWhen: 'org-wide regardless of component API version',
      affectedMetadataTypes: ['Integration'],
      impact: 'breaking',
      summary: 'Orgs still on the legacy single-configuration SAML framework will lose SSO when retired.',
    });
    const unrelated = entry({
      id: 'v60-rest-001',
      apiVersion: '60.0',
      release: "Spring '24",
      appliesWhen: 'org-wide regardless of component API version',
      affectedMetadataTypes: ['Integration'],
      impact: 'retirement',
      summary: 'A completely different platform capability gets removed for every org this release.',
    });
    const corpus = corpusOf({ 60: [origin, unrelated], 67: [repub] });
    const result = computeImpact(report([component({ apiVersion: '59.0' })]), corpus, 67);
    expect(result.orgWide).toHaveLength(2);
    const saml = result.orgWide.find((e) => e.id === 'v67-auth-007')!;
    expect(saml.chainIds).toEqual(['v60-auth-005']); // freshest kept, origin cited
    const md = renderImpactMarkdown(result, 'r.json');
    expect(md).toContain('supersedes v60-auth-005');
  });

  it('ranks breaking above behavior-change above deprecation', () => {
    const corpus = corpusOf({
      67: [
        entry({
          id: 'v67-apex-003',
          impact: 'deprecation',
          summary: 'An old configuration field gets marked deprecated ahead of future removal plans.',
        }),
        entry({
          id: 'v67-apex-002',
          impact: 'behavior-change',
          summary: 'Runtime ordering of queued jobs shifts subtly under concurrent execution scenarios.',
        }),
        entry({
          id: 'v67-apex-001',
          impact: 'breaking',
          summary: 'Compilation fails for classes missing explicit access modifiers on overridden methods.',
        }),
      ],
    });
    const result = computeImpact(report([component({ apiVersion: '66.0' })]), corpus, 67);
    expect(result.groups[0]!.entries.map((x) => x.impact)).toEqual([
      'breaking',
      'behavior-change',
      'deprecation',
    ]);
  });
});

// ---------------------------------------------------------------------------
// E5: Flow / LWC / Aura receive review-only handoff; Apex gets full procedure
// ---------------------------------------------------------------------------

describe('E5 — review-only handoff for Flow/LWC/Aura vs full procedure for Apex', () => {
  const flowEntry = entry({
    id: 'v67-flow-001',
    affectedMetadataTypes: ['Flow'],
    summary: 'A platform change that affects how flows behave in a sandbox environment.',
  });
  const apexEntry = entry({
    id: 'v67-apex-e5',
    affectedMetadataTypes: ['ApexClass'],
    summary: 'A compilation change that requires explicit access modifiers on methods.',
  });
  const corpus = corpusOf({ 67: [flowEntry, apexEntry] });

  it('Flow group gets review-only note — no full-procedure instruction', () => {
    const result = computeImpact(
      report([component({ type: 'Flow', apiVersion: '66.0', id: 'flow1' })]),
      corpus,
      67,
    );
    const md = renderImpactMarkdown(result, 'r.json');
    expect(md).toContain('Review-only');
    expect(md).not.toContain('Full procedure');
  });

  it('ApexClass group gets full-procedure note — not review-only', () => {
    const result = computeImpact(
      report([component({ type: 'ApexClass', apiVersion: '66.0' })]),
      corpus,
      67,
    );
    const md = renderImpactMarkdown(result, 'r.json');
    expect(md).toContain('Full procedure');
    expect(md).not.toContain('Review-only');
  });
});
