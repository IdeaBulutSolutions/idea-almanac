/**
 * Org adapter — fully offline. Network is injected, so these tests
 * prove the adapter's behavior (mapping, ApiVersion normalization, the
 * nextRecordsUrl pagination loop, per-type degradation, and the no-session
 * path) without ever touching a real org. 
 */
import { describe, expect, it } from 'vitest';
import {
  scanOrg,
  normalizeApiVersion,
  aggregateApiTotalUsage,
  parseCsv,
  OrgUnavailableError,
  type IntegrationAgg,
  type OrgConnection,
  type OrgScanDeps,
  type ToolingPage,
  type ToolingRecord,
} from '../src/adapters/org.js';

const CONN: OrgConnection = {
  instanceUrl: 'https://example.my.salesforce.com',
  accessToken: 'TOKEN',
  apiVersion: '60.0',
};

/** Build deps whose fetchPage serves canned pages keyed by sObject in the URL. */
function depsFrom(
  pagesByObject: Record<string, ToolingPage[]>,
  opts: { failObjects?: Set<string>; calls?: string[] } = {},
): OrgScanDeps {
  const cursor: Record<string, number> = {};
  return {
    resolveConnection: async () => CONN,
    fetchPage: async (url: string): Promise<ToolingPage> => {
      opts.calls?.push(url);
      // Identify which sObject this URL targets (initial query carries
      // "FROM X"; follow-ups carry the object name in the nextRecordsUrl).
      const fromMatch = decodeURIComponent(url).match(/FROM (\w+)/);
      const nextMatch = url.match(/\/query\/(\w+)-\d+/);
      const object = fromMatch?.[1] ?? nextMatch?.[1] ?? '';
      if (opts.failObjects?.has(object)) throw new Error('object not available');
      const pages = pagesByObject[object] ?? [{ done: true, records: [] }];
      const i = cursor[object] ?? 0;
      cursor[object] = i + 1;
      return pages[Math.min(i, pages.length - 1)];
    },
  };
}

const EMPTY: Record<string, ToolingPage[]> = {
  ApexClass: [{ done: true, records: [] }],
  ApexTrigger: [{ done: true, records: [] }],
  ApexPage: [{ done: true, records: [] }],
  ApexComponent: [{ done: true, records: [] }],
  AuraDefinitionBundle: [{ done: true, records: [] }],
  LightningComponentBundle: [{ done: true, records: [] }],
  FlowRecord: [{ done: true, records: [] }],
};

