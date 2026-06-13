/**
 * Org adapter. Inventories a live org's
 * versioned metadata through the Tooling API, using the user's EXISTING `sf`
 * CLI session — Almanac never asks for, stores, or transmits credentials.
 *
 * TRUST NOTE: unlike the repo adapter, this module makes network calls by
 * design — but only to the org's own instance URL, authenticated by the access
 * token the `sf` CLI already minted for the user. Nothing is uploaded anywhere,
 * no telemetry. The only outbound host is the user's own org.
 *
 * All network access is injected via `OrgScanDeps`, so the entire adapter —
 * including the `nextRecordsUrl` pagination loop — is unit-tested offline
 * against recorded Tooling API pages. The real
 * (`sf` + `fetch`) implementation lives at the bottom and is never exercised by
 * the test suite.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ComponentType,
  IntegrationFinding,
  Inventory,
  InventoryItem,
  ScanWarning,
} from '../core/inventory.js';

const execFileAsync = promisify(execFile);

/** Default Tooling API version used when the session doesn't report one. */
const FALLBACK_API_VERSION = '60.0';

/** One Tooling API query page (only the fields we read). */
export interface ToolingPage {
  done: boolean;
  records: ToolingRecord[];
  nextRecordsUrl?: string;
  totalSize?: number;
}

export interface ToolingRecord {
  attributes?: { type?: string };
  Id?: string;
  Name?: string;
  DeveloperName?: string;
  MasterLabel?: string;
  ApiName?: string;
  NamespacePrefix?: string | null;
  ApiVersion?: number | string | null;
  // EventLogFile fields (integration findings)
  LogFile?: string;
  LogDate?: string;
  EventType?: string;
}

export interface OrgConnection {
  /** Org instance URL, no trailing slash, e.g. "https://my.my.salesforce.com". */
  instanceUrl: string;
  /** Session access token from the user's `sf` CLI login. */
  accessToken: string;
  /** API version used to call the Tooling endpoint, e.g. "60.0". */
  apiVersion: string;
  username?: string;
}

export interface OrgScanDeps {
  /**
   * Resolve a usable connection from an alias/username (or the org's default
   * when undefined). Throws if no authenticated session is available.
   */
  resolveConnection: (alias: string | undefined) => Promise<OrgConnection>;
  /** Fetch one Tooling/Data API page (JSON) given an absolute URL + token. */
  fetchPage: (url: string, accessToken: string) => Promise<ToolingPage>;
  /**
   * Download a raw body (e.g. an EventLogFile CSV) as text. Optional — only
   * used for integration findings; defaults to a real `fetch`.
   */
  fetchLogBody?: (url: string, accessToken: string) => Promise<string>;
}

/** Thrown when there is no usable `sf` session for the requested org. */
export class OrgUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OrgUnavailableError';
    this.cause = cause;
  }
}

/** A queryable metadata source -> component model. */
interface ComponentSource {
  object: string;
  type: ComponentType;
  /**
   * Field holding the human name. The objects disagree:
   *   - ApexClass/Trigger/Page/Component use `Name`
   *   - AuraDefinitionBundle/LightningComponentBundle use `DeveloperName`
   *   - FlowRecord uses `ApiName`
   */
  nameField: 'Name' | 'DeveloperName' | 'ApiName';
  /** Which query endpoint serves this object. */
  api: 'tooling' | 'data';
  /** Optional SOQL WHERE clause (without the keyword). */
  where?: string;
}

export const COMPONENT_SOURCES: readonly ComponentSource[] = [
  { object: 'ApexClass', type: 'ApexClass', nameField: 'Name', api: 'tooling' },
  { object: 'ApexTrigger', type: 'ApexTrigger', nameField: 'Name', api: 'tooling' },
  { object: 'ApexPage', type: 'VisualforcePage', nameField: 'Name', api: 'tooling' },
  { object: 'ApexComponent', type: 'VisualforceComponent', nameField: 'Name', api: 'tooling' },
  { object: 'AuraDefinitionBundle', type: 'Aura', nameField: 'DeveloperName', api: 'tooling' },
  { object: 'LightningComponentBundle', type: 'LWC', nameField: 'DeveloperName', api: 'tooling' },
  // Flows: the regular-API `FlowRecord` object exposes a populated `ApiVersion`
  // directly (the Tooling `Flow.ApiVersion` column is null for Flow-Builder
  // flows). Filter to the org's own flows — managed-package flows
  // (NamespacePrefix != null) aren't editable and the repo adapter never sees
  // them, so excluding them keeps org/repo parity.
  {
    object: 'FlowRecord',
    type: 'Flow',
    nameField: 'ApiName',
    api: 'data',
    where: 'NamespacePrefix = null',
  },
];

