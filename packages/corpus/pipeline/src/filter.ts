/**
 * Stage 2 — filter.
 *
 * Cheap pre-filter so the AI stage doesn't read 800+ pages: keep sections
 * whose breadcrumb/heading matches a developer-relevant area, or whose text
 * matches a developer keyword. Recall-first — false positives are fine, the
 * AI stage (§4.4) discards them; a missed developer section is the only
 * real failure.
 *
 * Usage:
 *   node --experimental-strip-types pipeline/src/filter.ts v67
 *
 * Reads  work/v{NN}/sections.jsonl
 * Writes work/v{NN}/filtered.jsonl   (records + matchedBy reasons)
 *        work/v{NN}/filter-stats.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SectionRecord {
  heading: string;
  breadcrumb: string[];
  page: number;
  text: string;
}

/**
 * Area patterns — matched against breadcrumb elements AND the heading.
 * These mirror the release notes' own chapter taxonomy.
 */
const AREA_PATTERNS: [string, RegExp][] = [
  ['area:development', /\bdevelopment\b|\bdeveloper\b|dev channel/i],
  ['area:apex', /\bapex\b/i],
  // Named platform APIs only — a bare "API" in a feature title is usually a
  // product announcement, which the inclusion rule excludes.
  ['area:api', /\b(rest|soap|bulk|tooling|metadata|connect|graphql|ui) apis?\b|new and changed (objects|apis|standard platform events)|platform api version/i],
  ['area:lightning-components', /lightning (web )?component|lightning web security|\blws\b|\blwc\b|\baura\b/i],
  ['area:visualforce', /visualforce/i],
  // Flow RUNTIME, not Flow Builder UI features.
  ['area:flow-runtime', /flows? run|flow runtime|run mode|flow interview|flow version/i],
  // Auth MECHANISMS (what integrations break on) — not every feature that
  // mentions identity or certificates.
  ['area:auth', /authentication|\boauth\b|\bsso\b|\bsaml\b|\bmfa\b|\bjwt\b|connected app|external client app|named credential|mutual tls|\bmtls\b/i],
  ['area:packaging-metadata', /metadata (api|type)s?|change set|scratch org|\bsfdx\b|unlocked package|managed package|second-generation packag/i],
  ['area:soql', /\bsoql\b|\bsosl\b/i],
];

/**
 * Text keywords — matched against section text only. Deliberately specific: generic words like "update" would drag
 * the whole document in.
 */
const TEXT_PATTERNS: [string, RegExp][] = [
  ['kw:api-version', /\bapi version\b|\bapiversion\b|version \d{2}\.0\b/i],
  ['kw:apex', /\bapex\b/i],
  ['kw:soql-sosl', /\bsoql\b|\bsosl\b/i],
  ['kw:rest', /\brest api\b|\brest endpoint|connect rest/i],
  ['kw:soap', /\bsoap\b/i],
  ['kw:bulk-api', /\bbulk api\b/i],
  ['kw:tooling-metadata-api', /tooling api|metadata api/i],
  ['kw:deprecation', /deprecat/i],
  ['kw:retirement', /\bretir/i],
  ['kw:behavior-change', /behavior change|behaviour change|versioned behavior|breaking change/i],
  ['kw:lwc-aura', /lightning web component|aura component|\blwc\b/i],
  ['kw:visualforce', /visualforce/i],
  ['kw:flow-runtime', /flow run|flow version|run mode|flow interview/i],
  ['kw:auth', /\boauth\b|\bjwt\b|connected app|external client app|named credential/i],
  ['kw:packaging', /package\.xml|sfdx-project\.json|unlocked package|second-generation/i],
  ['kw:governor-limits', /governor limit|cpu time|heap size/i],
  ['kw:objects-fields', /new and changed objects|changed objects|new objects/i],
];

export interface FilterDecision {
  keep: boolean;
  matchedBy: string[];
}

export function classifySection(record: Pick<SectionRecord, 'heading' | 'breadcrumb' | 'text'>): FilterDecision {
  const matchedBy: string[] = [];
  const headingScope = [...record.breadcrumb, record.heading].join(' > ');
  for (const [name, re] of AREA_PATTERNS) {
    if (re.test(headingScope)) matchedBy.push(name);
  }
  for (const [name, re] of TEXT_PATTERNS) {
    if (re.test(record.text)) matchedBy.push(name);
  }

  // "Release Note Changes" weekly digests are a meta-changelog of the
  // document itself — every change they mention has its own section
  // elsewhere, so they only add duplicates.
  if (
    record.breadcrumb.some((b) => /release note changes/i.test(b)) ||
    /^week of /i.test(record.heading)
  ) {
    return { keep: false, matchedBy: ['excluded:release-note-changelog'] };
  }

  // Content-free leaves: "See Also" cross-reference stubs and near-empty
  // sections carry nothing for the AI stage — unless they're a one-line
  // deprecation/retirement notice (never dropped), or their heading sits in
  // a developer area (a stub like "New Connect in Apex Classes" anchors real
  // content around it).
  const isNotice = matchedBy.includes('kw:deprecation') || matchedBy.includes('kw:retirement');
  const areaMatched = matchedBy.some((m) => m.startsWith('area:'));
  // ("See Also" is excluded even when it mentions a retirement — it's a link
  // list; the section it links FROM is kept on its own merits.)
  if (/^see also$/i.test(record.heading.trim())) {
    return { keep: false, matchedBy: ['excluded:see-also'] };
  }
  if (!isNotice && !areaMatched && record.text.length < 80) {
    return { keep: false, matchedBy: ['excluded:empty'] };
  }

  return { keep: matchedBy.length > 0, matchedBy };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
const invokedDirectly = process.argv[1]?.endsWith('filter.ts') ?? false;
if (invokedDirectly) {
  const versionArg = process.argv.slice(2).find((a) => /^v\d{2}$/.test(a));
  if (!versionArg) {
    process.stderr.write('usage: filter.ts v67\n');
    process.exit(1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const workDir = join(here, '..', 'work', versionArg);

  const records: SectionRecord[] = readFileSync(join(workDir, 'sections.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as SectionRecord);

  const kept: (SectionRecord & { matchedBy: string[] })[] = [];
  const reasonCounts: Record<string, number> = {};
  for (const record of records) {
    const { keep, matchedBy } = classifySection(record);
    if (!keep) continue;
    for (const reason of matchedBy) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    kept.push({ ...record, matchedBy });
  }

  writeFileSync(
    join(workDir, 'filtered.jsonl'),
    kept.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  const ratio = records.length === 0 ? 0 : Math.round((1000 * kept.length) / records.length) / 10;
  const stats = {
    total: records.length,
    kept: kept.length,
    ratio: `${ratio}%`,
    targetMax: '25%',
    targetPass: ratio <= 25,
    reasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])),
  };
  writeFileSync(join(workDir, 'filter-stats.json'), JSON.stringify(stats, null, 2));
  process.stdout.write(
    `filter: ${versionArg}: kept ${kept.length}/${records.length} sections (${ratio}%)` +
      `${ratio <= 25 ? ' ✓ within the ≤25% target' : ' ✗ ABOVE the 25% target'}\n`,
  );
}
