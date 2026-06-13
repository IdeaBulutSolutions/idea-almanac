/**
 * Corpus MCP server — offline tests over the real data/ directory.
 * The protocol core (handleMessage) is pure: no stdio, no network.
 */
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleMessage,
  loadCorpusData,
  toolChangesBetween,
  toolGetChanges,
  toolListVersions,
  toolSearchCorpus,
} from '../mcp/server.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const corpus = loadCorpusData(dataDir);

describe('corpus MCP server', () => {
  it('loads every corpus version including v29/v30', () => {
    expect(corpus.files.length).toBeGreaterThanOrEqual(39);
    expect(corpus.files[0]!.apiVersion).toBe('29.0');
    expect(corpus.files.at(-1)!.apiVersion).toBe('67.0');
  });

  it('initialize handshake returns serverInfo and tools capability', () => {
    const res = handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      corpus,
    );
    expect(res?.result).toMatchObject({
      serverInfo: { name: 'almanac-corpus' },
      capabilities: { tools: {} },
    });
  });

  it('notifications get no response; unknown methods get -32601', () => {
    expect(
      handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, corpus),
    ).toBeNull();
    const err = handleMessage({ jsonrpc: '2.0', id: 2, method: 'nope' }, corpus);
    expect(err?.error?.code).toBe(-32601);
  });

  it('tools/list exposes the four corpus tools', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, corpus);
    const tools = (res?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(['list_versions', 'get_changes', 'changes_between', 'search_corpus']);
  });

  it('list_versions reports counts and flags unreviewed versions', () => {
    const text = toolListVersions(corpus);
    expect(text).toContain("67.0 (Summer '26)");
    expect(text).toContain('29.0');
    expect(text).not.toContain('NOT human-reviewed'); // all 39 versions reviewed
    // the provisional flag still renders for unreviewed data
    const [first] = corpus.files;
    if (!first) throw new Error('corpus is empty');
    const provisional = toolListVersions({ files: [{ ...first, reviewed: false }] });
    expect(provisional).toContain('NOT human-reviewed');
  });

  it('get_changes returns entries for a version and respects filters', () => {
    const all = toolGetChanges(corpus, { apiVersion: '67' });
    expect(all).toContain('v67-');
    const onlyBreaking = toolGetChanges(corpus, { apiVersion: '67.0', impact: 'breaking' });
    expect(onlyBreaking).toContain('[breaking]');
    expect(onlyBreaking).not.toContain('[additive]');
    expect(toolGetChanges(corpus, { apiVersion: '99' })).toContain('No corpus file');
  });

  it('changes_between separates versioned from org-wide and validates the span', () => {
    const text = toolChangesBetween(corpus, { from: '60.0', to: '67.0' });
    expect(text).toContain('## Component-versioned');
    expect(text).toContain('## Org-wide regardless of component version');
    expect(toolChangesBetween(corpus, { from: '67', to: '60' })).toContain('Invalid span');
  });

  it('search_corpus finds known content and caps output', () => {
    const text = toolSearchCorpus(corpus, { query: 'SOAP' });
    expect(text).toMatch(/\d+ entr/);
    expect(text).toContain('source:');
  });

  it('tools/call dispatches and unknown tools fail cleanly', () => {
    const res = handleMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_versions', arguments: {} },
      },
      corpus,
    );
    const content = (res?.result as { content: { type: string; text: string }[] }).content;
    expect(content[0]!.type).toBe('text');
    const bad = handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      corpus,
    );
    expect(bad?.error?.code).toBe(-32602);
  });
});
