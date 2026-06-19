/**
 * Action helper: turn an almanac JSON report into Action outputs, a
 * shields.io badge snippet, and a job-summary. Pure + side-effected only
 * through env-provided files, so it runs identically in CI and in a local test.
 *
 * Usage: node summarize.mjs <report.json> [report.md]
 *   - appends `staleness-score`, `far-behind-count`, `report-path`, `badge` to
 *     $GITHUB_OUTPUT (when set)
 *   - appends the markdown report + badge to $GITHUB_STEP_SUMMARY (when set)
 *   - always prints the badge snippet to stdout
 */
import { readFileSync, appendFileSync } from 'node:fs';

export function buildBadge(farBehindCount, stalenessScore) {
  // Static shields.io badge: "Almanac: N far-behind" (dynamic endpoint = Phase 5).
  const enc = (s) => encodeURIComponent(s).replace(/-/g, '--');
  const message = `${farBehindCount} far-behind`;
  const color = farBehindCount > 0 ? 'red' : stalenessScore > 30 ? 'orange' : stalenessScore > 0 ? 'yellow' : 'brightgreen';
  const url = `https://img.shields.io/badge/${enc('Almanac')}-${enc(message)}-${color}`;
  return `![Almanac](${url})`;
}

export function summarize(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const farBehindCount = report.summary?.byTier?.['far-behind'] ?? 0;
  const stalenessScore = report.stalenessScore ?? 0;
  return { farBehindCount, stalenessScore, badge: buildBadge(farBehindCount, stalenessScore) };
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  const mdPath = process.argv[3];
  if (!reportPath) {
    console.error('summarize.mjs: missing <report.json> argument');
    process.exit(2);
  }
  const { farBehindCount, stalenessScore, badge } = summarize(reportPath);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `staleness-score=${stalenessScore}\n` +
        `far-behind-count=${farBehindCount}\n` +
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

  console.log(`staleness-score=${stalenessScore} far-behind-count=${farBehindCount}`);
  console.log(`Badge snippet for your README:\n${badge}`);
}
