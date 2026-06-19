/**
 * Human report: ONE self-contained HTML file. Inline CSS only —
 * no CDN, no JS, no external resources.
 *
 * Components are grouped into native <details> sections per API version
 * (collapsible without JavaScript); a per-metadata-type overview sits above.
 * Retirement dates appear only on integration findings (never on metadata
 * components — that invariant is enforced upstream in json.ts).
 */
import type { Report, ReportComponent } from './json.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#b3261e',
  high: '#b45309',
  medium: '#a16207',
  info: '#52525b',
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 };

function fmtDate(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m)] ?? m} ${y}`;
}

const dot = (severity?: string): string =>
  `<span class="sev" style="background:${SEVERITY_COLOR[severity ?? ''] ?? '#16a34a'}"></span>`;

function worst(components: ReportComponent[]): ReportComponent {
  return [...components].sort(
    (a, b) => (SEVERITY_RANK[a.severity ?? 'info'] ?? 9) - (SEVERITY_RANK[b.severity ?? 'info'] ?? 9),
  )[0]!;
}

function componentRows(components: ReportComponent[], showDate: boolean): string {
  return components
    .map(
      (c) => `<tr>
      <td>${dot(c.severity)}${esc(c.tier)}</td>
      ${showDate ? `<td>${c.retirementDate ? esc(fmtDate(c.retirementDate)) : ''}</td>` : ''}
      <td>${esc(c.type)}</td>
      <td>${esc(c.name ?? '')}</td>
      <td class="loc">${esc(c.location)}${c.versionSource === 'inherited' ? ' <em>(inherited)</em>' : ''}</td>
    </tr>`,
    )
    .join('\n');
}

function byTypeOverview(components: ReportComponent[]): string {
  const byType = new Map<string, ReportComponent[]>();
  for (const c of components) {
    const list = byType.get(c.type) ?? [];
    list.push(c);
    byType.set(c.type, list);
  }
  const rows = [...byType.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([type, comps]) => {
      const versions = comps
        .map((c) => c.apiVersion)
        .filter((v): v is string => v !== null)
        .map(Number.parseFloat);
      const oldest = versions.length > 0 ? Math.min(...versions).toFixed(1) : '?';
      const w = worst(comps);
      return `<tr>
      <td>${esc(type)}</td>
      <td>${comps.length}</td>
      <td>${oldest}</td>
      <td>${dot(w.severity)}${esc(w.tier)}${w.retirementDate ? ` (${esc(fmtDate(w.retirementDate))})` : ''}</td>
    </tr>`;
    })
    .join('\n');
  return `<table>
    <thead><tr><th>Type</th><th>Components</th><th>Oldest API version</th><th>Worst tier</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function byVersionSections(components: ReportComponent[]): string {
  const byVersion = new Map<string, ReportComponent[]>();
  for (const c of components) {
    const key = c.apiVersion ?? 'unknown';
    const list = byVersion.get(key) ?? [];
    list.push(c);
    byVersion.set(key, list);
  }
  return [...byVersion.entries()]
    .sort(([a], [b]) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return Number.parseFloat(a) - Number.parseFloat(b); // oldest (scariest) first
    })
    .map(([version, comps]) => {
      const w = worst(comps);
      const dated = w.retirementDate !== undefined;
      const typeCounts = new Map<string, number>();
      for (const c of comps) typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
      const typeSummary = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${esc(t)} ×${n}`)
        .join(' · ');
      // Only show a Date column when at least one row in this group is dated —
      // otherwise every cell is empty and the column is just noise.
      const showDate = comps.some((c) => c.retirementDate !== undefined);
      return `<details${dated ? ' open' : ''}>
    <summary>${dot(w.severity)}<strong>API ${esc(version)}</strong>
      <span class="count">${comps.length} component${comps.length === 1 ? '' : 's'}</span>
      <span class="tier">${esc(w.tier)}${w.retirementDate ? ` · retires ${esc(fmtDate(w.retirementDate))}` : ''}</span>
      <span class="types">${typeSummary}</span>
    </summary>
    <table>
      <thead><tr><th>Tier</th>${showDate ? '<th>Date</th>' : ''}<th>Type</th><th>Name</th><th>Location</th></tr></thead>
      <tbody>
${componentRows(comps, showDate)}
      </tbody>
    </table>
  </details>`;
    })
    .join('\n');
}

const BAND_COLOR: Record<string, string> = {
  clean: '#16a34a',
  low: '#15803d',
  moderate: '#a16207',
  high: '#b45309',
  severe: '#b3261e',
};

/** Explain the staleness score: what the number means, whether it's good/bad, and the math behind it. */
function scoreExplanation(report: Report): string {
  const b = report.stalenessBreakdown;
  if (!b) return '';
  const color = BAND_COLOR[b.band] ?? '#52525b';
  const rows = b.contributions
    .map(
      (c) => `<tr>
      <td>${esc(c.label ?? c.tier)}</td>
      <td>${c.count}</td>
      <td>${c.weight}</td>
      <td>${c.contribution}</td>
    </tr>`,
    )
    .join('\n');
  return `<details class="score-why" open>
    <summary>Staleness score <strong>${report.stalenessScore}</strong>
      <span class="band" style="background:${color}">${esc(b.band)}</span>
      <span class="count">— how this is calculated</span>
    </summary>
    <div class="score-body">
      <p>${esc(b.interpretation)}</p>
      <p class="meta">Score = <code>${esc(b.formula)}</code>. Weighted sum ${b.weightedSum} over ${b.totalItems} item${b.totalItems === 1 ? '' : 's'} → ${report.stalenessScore}.</p>
      <table>
        <thead><tr><th>Tier</th><th>Items</th><th>Weight</th><th>Contribution</th></tr></thead>
        <tbody>${rows}
        <tr class="total"><td>Total</td><td>${b.totalItems}</td><td></td><td>${b.weightedSum}</td></tr>
        </tbody>
      </table>
      <p class="meta">Bands: 0 clean · 1–10 low · 11–30 moderate · 31–60 high · 61+ severe. The score is a weighted average of version drift — use it to track progress and prioritize upgrade passes.</p>
    </div>
  </details>`;
}

/** Recommended floor hint — shown only when there are dated integration findings below the floor. */
function floorHint(report: Report): string {
  const floor = report.recommendedFloor;
  if (!floor) return '';
  const floorNum = Number.parseFloat(floor);
  const atRisk = report.components.filter(
    (c) => c.retirementDate !== undefined && c.apiVersion !== null && Number.parseFloat(c.apiVersion) < floorNum,
  );
  if (atRisk.length === 0) return '';
  return `<div class=”floor-hint”>💡 <strong>Recommended floor: API ${esc(floor)}.</strong>
    ${atRisk.length} component${atRisk.length === 1 ? '' : 's'} sit below it in a dated retirement tier —
    moving ${atRisk.length === 1 ? 'it' : 'them'} to at least API ${esc(floor)} removes the dated retirement risk.
    (That lands ${atRisk.length === 1 ? 'it' : 'them'} in the “behind” tier, not yet fully current — but the dated risk is gone.)</div>`;
}

export function renderHtml(report: Report): string {
  const banner =
    report.headlines.length === 0
      ? `<div class="banner clean">✅ No dated API retirement items.</div>`
      : `<div class="banner">⚠ ${report.headlines
          .map((h) => `${esc(h.message)} (${fmtDate(h.date)})`)
          .join(' · ')}</div>`;

  const tiles = `
  <div class="tiles">
    <div class="tile"><div class="num">${report.stalenessScore}</div><div class="lbl">staleness score (0 = clean)</div></div>
    <div class="tile"><div class="num">${report.summary.totalComponents}</div><div class="lbl">components</div></div>
    <div class="tile"><div class="num">${report.summary.totalIntegrations}</div><div class="lbl">integrations</div></div>
    ${Object.entries(report.summary.byTier)
      .map(
        ([tier, count]) =>
          `<div class="tile"><div class="num">${count}</div><div class="lbl">${esc(tier)}</div></div>`,
      )
      .join('\n    ')}
  </div>`;

  const scoreSection = scoreExplanation(report);

  const integrationSection =
    report.integrations.length === 0
      ? `<p class="muted">No integration findings${report.mode === 'repo' ? ' (repo mode does not inspect API usage logs)' : ''}.</p>`
      : `<table>
    <thead><tr><th>Tier</th><th>Date</th><th>Client</th><th>API family</th><th>Version</th><th>Requests</th></tr></thead>
    <tbody>
    ${report.integrations
      .map(
        (i) => `<tr>
        <td>${dot(i.severity)}${esc(i.tier)}</td>
        <td>${i.retirementDate ? esc(fmtDate(i.retirementDate)) : ''}</td>
        <td>${esc(i.clientName)}</td>
        <td>${esc(i.apiFamily)}${i.type === 'soap-login' ? ' <strong>login()</strong>' : ''}</td>
        <td>${esc(i.apiVersion)}</td>
        <td>${i.requestCount ?? '—'}</td>
      </tr>`,
      )
      .join('\n')}
    </tbody>
  </table>`;

  const warningsSection =
    report.warnings.length === 0
      ? ''
      : `<h2>Warnings</h2><ul>${report.warnings
          .map((w) => `<li><code>${esc(w.code)}</code> ${esc(w.message)}${w.location ? ` — <code>${esc(w.location)}</code>` : ''}</li>`)
          .join('\n')}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Almanac — API version maintenance report</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; color: #1c1c1e; background: #fafaf9; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
  .banner { background: #b3261e; color: #fff; padding: 16px 20px; border-radius: 8px; font-size: 1.1rem; font-weight: 600; margin: 16px 0 24px; }
  .banner.clean { background: #16a34a; }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }
  .tile { background: #fff; border: 1px solid #e5e5e3; border-radius: 8px; padding: 12px 18px; min-width: 96px; }
  .tile .num { font-size: 1.6rem; font-weight: 700; }
  .tile .lbl { font-size: 0.75rem; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e5e3; border-radius: 8px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ececea; font-size: 0.9rem; }
  th { background: #f4f4f2; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
  td.loc { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.8rem; }
  .sev { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; }
  .muted { color: #777; }
  h1 { font-size: 1.4rem; margin-bottom: 0; }
  h2 { font-size: 1.05rem; margin-top: 32px; }
  .meta { color: #777; font-size: 0.8rem; }
  details { background: #fff; border: 1px solid #e5e5e3; border-radius: 8px; margin: 10px 0; }
  details > summary { cursor: pointer; padding: 10px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; user-select: none; }
  details > summary:hover { background: #f4f4f2; border-radius: 8px; }
  details[open] > summary { border-bottom: 1px solid #ececea; }
  details > table { border: none; }
  summary .count { color: #555; font-size: 0.85rem; }
  summary .tier { color: #555; font-size: 0.85rem; font-weight: 600; }
  summary .types { color: #888; font-size: 0.78rem; margin-left: auto; }
  .score-why { margin: -8px 0 28px; }
  .score-why .band { color: #fff; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; }
  .score-body { padding: 4px 14px 14px; }
  .score-body table { margin-top: 8px; }
  .score-body tr.total td { font-weight: 700; border-top: 2px solid #ececea; }
  .floor-hint { background: #eef2ff; border: 1px solid #c7d2fe; color: #1e293b; padding: 12px 16px; border-radius: 8px; margin: 0 0 20px; font-size: 0.92rem; line-height: 1.45; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e3; color: #777; font-size: 0.85rem; }
  footer a { color: #4f46e5; }
</style>
</head>
<body>
<main>
  <h1>Almanac — API version maintenance report</h1>
  <p class="meta">Mode: ${esc(report.mode)} · Target: ${esc(report.target.path ?? report.target.org ?? '')} · Current API version: ${esc(report.schedule.currentApiVersion)} · Generated: ${esc(report.generatedAt)}</p>
  ${banner}
  ${floorHint(report)}
  ${tiles}
  ${scoreSection}
  <h2>By metadata type</h2>
  ${byTypeOverview(report.components)}
  <h2>Components by API version <span class="muted" style="font-weight:400;font-size:0.8rem">(oldest first — click to expand)</span></h2>
  ${byVersionSections(report.components)}
  <h2>Integrations</h2>
  ${integrationSection}
  ${warningsSection}
  <footer>
    Generated by <strong>Almanac</strong> (idea-almanac ${esc(report.scanner.version)}).
    Need help fixing what this found? <a href="https://ideabulut.com">Idea Bulut Solutions</a> does API-version remediation.
    For an AI-assisted upgrade impact review, see the <code>upgrade-impact-review</code> prompt shipped with the scanner.
  </footer>
</main>
</body>
</html>
`;
}
