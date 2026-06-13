/**
 * TRUST INVARIANT (launch-blocking): repo-mode scans make ZERO
 * network calls. This test instruments every Node networking entry point,
 * runs a full scan + report render, and fails on any outbound attempt.
 */
import { afterAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const attempts: string[] = [];
const restorers: (() => void)[] = [];

function trap<T extends object, K extends keyof T>(obj: T, key: K, name: string): void {
  const original = obj[key];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (obj as any)[key] = (...args: unknown[]) => {
    attempts.push(`${name}(${JSON.stringify(args[0])})`);
    throw new Error(`Network call attempted in repo mode: ${name}`);
  };
  restorers.push(() => {
    obj[key] = original;
  });
}

trap(net.Socket.prototype, 'connect', 'net.Socket.connect');
trap(net, 'connect', 'net.connect');
trap(net, 'createConnection', 'net.createConnection');
trap(tls, 'connect', 'tls.connect');
trap(http, 'request', 'http.request');
trap(http, 'get', 'http.get');
trap(https, 'request', 'https.request');
trap(https, 'get', 'https.get');
trap(dns, 'lookup', 'dns.lookup');
trap(dns, 'resolve', 'dns.resolve');
trap(globalThis, 'fetch' as never, 'fetch');

afterAll(() => restorers.forEach((restore) => restore()));

describe('no-network invariant (repo mode)', () => {
  it('full scan + all reporters complete with zero network attempts', async () => {
    // Import AFTER trapping so even module-load-time calls would be caught.
    const { scanRepo } = await import('../src/adapters/repo.js');
    const { loadSchedule } = await import('../src/core/tiering.js');
    const { buildReport, renderJson } = await import('../src/reporters/json.js');
    const { renderHtml } = await import('../src/reporters/html.js');
    const { renderMarkdown } = await import('../src/reporters/md.js');

    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-sfdx-repo');
    const report = buildReport(scanRepo(fixture), loadSchedule(), {
      mode: 'repo',
      target: { path: fixture },
      scheduleSource: 'built-in retirement-schedule.json',
      scannerVersion: '0.0.0-test',
    });
    renderJson(report);
    renderHtml(report);
    renderMarkdown(report);

    expect(attempts).toEqual([]);
  });
});
