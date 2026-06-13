/**
 * Almanac corpus MCP server — zero dependencies beyond `yaml` (already a
 * corpus dep). Speaks Model Context Protocol over stdio (newline-delimited
 * JSON-RPC 2.0), read-only over `data/*.yaml`. No network, no telemetry —
 * the same trust posture as the scanner.
 *
 * Run:            npm run mcp            (from packages/corpus)
 * Claude Desktop / Claude Code config example:
 *   { "mcpServers": { "almanac-corpus": {
 *       "command": "node",
 *       "args": ["--experimental-strip-types", "--no-warnings",
 *                "<repo>/packages/corpus/mcp/server.ts"] } } }
 *
 * Tools:
 *   list_versions    — corpus manifest (versions, releases, counts, reviewed)
 *   get_changes      — entries for one API version, optional filters
 *   changes_between  — entries across a span (from, to], optional filters;
 *                      span membership uses introducedIn ?? apiVersion
 *   search_corpus    — keyword search across summaries/details/headings
 *
 * The handler core is pure (handleMessage) so tests run offline with no stdio.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parse as yamlParse } from 'yaml';

// ---------------------------------------------------------------------------
// Corpus loading (once, at startup — data is static per process)
// ---------------------------------------------------------------------------

export interface Entry {
  id: string;
  apiVersion: string;
  introducedIn?: string;
  release: string;
  changeType: string;
  impact: string;
  affectedMetadataTypes: string[];
  behaviorArea: string;
  appliesWhen: string;
  summary: string;
  detail?: string;
  upgradeAction?: string;
  source: { document: string; page: number; heading: string };
  confidence: string;
}

interface VersionFile {
  apiVersion: string;
  release: string;
  reviewed?: boolean;
  entries: Entry[];
}

export interface CorpusData {
  files: VersionFile[];
}

export function loadCorpusData(dataDir: string): CorpusData {
  const files = readdirSync(dataDir)
    .filter((f) => /^v\d{2,3}\.yaml$/.test(f))
    .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))
    .map((f) => yamlParse(readFileSync(join(dataDir, f), 'utf8')) as VersionFile);
  return { files };
}

// ---------------------------------------------------------------------------
// Tool implementations (pure)
// ---------------------------------------------------------------------------

const effectiveVersion = (e: Entry): number => Number.parseFloat(e.introducedIn ?? e.apiVersion);
const isOrgWide = (e: Entry): boolean => /org-wide/i.test(e.appliesWhen);
const normVersion = (v: string | number): number =>
  typeof v === 'number' ? v : Number.parseFloat(v);

/** Render entries compactly; cap output so a tool result never floods context. */
const MAX_ENTRIES = 80;

function renderEntries(entries: Entry[]): string {
  const shown = entries.slice(0, MAX_ENTRIES);
  const lines = shown.map((e) => {
    const parts = [
      `- ${e.id} [${e.impact}] (${e.release}${e.introducedIn ? `, introduced in ${e.introducedIn}` : ''})`,
      `  appliesWhen: ${e.appliesWhen}`,
      `  affects: ${e.affectedMetadataTypes.join(', ')} · area: ${e.behaviorArea} · confidence: ${e.confidence}`,
      `  ${e.summary}`,
    ];
    if (e.upgradeAction) parts.push(`  action: ${e.upgradeAction}`);
    parts.push(`  source: ${e.source.document} p.${e.source.page} — "${e.source.heading}"`);
    return parts.join('\n');
  });
  const note =
    entries.length > shown.length
      ? `\n…and ${entries.length - shown.length} more (narrow with filters).`
      : '';
  return `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.\n\n${lines.join('\n\n')}${note}`;
}

interface Filters {
  impact?: string;
  metadataType?: string;
  behaviorArea?: string;
}

function applyFilters(entries: Entry[], f: Filters): Entry[] {
  return entries.filter(
    (e) =>
      (f.impact === undefined || e.impact === f.impact) &&
      (f.behaviorArea === undefined || e.behaviorArea === f.behaviorArea) &&
      (f.metadataType === undefined ||
        e.affectedMetadataTypes.includes(f.metadataType) ||
        e.affectedMetadataTypes.includes('Any')),
  );
}

export function toolListVersions(corpus: CorpusData): string {
  const rows = corpus.files.map(
    (f) =>
      `- ${f.apiVersion} (${f.release}) — ${f.entries.length} entries${f.reviewed === true ? '' : ' [NOT human-reviewed: provisional]'}`,
  );
  const total = corpus.files.reduce((s, f) => s + f.entries.length, 0);
  return `Almanac corpus: ${corpus.files.length} Salesforce API versions, ${total} change entries.\n${rows.join('\n')}`;
}

export function toolGetChanges(
  corpus: CorpusData,
  args: { apiVersion: string | number } & Filters,
): string {
  const v = normVersion(args.apiVersion);
  const file = corpus.files.find((f) => normVersion(f.apiVersion) === v);
  if (!file) {
    return `No corpus file for API version ${v}. Use list_versions to see coverage.`;
  }
  const entries = applyFilters(file.entries, args);
  return `${file.apiVersion} (${file.release})${file.reviewed === true ? '' : ' [NOT human-reviewed: provisional]'}\n${renderEntries(entries)}`;
}

