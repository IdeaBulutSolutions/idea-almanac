import { describe, expect, it } from 'vitest';
import { assignTier, evaluate, loadSchedule, scheduleFreshness } from '../src/core/tiering.js';

const schedule = loadSchedule();

const tierOf = (apiVersion: string | null, soapLogin = false) =>
  assignTier({ apiVersion, soapLogin }, schedule).tier;

describe('tiering rule boundaries', () => {
  // far-behind / behind boundary: apiVersion < currentApiVersion - 9 (67 - 9 = 58)
  it('30.0 => far-behind (well below threshold)', () => expect(tierOf('30.0')).toBe('far-behind'));
  it('41.0 => far-behind (below 9-release threshold)', () => expect(tierOf('41.0')).toBe('far-behind'));
  it('57.0 => far-behind', () => expect(tierOf('57.0')).toBe('far-behind'));
  it('58.0 => behind', () => expect(tierOf('58.0')).toBe('behind'));

  // behind / current boundary: apiVersion < currentApiVersion - 3 (67 - 3 = 64)
  it('63.0 => behind', () => expect(tierOf('63.0')).toBe('behind'));
  it('64.0 => current', () => expect(tierOf('64.0')).toBe('current'));
  it('67.0 => current', () => expect(tierOf('67.0')).toBe('current'));

  // SOAP login() — org-integration rule only (soapLogin=false for all repo items).
  // breaks-2027 is rule 0, so it beats gradient rules for any SOAP-login finding ≤ 64.
  it('soapLogin at 64.0 => breaks-2027', () => expect(tierOf('64.0', true)).toBe('breaks-2027'));
  it('soapLogin at 30.0 => breaks-2027 (breaks-2027 rule beats far-behind for soap-login)', () =>
    expect(tierOf('30.0', true)).toBe('breaks-2027'));
  it('soapLogin at 65.0 => current (rule requires <= 64.0)', () =>
    expect(tierOf('65.0', true)).toBe('current'));

  it('null apiVersion => unknown, weight 0', () => {
    expect(assignTier({ apiVersion: null }, schedule)).toEqual({ tier: 'unknown', weight: 0 });
  });

  it('gradient tiers carry their label and severity but no retirement date', () => {
    const t = assignTier({ apiVersion: '28.0' }, schedule);
    expect(t.date).toBeUndefined();
    expect(t.label).toBe('Far behind — more than 9 releases from current');
    expect(t.severity).toBe('critical');
    expect(t.weight).toBe(0.6);
  });
});

describe('match-expression evaluator', () => {
  const ctx = { apiVersion: 55, currentApiVersion: 67, soapLogin: false };

  it('arithmetic on the right side', () =>
    expect(evaluate('apiVersion < currentApiVersion - 3', ctx)).toBe(true));
  it('&& combines comparisons', () =>
    expect(evaluate('apiVersion >= 31.0 && apiVersion <= 40.0', ctx)).toBe(false));
  it('boolean identifier', () =>
    expect(evaluate('soapLogin && apiVersion <= 64.0', ctx)).toBe(false));
  it('parentheses and ||', () =>
    expect(evaluate('(apiVersion <= 30.0) || (apiVersion >= 50.0)', ctx)).toBe(true));
  it('rejects unknown identifiers', () =>
    expect(() => evaluate('rm -rf', ctx)).toThrow());
  it('rejects trailing garbage', () =>
    expect(() => evaluate('apiVersion <= 30.0 30.0', ctx)).toThrow());
});

describe('scheduleFreshness (currentApiVersion staleness guard)', () => {
  const base = { currentApiVersion: '67.0', currentApiVersionAsOf: '2026-06', rules: [] };

  it('returns null when the schedule is current (same release window)', () =>
    expect(scheduleFreshness(base, new Date('2026-06-14T00:00:00Z'))).toBeNull());

  it('returns null just before the next release ships', () =>
    expect(scheduleFreshness(base, new Date('2026-09-30T00:00:00Z'))).toBeNull());

  it('flags one release behind after the next GA window opens', () => {
    const r = scheduleFreshness(base, new Date('2026-10-01T00:00:00Z'));
    expect(r?.releasesBehind).toBe(1);
    expect(r?.message).toContain('~68.0');
  });

  it('counts three releases behind a year later', () =>
    expect(scheduleFreshness(base, new Date('2027-06-14T00:00:00Z'))?.releasesBehind).toBe(3));

  it('skips the guard when no asOf date is present (e.g. custom --schedule)', () =>
    expect(scheduleFreshness({ currentApiVersion: '67.0', rules: [] }, new Date('2030-01-01T00:00:00Z'))).toBeNull());

  it('skips the guard on a malformed asOf date', () =>
    expect(
      scheduleFreshness({ currentApiVersion: '67.0', currentApiVersionAsOf: 'Summer 26', rules: [] }, new Date('2030-01-01T00:00:00Z')),
    ).toBeNull());

  it('the shipped built-in schedule has a parseable asOf and is fresh at that month', () => {
    const s = loadSchedule();
    expect(s.currentApiVersionAsOf).toMatch(/^\d{4}-\d{2}$/);
    const [y, mo] = s.currentApiVersionAsOf!.split('-').map(Number);
    expect(scheduleFreshness(s, new Date(Date.UTC(y, mo - 1, 15)))).toBeNull();
  });
});
