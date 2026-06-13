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
