import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { scanRepo } from '../src/adapters/repo.js';
import { loadSchedule } from '../src/core/tiering.js';
import { buildReport, type Report } from '../src/reporters/json.js';
import type { Inventory } from '../src/core/inventory.js';

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

  it('every non-current, non-unknown item carries a tierLabel; repo scan components carry no retirementDate', () => {
    for (const c of report.components) {
      if (c.tier === 'current' || c.tier === 'unknown') continue;
      expect(c.tierLabel, c.id).toBeDefined();
      // Repo scan: no component should carry a retirementDate (dated tiers are org-integration only).
      expect(c.retirementDate, c.id).toBeUndefined();
    }
  });

  it('repo scan produces no dated headlines', () => {
    expect(report.headlines).toEqual([]);
  });

  it('components are ranked by tier urgency then ascending version', () => {
    const tiers = report.components.map((c) => c.tier);
    const firstBehind = tiers.indexOf('behind');
    expect(tiers[0]).toBe('far-behind');
    expect(tiers[6]).toBe('far-behind');
    expect(firstBehind).toBe(7);
    const behindVersions = report.components
      .filter((c) => c.tier === 'behind')
      .map((c) => Number.parseFloat(c.apiVersion ?? '0'));
    expect([...behindVersions].sort((a, b) => a - b)).toEqual(behindVersions);
  });

  it('recommendedFloor is 64.0 — minimum version in the current tier', () => {
    // current tier: apiVersion >= currentApiVersion - 3 = 67 - 3 = 64
    expect(report.recommendedFloor).toBe('64.0');
  });

  it('staleness score matches the documented formula on the fixture', () => {
    // Review-only types (Flow, LWC, Aura) weight at 0.5× their tier weight.
    // 5×far-behind(0.6) + 2×far-behind(0.3)[Aura,LWC] + 1×behind(0.3) + 1×behind(0.15)[Flow] + 1×current(0)
    // = (3.0 + 0.6 + 0.3 + 0.15 + 0) / 10 = 0.405 → round(100 × 0.405) = 41
    expect(report.stalenessScore).toBe(41);
  });

  it('matches the committed snapshot (UPDATE_SNAPSHOT=1 to regenerate)', () => {
    if (process.env.UPDATE_SNAPSHOT === '1' || !existsSync(snapshotPath)) {
      writeFileSync(snapshotPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    expect(report).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// A2: dated retirement confined to org-scan integration findings
// ---------------------------------------------------------------------------

describe('A2 — dated retirement: integration findings vs metadata items', () => {
  const schedule = loadSchedule();

  const mockOrgInventory: Inventory = {
    items: [
      // Org-scan metadata item at v28 — should get far-behind with NO retirementDate
      {
        id: 'ApexClass:OldHelper',
        type: 'ApexClass',
        name: 'OldHelper',
        apiVersion: '28.0',
        versionSource: 'explicit',
        location: 'ApexClass:OldHelper',
      },
    ],
    integrations: [
      // SOAP-login integration finding at v21 — should get breaks-2027 WITH retirementDate
      { type: 'soap-login', clientName: 'Data Loader', apiFamily: 'SOAP', apiVersion: '21.0', requestCount: 8 },
      // api-usage integration finding at v28 — gets gradient tier, no date
      { type: 'api-usage', clientName: 'MuleSoft', apiFamily: 'REST', apiVersion: '28.0', requestCount: 100 },
    ],
    warnings: [],
  };

  const orgReport = buildReport(mockOrgInventory, schedule, {
    mode: 'org',
    target: { org: 'mock-org' },
    scheduleSource: 'built-in retirement-schedule.json',
    scannerVersion: '0.0.0-test',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });

  it('org-scan metadata items never carry retirementDate', () => {
    for (const c of orgReport.components) {
      expect(c.retirementDate, `component ${c.id}`).toBeUndefined();
    }
  });

  it('SOAP-login integration finding gets the dated breaks-2027 tier', () => {
    const soapFinding = orgReport.integrations.find((i) => i.type === 'soap-login');
    expect(soapFinding?.tier).toBe('breaks-2027');
    expect(soapFinding?.retirementDate).toBe('2027-06');
    expect(soapFinding?.tierLabel).toBe("SOAP login() retires Summer '27");
  });

  it('api-usage integration finding gets gradient tier with no retirementDate', () => {
    const apiFinding = orgReport.integrations.find((i) => i.type === 'api-usage');
    expect(apiFinding?.tier).toBe('far-behind');
    expect(apiFinding?.retirementDate).toBeUndefined();
  });

  it('org scan with SOAP-login finding produces dated headlines', () => {
    expect(orgReport.headlines).toHaveLength(1);
    expect(orgReport.headlines[0]?.date).toBe('2027-06');
    expect(orgReport.headlines[0]?.message).toContain('SOAP login()');
  });
});