/**
 * Inventory a live org. `alias` is an `sf` org alias/username; undefined uses
 * the configured default org. Throws `OrgUnavailableError` only when no session
 * can be opened — a single metadata type failing degrades to a warning.
 */
export async function scanOrg(
  alias: string | undefined,
  deps: OrgScanDeps = defaultDeps(),
): Promise<Inventory> {
  let conn: OrgConnection;
  try {
    conn = await deps.resolveConnection(alias);
  } catch (err) {
    throw new OrgUnavailableError(
      `Could not open an org session${alias ? ` for "${alias}"` : ''}. ` +
        `Authenticate first with:  sf org login web${alias ? ` --alias ${alias}` : ''}`,
      err,
    );
  }

  const items: InventoryItem[] = [];
  const warnings: ScanWarning[] = [];

  for (const src of COMPONENT_SOURCES) {
    let records: ToolingRecord[];
    try {
      records = await runQuery(conn, src, deps.fetchPage);
    } catch (err) {
      // One metadata type being unavailable (e.g. object not enabled in this
      // org) must never abort the whole scan — record a warning and continue.
      warnings.push({
        code: 'org-query-failed',
        message: `Could not query ${src.object}: ${errorMessage(err)}`,
        location: src.object,
      });
      continue;
    }

    for (const rec of records) {
      // A single faulty record (empty row, missing fields, or — most commonly —
      // a flow whose ApiVersion comes back null) must be *noted* and the scan
      // continue, never throw. We still inventory it with a null version so it
      // shows up; tiering treats null as "undeterminable", not "fine".
      try {
        if (rec === null || rec === undefined || typeof rec !== 'object') {
          warnings.push({
            code: 'faulty-record',
            message: `${src.object} query returned an empty record — skipped`,
            location: src.object,
          });
          continue;
        }
        const name = String(rec[src.nameField] ?? rec.Name ?? rec.Id ?? '(unknown)');
        const apiVersion = normalizeApiVersion(rec.ApiVersion);
        const id = `${src.object}:${name}`;
        if (apiVersion === null) {
          warnings.push({
            code: 'missing-api-version',
            message: `${src.type} "${name}" has no readable ApiVersion in the org — recorded without a version`,
            location: rec.Id ?? id,
          });
        }
        items.push({
          id,
          type: src.type,
          apiVersion,
          versionSource: 'explicit',
          location: rec.Id ?? id,
          raw: rec,
        });
      } catch (err) {
        warnings.push({
          code: 'faulty-record',
          message: `Could not read a ${src.object} record: ${errorMessage(err)}`,
          location: src.object,
        });
      }
    }
  }

  // Integration findings: who is calling the org's API, at which
  // versions, plus SOAP login() usage — from ApiTotalUsage event logs.
  const integrations = await gatherIntegrations(conn, deps, warnings);

  return { items, integrations, warnings };
}

// ---------------------------------------------------------------------------
// Integration findings — ApiTotalUsage event logs + SOAP login()
// ---------------------------------------------------------------------------

/** How many of the most recent ApiTotalUsage log files to download + parse. */
const MAX_LOG_FILES = 7;

/** An accumulating integration finding (carries a running request count). */
export type IntegrationAgg = IntegrationFinding & { _count: number };

/**
 * Inventory who calls the org's API and at which versions, by reading
 * `EventType = 'ApiTotalUsage'` event logs (available without paid Event
 * Monitoring, 1-day retention; 30 days with it). Aggregates by
 * (CLIENT_NAME, API_FAMILY, API_VERSION); SOAP-family login() rows become
 * `soap-login` findings. If the logs aren't readable, records a single
 * "integration visibility unavailable" warning and returns [] — never fails.
 */
