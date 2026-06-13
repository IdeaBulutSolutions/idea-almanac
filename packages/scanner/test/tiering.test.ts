import { describe, expect, it } from 'vitest';
import { assignTier, evaluate, loadSchedule } from '../src/core/tiering.js';

const schedule = loadSchedule();

const tierOf = (apiVersion: string | null, soapLogin = false) =>
  assignTier({ apiVersion, soapLogin }, schedule).tier;

describe('tiering rule boundaries', () => {
  // retired / breaks-2028 boundary at 30.0/31.0
  it('30.0 => retired', () => expect(tierOf('30.0')).toBe('retired'));
  it('31.0 => breaks-2028', () => expect(tierOf('31.0')).toBe('breaks-2028'));

  // breaks-2028 / stale boundary at 40.0/41.0
  it('40.0 => breaks-2028', () => expect(tierOf('40.0')).toBe('breaks-2028'));
  it('41.0 => stale', () => expect(tierOf('41.0')).toBe('stale'));

  // stale / current line: apiVersion < currentApiVersion - 3 (67 - 3 = 64)
  it('63.0 => stale', () => expect(tierOf('63.0')).toBe('stale'));
  it('64.0 => current', () => expect(tierOf('64.0')).toBe('current'));
  it('67.0 => current', () => expect(tierOf('67.0')).toBe('current'));

  // SOAP login()
  it('soapLogin at 64.0 => breaks-2027', () => expect(tierOf('64.0', true)).toBe('breaks-2027'));
  it('soapLogin at 65.0 => current (rule requires <= 64.0)', () =>
    expect(tierOf('65.0', true)).toBe('current'));
  it('soapLogin at 30.0 => retired (first matching rule wins)', () =>
    expect(tierOf('30.0', true)).toBe('retired'));

  it('null apiVersion => unknown, weight 0', () => {
    expect(assignTier({ apiVersion: null }, schedule)).toEqual({ tier: 'unknown', weight: 0 });
  });

  it('dated tiers carry their date and label into the result', () => {
    const t = assignTier({ apiVersion: '28.0' }, schedule);
    expect(t.date).toBe('2025-06');
    expect(t.label).toBe("Already failing - retired Summer '25 (REST 410 / SOAP 500 / Bulk 400)");
    expect(t.severity).toBe('critical');
    expect(t.weight).toBe(1.0);
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
