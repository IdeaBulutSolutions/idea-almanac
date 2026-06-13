/**
 * Action helper: turn an almanac JSON report into Action outputs, a
 * shields.io badge snippet, and a job-summary. Pure + side-effected only
 * through env-provided files, so it runs identically in CI and in a local test.
 *
 * Usage: node summarize.mjs <report.json> [report.md]
 *   - appends `debt-score`, `retired-count`, `report-path`, `badge` to
 *     $GITHUB_OUTPUT (when set)
 *   - appends the markdown report + badge to $GITHUB_STEP_SUMMARY (when set)
 *   - always prints the badge snippet to stdout
 */
import { readFileSync, appendFileSync } from 'node:fs';

export function buildBadge(retiredCount, debtScore) {
  // Static shields.io badge: "API debt: N retired" (dynamic endpoint = Phase 5).
  const enc = (s) => encodeURIComponent(s).replace(/-/g, '--');
  const message = `${retiredCount} retired`;
  const color = retiredCount > 0 ? 'red' : debtScore > 30 ? 'orange' : debtScore > 0 ? 'yellow' : 'brightgreen';
  const url = `https://img.shields.io/badge/${enc('API debt')}-${enc(message)}-${color}`;
  return `![Almanac API debt](${url})`;
}

export function summarize(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const retiredCount = report.summary?.byTier?.retired ?? 0;
  const debtScore = report.debtScore ?? 0;
  return { retiredCount, debtScore, badge: buildBadge(retiredCount, debtScore) };
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  const mdPath = process.argv[3];
  if (!reportPath) {
    console.error('summarize.mjs: missing <report.json> argument');
    process.exit(2);
  }
  const { retiredCount, debtScore, badge } = summarize(reportPath);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `debt-score=${debtScore}\n` +
        `retired-count=${retiredCount}\n` +
        `report-path=${reportPath}\n` +
        `badge=${badge}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    let body = '';
    if (mdPath) {
      try {
        body += readFileSync(mdPath, 'utf8') + '\n\n';
      } catch {
        /* md optional */
      }
    }
    body += `**Badge snippet for your README**\n\n\`${badge}\`\n`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  }

  console.log(`debt-score=${debtScore} retired-count=${retiredCount}`);
  console.log(`Badge snippet for your README:\n${badge}`);
}