describe('org adapter', () => {
  it('normalizes ApiVersion from number, int, string; null when absent', () => {
    expect(normalizeApiVersion(58)).toBe('58.0');
    expect(normalizeApiVersion(58.0)).toBe('58.0');
    expect(normalizeApiVersion(61.0)).toBe('61.0');
    expect(normalizeApiVersion('45.0')).toBe('45.0');
    expect(normalizeApiVersion(null)).toBeNull();
    expect(normalizeApiVersion(undefined)).toBeNull();
    expect(normalizeApiVersion('')).toBeNull();
    expect(normalizeApiVersion('nope')).toBeNull();
  });

  it('maps each metadata sObject to the right component type', async () => {
    const inv = await scanOrg(undefined, {
      resolveConnection: async () => CONN,
      fetchPage: async (url) => {
        const obj = decodeURIComponent(url).match(/FROM (\w+)/)?.[1] ?? '';
        const rec: Record<string, ToolingPage> = {
          ApexClass: { done: true, records: [{ Id: '01p1', Name: 'Legacy', ApiVersion: 30.0 }] },
          ApexTrigger: { done: true, records: [{ Id: '01q1', Name: 'AcctTrg', ApiVersion: 52.0 }] },
          ApexPage: { done: true, records: [{ Id: '066', Name: 'OldPage', ApiVersion: 28.0 }] },
          ApexComponent: { done: true, records: [{ Id: '099', Name: 'Cmp', ApiVersion: 40.0 }] },
          AuraDefinitionBundle: {
            done: true,
            records: [{ Id: '0Ab', DeveloperName: 'panel', ApiVersion: 45.0 }],
          },
          LightningComponentBundle: {
            done: true,
            records: [{ Id: '0Rb', DeveloperName: 'orderList', ApiVersion: 55.0 }],
          },
          FlowRecord: { done: true, records: [{ Id: '301', ApiName: 'Fulfil', ApiVersion: 61 }] },
        };
        return rec[obj] ?? { done: true, records: [] };
      },
    });

    const byType = Object.fromEntries(inv.items.map((i) => [i.type, i]));
    expect(inv.items).toHaveLength(7);
    expect(byType.ApexClass.apiVersion).toBe('30.0');
    expect(byType.VisualforcePage.apiVersion).toBe('28.0');
    expect(byType.VisualforceComponent.type).toBe('VisualforceComponent');
    expect(byType.Aura.id).toBe('AuraDefinitionBundle:panel');
    expect(byType.LWC.apiVersion).toBe('55.0');
    expect(byType.Flow.id).toBe('FlowRecord:Fulfil');
    expect(byType.Flow.apiVersion).toBe('61.0'); // ApiName + int ApiVersion 61 -> "61.0"
    expect(byType.Flow.location).toBe('301');
    // No component-level warnings (the only warning is the expected
    // integration-visibility one, since these mocks serve no event logs).
    expect(inv.warnings.filter((w) => w.code !== 'integration-visibility-unavailable')).toEqual([]);
  });

  it('queries flows via FlowRecord on the Data API (not Tooling), own-org only', async () => {
    const calls: string[] = [];
    await scanOrg(undefined, depsFrom(EMPTY, { calls }));
    const flowUrl = calls.find((u) => /FROM FlowRecord/.test(decodeURIComponent(u)))!;
    const q = decodeURIComponent(flowUrl);
    expect(q).toContain('ApiName');
    expect(q).toContain('NamespacePrefix = null');
    expect(flowUrl).toContain('/services/data/v60.0/query/'); // regular Data API
    expect(flowUrl).not.toContain('/tooling/query/'); // not Tooling
    // The Apex types still go through Tooling.
    const apexUrl = calls.find((u) => /FROM ApexClass/.test(decodeURIComponent(u)))!;
    expect(apexUrl).toContain('/tooling/query/');
  });

  it('follows nextRecordsUrl across pages (pagination proven offline)', async () => {
    const calls: string[] = [];
    const inv = await scanOrg(
      undefined,
      depsFrom(
        {
          ...EMPTY,
          ApexClass: [
            {
              done: false,
              totalSize: 3,
              records: [
                { Id: '01p1', Name: 'A', ApiVersion: 30.0 },
                { Id: '01p2', Name: 'B', ApiVersion: 31.0 },
              ],
              nextRecordsUrl: '/services/data/v60.0/tooling/query/ApexClass-2000',
            },
            { done: true, records: [{ Id: '01p3', Name: 'C', ApiVersion: 32.0 }] },
          ],
        },
        { calls },
      ),
    );

    const apex = inv.items.filter((i) => i.type === 'ApexClass').map((i) => i.id);
    expect(apex).toEqual(['ApexClass:A', 'ApexClass:B', 'ApexClass:C']);
    // Two fetches for ApexClass: the initial query + one nextRecordsUrl follow.
    expect(calls.filter((u) => u.includes('ApexClass')).length).toBe(2);
    expect(calls.some((u) => u.includes('/query/ApexClass-2000'))).toBe(true);
  });

  it('records a warning and continues when one sObject query fails', async () => {
    const inv = await scanOrg(
      undefined,
      depsFrom(
        { ...EMPTY, FlowRecord: [{ done: true, records: [{ Id: '301', ApiName: 'F', ApiVersion: 61 }] }] },
        { failObjects: new Set(['ApexClass']) },
      ),
    );
    expect(inv.warnings.some((w) => w.code === 'org-query-failed' && w.location === 'ApexClass')).toBe(
      true,
    );
    // The rest of the scan still completed.
    expect(inv.items.some((i) => i.type === 'Flow')).toBe(true);
  });

  it('warns on a record missing ApiVersion but still inventories it', async () => {
    const inv = await scanOrg(
      undefined,
      depsFrom({
        ...EMPTY,
        ApexClass: [{ done: true, records: [{ Id: '01pX', Name: 'NoVer', ApiVersion: null }] }],
      }),
    );
    const item = inv.items.find((i) => i.id === 'ApexClass:NoVer');
    expect(item?.apiVersion).toBeNull();
    expect(inv.warnings.some((w) => w.code === 'missing-api-version')).toBe(true);
  });

  it('notes a faulty flow (null ApiVersion) without erroring, and still records it', async () => {
    const inv = await scanOrg(
      undefined,
      depsFrom({
        ...EMPTY,
        FlowRecord: [
          {
            done: true,
            records: [
              { Id: '301a', ApiName: 'GoodFlow', ApiVersion: 62 },
              { Id: '301b', ApiName: 'FaultyFlow', ApiVersion: null },
            ],
          },
        ],
      }),
    );
    const faulty = inv.items.find((i) => i.id === 'FlowRecord:FaultyFlow');
    expect(faulty?.apiVersion).toBeNull(); // recorded, not dropped
    expect(inv.items.find((i) => i.id === 'FlowRecord:GoodFlow')?.apiVersion).toBe('62.0');
    const w = inv.warnings.find((x) => x.code === 'missing-api-version' && x.location === '301b');
    expect(w?.message).toContain('FaultyFlow');
  });

  it('skips an empty/garbage record with a faulty-record warning, never throwing', async () => {
    const inv = await scanOrg(
      undefined,
      depsFrom({
        ...EMPTY,
        // a null row alongside a good one — must not crash the scan
        FlowRecord: [
          { done: true, records: [null as never, { Id: '301', ApiName: 'OkFlow', ApiVersion: 60 }] },
        ],
      }),
    );
    expect(inv.items.find((i) => i.id === 'FlowRecord:OkFlow')?.apiVersion).toBe('60.0');
    expect(inv.warnings.some((w) => w.code === 'faulty-record')).toBe(true);
  });

  it('throws OrgUnavailableError when no session can be opened', async () => {
    await expect(
      scanOrg('badalias', {
        resolveConnection: async () => {
          throw new Error('No authorization found');
        },
        fetchPage: async () => ({ done: true, records: [] }),
      }),
    ).rejects.toBeInstanceOf(OrgUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Integration findings from ApiTotalUsage event logs
// ---------------------------------------------------------------------------

const API_TOTAL_USAGE_CSV =
  '"EVENT_TYPE","TIMESTAMP","CLIENT_NAME","API_FAMILY","API_VERSION","API_RESOURCE","COUNT"\n' +
  '"ApiTotalUsage","2026...","Data Loader","SOAP","21.0","login","5"\n' +
  '"ApiTotalUsage","2026...","Data Loader","SOAP","21.0","login","3"\n' +
  '"ApiTotalUsage","2026...","Data Loader","SOAP","21.0","query","10"\n' +
  '"ApiTotalUsage","2026...","MuleSoft","REST","48.0","sobjects","100"\n';

/** Deps that serve one EventLogFile row + a canned CSV; components empty. */
function integrationDeps(csv: string | null, opts: { queryThrows?: boolean } = {}): OrgScanDeps {
  return {
    resolveConnection: async () => CONN,
    fetchPage: async (url) => {
      const q = decodeURIComponent(url);
      if (/FROM EventLogFile/.test(q)) {
        if (opts.queryThrows) throw new Error('INVALID_TYPE: sObject EventLogFile is not supported');
        if (csv === null) return { done: true, records: [] as ToolingRecord[] };
        return {
          done: true,
          records: [{ Id: '0AT1', LogDate: '2026-06-10', LogFile: '/services/data/v60.0/sobjects/EventLogFile/0AT1/LogFile' }],
        };
      }
      return { done: true, records: [] };
    },
    fetchLogBody: async () => {
      if (csv === null) throw new Error('no body');
      return csv;
    },
  };
}

describe('integration findings', () => {
  it('parseCsv handles quoted fields, commas, and escaped quotes', () => {
    const rows = parseCsv('"a","b,c","d""e"\n"1","2","3"\n');
    expect(rows[0]).toEqual(['a', 'b,c', 'd"e']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('aggregates by (client, family, version) and counts requests', () => {
    const agg = new Map<string, IntegrationAgg>();
    aggregateApiTotalUsage(API_TOTAL_USAGE_CSV, agg);
    const muleSoft = [...agg.values()].find((f) => f.clientName === 'MuleSoft');
    expect(muleSoft?.apiVersion).toBe('48.0');
    expect(muleSoft?.requestCount).toBe(100);
    expect(muleSoft?.type).toBe('api-usage');
  });

  it('detects SOAP login() as a soap-login finding, summing its rows', () => {
    const agg = new Map<string, IntegrationAgg>();
    aggregateApiTotalUsage(API_TOTAL_USAGE_CSV, agg);
    const soapLogin = [...agg.values()].find((f) => f.type === 'soap-login');
    expect(soapLogin?.clientName).toBe('Data Loader');
    expect(soapLogin?.apiVersion).toBe('21.0');
    expect(soapLogin?.requestCount).toBe(8); // 5 + 3 login rows
    // The non-login SOAP "query" row stays api-usage, separate from soap-login.
    const soapQuery = [...agg.values()].find(
      (f) => f.type === 'api-usage' && f.apiFamily === 'SOAP',
    );
    expect(soapQuery?.requestCount).toBe(10);
  });

  it('produces sorted findings end-to-end via scanOrg', async () => {
    const inv = await scanOrg(undefined, integrationDeps(API_TOTAL_USAGE_CSV));
    expect(inv.integrations.length).toBe(3);
    expect(inv.integrations[0]?.requestCount).toBe(100); // sorted desc
    expect(inv.integrations.some((f) => f.type === 'soap-login')).toBe(true);
    expect(inv.warnings.some((w) => w.code === 'integration-visibility-unavailable')).toBe(false);
  });

  it('graceful unavailable path when EventLogFile query is rejected', async () => {
    const inv = await scanOrg(undefined, integrationDeps(null, { queryThrows: true }));
    expect(inv.integrations).toEqual([]);
    expect(inv.warnings.some((w) => w.code === 'integration-visibility-unavailable')).toBe(true);
  });

  it('graceful path when no ApiTotalUsage logs exist', async () => {
    const inv = await scanOrg(undefined, integrationDeps(null));
    expect(inv.integrations).toEqual([]);
    expect(inv.warnings.some((w) => w.code === 'integration-visibility-unavailable')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C2 — org-derived current API version
// ---------------------------------------------------------------------------

describe('C2 — org-derived current API version', () => {
  it('sets resolvedApiVersion from the connection apiVersion', async () => {
    const inv = await scanOrg(undefined, depsFrom(EMPTY));
    // CONN.apiVersion is "60.0" — the adapter must surface it on the inventory.
    expect(inv.resolvedApiVersion).toBe('60.0');
  });
});

// ---------------------------------------------------------------------------
// F1 — IsSandbox guard: Organization.IsSandbox propagates to inventory
// ---------------------------------------------------------------------------

describe('F1 — IsSandbox production guard', () => {
  it('sets isSandbox: true when Organization query returns IsSandbox = true', async () => {
    const inv = await scanOrg(undefined, depsFrom({
      ...EMPTY,
      Organization: [{ done: true, records: [{ IsSandbox: true }] }],
    }));
    expect(inv.isSandbox).toBe(true);
  });

  it('sets isSandbox: false when Organization query returns IsSandbox = false (production)', async () => {
    const inv = await scanOrg(undefined, depsFrom({
      ...EMPTY,
      Organization: [{ done: true, records: [{ IsSandbox: false }] }],
    }));
    expect(inv.isSandbox).toBe(false);
  });

  it('leaves isSandbox undefined and emits org-info-unavailable when query throws', async () => {
    const inv = await scanOrg(
      undefined,
      depsFrom(EMPTY, { failObjects: new Set(['Organization']) }),
    );
    expect(inv.isSandbox).toBeUndefined();
    expect(inv.warnings.some((w) => w.code === 'org-info-unavailable')).toBe(true);
  });

  it('uses the Data API (not Tooling) for the Organization query', async () => {
    const calls: string[] = [];
    await scanOrg(
      undefined,
      depsFrom(
        { ...EMPTY, Organization: [{ done: true, records: [{ IsSandbox: true }] }] },
        { calls },
      ),
    );
    const orgUrl = calls.find((u) => /FROM Organization/.test(decodeURIComponent(u)))!;
    expect(orgUrl).toBeDefined();
    expect(orgUrl).toContain('/services/data/v');
    expect(orgUrl).not.toContain('/tooling/query/');
  });
});

// ---------------------------------------------------------------------------
// C1 — managed/namespaced component exclusion
// ---------------------------------------------------------------------------

describe('C1 — managed/namespaced component exclusion (org)', () => {
  it('excludes records with a non-null NamespacePrefix and emits a warning', async () => {
    const inv = await scanOrg(undefined, depsFrom({
      ...EMPTY,
      ApexClass: [{
        done: true,
        records: [
          { Id: '01p1', Name: 'LocalClass', ApiVersion: 58.0, NamespacePrefix: null },
          { Id: '01p2', Name: 'ManagedClass', ApiVersion: 50.0, NamespacePrefix: 'myns' },
        ],
      }],
    }));
    expect(inv.items.map((i) => i.name)).toEqual(['LocalClass']);
    expect(inv.warnings).toContainEqual(
      expect.objectContaining({
        code: 'managed-excluded',
        message: '1 managed/namespaced component excluded — upgrade these in the package, not here.',
      }),
    );
  });

  it('includes NamespacePrefix in the SOQL SELECT for non-Flow objects', async () => {
    const calls: string[] = [];
    await scanOrg(undefined, depsFrom(EMPTY, { calls }));
    const apexUrl = calls.find((u) => /FROM ApexClass/.test(decodeURIComponent(u)))!;
    expect(decodeURIComponent(apexUrl)).toContain('NamespacePrefix');
  });
});