export function toolChangesBetween(
  corpus: CorpusData,
  args: { from: string | number; to: string | number } & Filters,
): string {
  const from = normVersion(args.from);
  const to = normVersion(args.to);
  if (!(from < to)) return `Invalid span: from (${from}) must be lower than to (${to}).`;
  const all = corpus.files.flatMap((f) => f.entries);
  const inSpan = all.filter((e) => effectiveVersion(e) > from && effectiveVersion(e) <= to);
  const filtered = applyFilters(inSpan, args);
  const versioned = filtered.filter((e) => !isOrgWide(e));
  const orgWide = filtered.filter(isOrgWide);
  const covered = corpus.files.map((f) => Math.trunc(normVersion(f.apiVersion)));
  const missing: number[] = [];
  for (let v = Math.trunc(from) + 1; v <= Math.trunc(to); v++) {
    if (!covered.includes(v)) missing.push(v);
  }
  const gap = missing.length > 0 ? `\n\n⚠ No corpus data for: v${missing.join(', v')} — changes introduced there are not covered.` : '';
  return [
    `Changes crossing (${from}, ${to}]:`,
    '',
    `## Component-versioned (${versioned.length})`,
    renderEntries(versioned),
    '',
    `## Org-wide regardless of component version (${orgWide.length})`,
    renderEntries(orgWide),
  ].join('\n') + gap;
}

export function toolSearchCorpus(corpus: CorpusData, args: { query: string } & Filters): string {
  const q = args.query.toLowerCase().trim();
  if (q === '') return 'Empty query.';
  const all = corpus.files.flatMap((f) => f.entries);
  const hits = applyFilters(
    all.filter((e) =>
      `${e.summary} ${e.detail ?? ''} ${e.source.heading} ${e.behaviorArea} ${e.appliesWhen}`
        .toLowerCase()
        .includes(q),
    ),
    args,
  );
  return `Search "${args.query}": ${renderEntries(hits)}`;
}

// ---------------------------------------------------------------------------
// MCP protocol (JSON-RPC 2.0, newline-delimited over stdio)
// ---------------------------------------------------------------------------

const SERVER_INFO = { name: 'almanac-corpus', version: '0.1.0' };
const PROTOCOL_VERSION = '2025-06-18';

const TOOLS = [
  {
    name: 'list_versions',
    description:
      'List every Salesforce API version in the Almanac corpus with its release name, entry count, and review status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_changes',
    description:
      'Developer-relevant changes recorded for one Salesforce API version. Optional filters: impact (breaking|behavior-change|deprecation|retirement|additive), metadataType (ApexClass|ApexTrigger|Flow|LWC|AuraDefinitionBundle|VisualforcePage|VisualforceComponent|Integration), behaviorArea.',
    inputSchema: {
      type: 'object',
      properties: {
        apiVersion: { type: 'string', description: 'e.g. "55.0" or "55"' },
        impact: { type: 'string' },
        metadataType: { type: 'string' },
        behaviorArea: { type: 'string' },
      },
      required: ['apiVersion'],
    },
  },
  {
    name: 'changes_between',
    description:
      'Every recorded change a component crosses when upgrading from one Salesforce API version to another (span (from, to], using introducedIn when a change was republished). Separates component-versioned from org-wide changes. Same optional filters as get_changes.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'current version, e.g. "48.0"' },
        to: { type: 'string', description: 'target version, e.g. "67.0"' },
        impact: { type: 'string' },
        metadataType: { type: 'string' },
        behaviorArea: { type: 'string' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'search_corpus',
    description:
      'Keyword search across all change summaries, details, and source headings in the corpus. Same optional filters as get_changes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        impact: { type: 'string' },
        metadataType: { type: 'string' },
        behaviorArea: { type: 'string' },
      },
      required: ['query'],
    },
  },
];

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

/** Handle one parsed JSON-RPC message. Returns the response, or null for notifications. */
export function handleMessage(msg: JsonRpcMessage, corpus: CorpusData): JsonRpcMessage | null {
  if (msg.method === undefined) return null; // a response — nothing to do
  const isNotification = msg.id === undefined;

  const respond = (result: unknown): JsonRpcMessage | null =>
    isNotification ? null : { jsonrpc: '2.0', id: msg.id, result };
  const fail = (code: number, message: string): JsonRpcMessage | null =>
    isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } };

  switch (msg.method) {
    case 'initialize':
      return respond({
        protocolVersion:
          typeof msg.params?.protocolVersion === 'string'
            ? msg.params.protocolVersion
            : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return respond({});
    case 'tools/list':
      return respond({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name as string | undefined;
      // Arguments arrive untyped from the wire; each tool validates what it
      // needs (missing fields produce a clear in-band tool error, not a crash).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (msg.params?.arguments ?? {}) as any;
      try {
        switch (name) {
          case 'list_versions':
            return respond(textResult(toolListVersions(corpus)));
          case 'get_changes':
            return respond(textResult(toolGetChanges(corpus, args)));
          case 'changes_between':
            return respond(textResult(toolChangesBetween(corpus, args)));
          case 'search_corpus':
            return respond(textResult(toolSearchCorpus(corpus, args)));
          default:
            return fail(-32602, `Unknown tool: ${String(name)}`);
        }
      } catch (err) {
        return respond({
          content: [{ type: 'text', text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// ---------------------------------------------------------------------------
// stdio loop
// ---------------------------------------------------------------------------

const invokedDirectly = process.argv[1]?.endsWith('server.ts') ?? false;

if (invokedDirectly) {
  const dataDir =
    process.env.ALMANAC_CORPUS_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const corpus = loadCorpusData(dataDir);

  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n',
      );
      return;
    }
    const response = handleMessage(msg, corpus);
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n');
  });
}