async function gatherIntegrations(
  conn: OrgConnection,
  deps: OrgScanDeps,
  warnings: ScanWarning[],
): Promise<IntegrationFinding[]> {
  const fetchLogBody = deps.fetchLogBody ?? defaultFetchLogBody;

  let logFiles: ToolingRecord[];
  try {
    const soql =
      "SELECT Id, EventType, LogDate, LogFile FROM EventLogFile " +
      "WHERE EventType = 'ApiTotalUsage' ORDER BY LogDate DESC";
    const url =
      `${conn.instanceUrl}/services/data/v${conn.apiVersion}/query/?q=` +
      encodeURIComponent(soql);
    // EventLogFile paginates like any query.
    logFiles = await collectPages(url, conn, deps.fetchPage);
  } catch (err) {
    warnings.push({
      code: 'integration-visibility-unavailable',
      message:
        'Could not read ApiTotalUsage event logs (API/Event Monitoring may be ' +
        `off, or the user lacks "View Event Log Files"): ${errorMessage(err)}`,
      location: 'EventLogFile',
    });
    return [];
  }

  if (logFiles.length === 0) {
    warnings.push({
      code: 'integration-visibility-unavailable',
      message:
        'No ApiTotalUsage event logs available — no external API traffic in the ' +
        'retention window, or event log generation is off. Integration findings skipped.',
      location: 'EventLogFile',
    });
    return [];
  }

  const agg = new Map<string, IntegrationAgg>();
  for (const lf of logFiles.slice(0, MAX_LOG_FILES)) {
    if (!lf.LogFile) continue;
    let csv: string;
    try {
      csv = await fetchLogBody(absolutize(conn.instanceUrl, lf.LogFile), conn.accessToken);
    } catch (err) {
      warnings.push({
        code: 'integration-log-unreadable',
        message: `Could not download an ApiTotalUsage log (${lf.LogDate ?? lf.Id}): ${errorMessage(err)}`,
        location: lf.Id ?? 'EventLogFile',
      });
      continue;
    }
    aggregateApiTotalUsage(csv, agg);
  }

  if (agg.size === 0) {
    warnings.push({
      code: 'integration-visibility-unavailable',
      message:
        'ApiTotalUsage logs were present but yielded no usable rows (unexpected ' +
        'CSV columns?). Integration findings skipped.',
      location: 'EventLogFile',
    });
    return [];
  }

  return [...agg.values()]
    .map(({ _count, ...finding }) => ({ ...finding, requestCount: _count }))
    .sort((a, b) => (b.requestCount ?? 0) - (a.requestCount ?? 0));
}

/** Candidate CSV header names per field (Salesforce uses UPPER_SNAKE_CASE). */
const CSV_COLUMNS = {
  client: ['CLIENT_NAME', 'CLIENT', 'CLIENT_ID'],
  family: ['API_FAMILY', 'API_TYPE', 'CONNECTION_TYPE'],
  version: ['API_VERSION'],
  resource: ['API_RESOURCE', 'URI', 'METHOD_NAME', 'ENTITY_NAME'],
  count: ['COUNT', 'NUMBER_OF_RECORDS', 'ROW_COUNT'],
} as const;

/** Parse one ApiTotalUsage CSV and fold its rows into the aggregation map. */
export function aggregateApiTotalUsage(
  csv: string,
  agg: Map<string, IntegrationAgg>,
): void {
  const rows = parseCsv(csv);
  const headerRow = rows[0];
  if (rows.length < 2 || !headerRow) return;
  const header = headerRow.map((h) => h.trim().toUpperCase());
  const idx = (names: readonly string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const ci = idx(CSV_COLUMNS.client);
  const fi = idx(CSV_COLUMNS.family);
  const vi = idx(CSV_COLUMNS.version);
  const ri = idx(CSV_COLUMNS.resource);
  const ni = idx(CSV_COLUMNS.count);
  if (vi === -1) return; // without an API version we can't tier — unusable log

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0 || (row.length === 1 && row[0] === '')) continue;
    const version = normalizeApiVersion(row[vi]);
    if (version === null) continue;
    const client = (ci !== -1 && row[ci]) || '(unknown client)';
    const family = (fi !== -1 && row[fi]) || '(unknown)';
    const resource = ri !== -1 ? row[ri] ?? '' : '';
    const isSoapLogin = /soap/i.test(family) && /login/i.test(resource);
    const count = ni !== -1 ? Number.parseInt(row[ni] ?? '1', 10) || 1 : 1;

    const key = `${isSoapLogin ? 'soap-login' : 'api-usage'}|${client}|${family}|${version}`;
    const existing = agg.get(key);
    if (existing) {
      existing._count += count;
      existing.requestCount = existing._count; // keep public count in sync
    } else {
      agg.set(key, {
        type: isSoapLogin ? 'soap-login' : 'api-usage',
        clientName: client,
        apiFamily: family,
        apiVersion: version,
        requestCount: count,
        _count: count,
      });
    }
  }
}

/**
 * Minimal RFC-4180-ish CSV parser (handles quoted fields with commas, escaped
 * "" quotes, and \r\n). Salesforce EventLogFile CSVs are well-formed.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Follow `nextRecordsUrl` for an arbitrary query URL. */
