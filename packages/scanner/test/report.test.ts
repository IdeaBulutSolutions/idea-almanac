import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { scanRepo } from '../src/adapters/repo.js';
import { loadSchedule } from '../src/core/tiering.js';
import { buildReport, type Report } from '../src/reporters/json.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'sample-sfdx-repo');
const snapshotPath = join(here, 'fixtures', 'expected-report.json');

const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'report.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateReport = ajv.compile(schema);

function buildFixtureReport(): Report {
  const schedule = loadSchedule();
  return buildReport(scanRepo(fixture), schedule, {
    mode: 'repo',
    target: { path: 'test/fixtures/sample-sfdx-repo' }, // normalized for snapshot stability
    scheduleSource: 'built-in retirement-schedule.json',
    scannerVersion: '0.0.0-snapshot',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('report assembly + schema', () => {
  const report = buildFixtureReport();

  it('validates against report.schema.json', () => {
    const ok = validateReport(report);
    expect(validateReport.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('every non-current, non-unknown item carries a tierLabel; dated tiers carry retirementDate', () => {
    for (const c of report.components) {
      if (c.tier === 'current' || c.tier === 'unknown') continue;
      expect(c.tierLabel, c.id).toBeDefined();
      if (c.tier === 'retired' || c.tier.startsWith('breaks-')) {
        expect(c.retirementDate, c.id).toBeDefined();
      }
    }
  });

  it('headlines are date-led, soonest first, counts matching tiers', () => {
    expect(report.headlines).toEqual([
      { date: '2025-06', count: 1, message: "1 item — Already failing - retired Summer '25 (REST 410 / SOAP 500 / Bulk 400)" },
      { date: '2028-06', count: 1, message: '1 item — Retires Summer \'28 (deprecated Summer \'27)' },
    ]);
  });

  it('components are ranked by tier urgency then ascending version', () => {
    const tiers = report.components.map((c) => c.tier);
    const firstStale = tiers.indexOf('stale');
    expect(tiers[0]).toBe('retired');
    expect(tiers[1]).toBe('breaks-2028');
    expect(firstStale).toBe(2);
    const staleVersions = report.components
      .filter((c) => c.tier === 'stale')
      .map((c) => Number.parseFloat(c.apiVersion ?? '0'));
    expect([...staleVersions].sort((a, b) => a - b)).toEqual(staleVersions);
  });

  it('reports the nearest non-breaking version (floor) from the built-in schedule', () => {
    // ≤30 retired, 31–40 breaks-2028, 41+ stale/current → 41.0 is the first non-dated tier.
    expect(report.nonBreakingFloor).toBe('41.0');
  });

  it('debt score matches the documented formula on the fixture', () => {
    // 1×retired(1.0) + 1×breaks-2028(0.7) + 7×stale(0.15) + 1×current(0) over 10 items
    // = 2.75/10 ≈ 27.5 — IEEE 754 puts the sum a hair under (2.7499…), so round() gives 27.
    expect(report.debtScore).toBe(27);
  });

  it('matches the committed snapshot (UPDATE_SNAPSHOT=1 to regenerate)', () => {
    if (process.env.UPDATE_SNAPSHOT === '1' || !existsSync(snapshotPath)) {
      writeFileSync(snapshotPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    expect(report).toEqual(expected);
  });
});
