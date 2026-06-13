import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-sfdx-repo');
const tmp = () => mkdtempSync(join(tmpdir(), 'almanac-cli-'));

describe('almanac CLI', () => {
  it('scan writes JSON + HTML reports by default and exits 0', async () => {
    const cwd = tmp();
    const code = await run(['scan', fixture], cwd);
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'almanac-report.json'))).toBe(true);
    expect(existsSync(join(cwd, 'almanac-report.html'))).toBe(true);
    const report = JSON.parse(readFileSync(join(cwd, 'almanac-report.json'), 'utf8'));
    expect(report.summary.totalComponents).toBe(10);
  });

  it('--md writes the markdown report too', async () => {
    const cwd = tmp();
    const code = await run(['scan', fixture, '--md', 'report.md'], cwd);
    expect(code).toBe(0);
    expect(readFileSync(join(cwd, 'report.md'), 'utf8')).toContain('Almanac');
  });

  it('--fail-on retired exits 1 on the fixture (it has a v28 class)', async () => {
    const cwd = tmp();
    expect(await run(['scan', fixture, '--fail-on', 'retired'], cwd)).toBe(1);
  });

  it('--fail-on breaks-2027 exits 0 (repo mode cannot see SOAP logins)', async () => {
    const cwd = tmp();
    expect(await run(['scan', fixture, '--fail-on', 'breaks-2027'], cwd)).toBe(0);
  });

  it('--schedule overrides the built-in schedule file', async () => {
    const cwd = tmp();
    const customSchedule = join(cwd, 'schedule.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      customSchedule,
      JSON.stringify({
        currentApiVersion: '67.0',
        rules: [
          { tier: 'doomed', match: 'apiVersion <= 60.0', date: '2026-12', label: 'Custom', severity: 'critical', weight: 1 },
          { tier: 'current', match: 'else', weight: 0 },
        ],
      }),
    );
    const code = await run(['scan', fixture, '--schedule', customSchedule], cwd);
    expect(code).toBe(0);
    const report = JSON.parse(readFileSync(join(cwd, 'almanac-report.json'), 'utf8'));
    expect(report.summary.byTier.doomed).toBeGreaterThan(0);
  });

  it('--mode full-impact writes scan reports AND impact findings in one run', async () => {
    const cwd = tmp();
    const code = await run(['scan', fixture, '--mode', 'full-impact'], cwd);
    expect(code).toBe(0);
    // scan outputs
    expect(existsSync(join(cwd, 'almanac-report.json'))).toBe(true);
    expect(existsSync(join(cwd, 'almanac-report.html'))).toBe(true);
    // impact outputs (no LLM provider in tests → deterministic md + bundle)
    expect(existsSync(join(cwd, 'almanac-impact.md'))).toBe(true);
    expect(existsSync(join(cwd, 'almanac-impact-bundle.md'))).toBe(true);
  });

  it('--mode full-impact still honors --fail-on (exit 1 on the retired fixture)', async () => {
    const cwd = tmp();
    expect(await run(['scan', fixture, '--mode', 'full-impact', '--fail-on', 'retired'], cwd)).toBe(1);
  });

  it('--mode manager writes the manager + effort-estimate bundles (and impact)', async () => {
    const cwd = tmp();
    const code = await run(['scan', fixture, '--mode', 'manager'], cwd);
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'almanac-impact.md'))).toBe(true);
    expect(existsSync(join(cwd, 'almanac-manager-bundle.md'))).toBe(true);
    expect(existsSync(join(cwd, 'almanac-estimate-bundle.md'))).toBe(true);
    // estimate bundle embeds the impact findings
    expect(readFileSync(join(cwd, 'almanac-estimate-bundle.md'), 'utf8')).toContain('Upgrade-impact findings');
  });

  it('--mode full also writes the agent upgrade-guide bundle', async () => {
    const cwd = tmp();
    const code = await run(['scan', fixture, '--mode', 'full'], cwd);
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'almanac-upgrade-guide-bundle.md'))).toBe(true);
  });

  it('unknown --mode is a one-line error (exit 2)', async () => {
    expect(await run(['scan', fixture, '--mode', 'bogus'], tmp())).toBe(2);
  });

  it('--limit caps the review subset but leaves the scan report complete', async () => {
    const cwd = tmp();
    const code = await run(['scan', fixture, '--mode', 'impact', '--no-llm', '--limit', '3'], cwd);
    expect(code).toBe(0);
    // Scan report keeps every component…
    const report = JSON.parse(readFileSync(join(cwd, 'almanac-report.json'), 'utf8'));
    expect(report.components.length).toBe(10);
    // …but the AI review bundle only carries the top-3 most urgent.
    const bundle = readFileSync(join(cwd, 'almanac-impact-bundle.md'), 'utf8');
    expect((bundle.match(/"id":/g) ?? []).length).toBe(3);
  });

  it('impact artifacts carry the AI / test-before-deploy disclaimer', async () => {
    const cwd = tmp();
    await run(['scan', fixture, '--mode', 'impact', '--no-llm'], cwd);
    for (const f of ['almanac-impact.md', 'almanac-impact-bundle.md']) {
      const text = readFileSync(join(cwd, f), 'utf8');
      expect(text).toContain('Disclaimer');
      expect(text).toMatch(/Idea Bulut Solutions is not liable/i);
      expect(text).toMatch(/before deploying/i);
    }
  });

  it('--org is a clear not-yet error (exit 2), not a crash', async () => {
    expect(await run(['scan', '--org', 'myorg'], tmp())).toBe(2);
  });

  it('impact is a clear not-yet error (exit 2)', async () => {
    expect(await run(['impact', '--report', 'x.json'], tmp())).toBe(2);
  });

  it('unknown command exits 2', async () => {
    expect(await run(['frobnicate'], tmp())).toBe(2);
  });

  it('nonexistent path exits 2', async () => {
    expect(await run(['scan', '/definitely/not/a/path'], tmp())).toBe(2);
  });

  it('unknown flag is a one-line error (exit 2), never a stack trace', async () => {
    // parseArgs throws on unknown options; the CLI must catch it.
    expect(await run(['scan', '--bogus'], tmp())).toBe(2);
  });

  it('--version prints the version and exits 0', async () => {
    expect(await run(['--version'], tmp())).toBe(0);
  });
});