async function collectPages(
  startUrl: string,
  conn: OrgConnection,
  fetchPage: OrgScanDeps['fetchPage'],
): Promise<ToolingRecord[]> {
  const out: ToolingRecord[] = [];
  const seen = new Set<string>();
  let url = startUrl;
  for (;;) {
    if (seen.has(url)) break;
    seen.add(url);
    const page = await fetchPage(url, conn.accessToken);
    if (Array.isArray(page.records)) out.push(...page.records);
    if (page.done || !page.nextRecordsUrl) break;
    url = absolutize(conn.instanceUrl, page.nextRecordsUrl);
  }
  return out;
}

async function defaultFetchLogBody(url: string, accessToken: string): Promise<string> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`log download responded ${res.status} ${res.statusText}`);
  return res.text();
}

/** Run one SOQL query (Tooling or Data API), following `nextRecordsUrl`. */
async function runQuery(
  conn: OrgConnection,
  src: ComponentSource,
  fetchPage: OrgScanDeps['fetchPage'],
): Promise<ToolingRecord[]> {
  const soql =
    `SELECT Id, ${src.nameField}, ApiVersion FROM ${src.object}` +
    (src.where ? ` WHERE ${src.where}` : '');
  const queryPath = src.api === 'tooling' ? 'tooling/query' : 'query';
  let url =
    `${conn.instanceUrl}/services/data/v${conn.apiVersion}/${queryPath}/?q=` +
    encodeURIComponent(soql);

  const out: ToolingRecord[] = [];
  // Pagination loop — unit-tested against recorded multi-page responses.
  // A malformed/looping response can't hang us: each page must either be the
  // last (`done`) or hand back a *different* nextRecordsUrl, else we stop.
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(url)) break;
    seen.add(url);
    const page = await fetchPage(url, conn.accessToken);
    if (Array.isArray(page.records)) out.push(...page.records);
    if (page.done || !page.nextRecordsUrl) break;
    url = absolutize(conn.instanceUrl, page.nextRecordsUrl);
  }
  return out;
}

function absolutize(instanceUrl: string, next: string): string {
  return next.startsWith('http') ? next : `${instanceUrl}${next}`;
}

/**
 * Tooling `ApiVersion` arrives as a number (58.0), an integer (58), or a
 * string; normalize to canonical "58.0". Returns null when absent/unparseable.
 */
export function normalizeApiVersion(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  if (Number.isNaN(n)) return null;
  return n.toFixed(1);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Default (real) network implementation — never reached by the unit tests,
// which always inject their own deps.
// ---------------------------------------------------------------------------

function defaultDeps(): OrgScanDeps {
  return { resolveConnection, fetchPage };
}

/** Read instanceUrl + accessToken + apiVersion from the user's `sf` session. */
async function resolveConnection(alias: string | undefined): Promise<OrgConnection> {
  const args = ['org', 'display', '--json'];
  if (alias) args.push('--target-org', alias);

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('sf', args, { maxBuffer: 4 * 1024 * 1024 }));
  } catch (err) {
    // sf not installed, or no auth — surface the underlying message.
    throw new Error(errorMessage(err), { cause: err });
  }

  const parsed = JSON.parse(stdout) as {
    result?: {
      instanceUrl?: string;
      accessToken?: string;
      apiVersion?: string | number;
      username?: string;
    };
  };
  const r = parsed.result ?? {};
  if (!r.instanceUrl || !r.accessToken) {
    throw new Error(
      'sf org display did not return an instanceUrl and accessToken — ' +
        'try: sf org login web',
    );
  }
  return {
    instanceUrl: r.instanceUrl.replace(/\/+$/, ''),
    accessToken: r.accessToken,
    apiVersion: normalizeApiVersion(r.apiVersion) ?? FALLBACK_API_VERSION,
    username: r.username,
  };
}

async function fetchPage(url: string, accessToken: string): Promise<ToolingPage> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    // Salesforce returns a JSON body like
    // [{"message":"No such column 'X' on entity 'Y'","errorCode":"INVALID_FIELD"}]
    // — surface it so a bad query explains itself instead of just "400".
    let detail = '';
    try {
      const body = (await res.json()) as Array<{ message?: string; errorCode?: string }> | unknown;
      if (Array.isArray(body) && body[0]?.message) {
        detail = ` — ${body[0].errorCode ? `${body[0].errorCode}: ` : ''}${body[0].message}`;
      }
    } catch {
      /* non-JSON body; fall back to status text */
    }
    throw new Error(`Tooling API responded ${res.status} ${res.statusText}${detail}`);
  }
  return (await res.json()) as ToolingPage;
}
