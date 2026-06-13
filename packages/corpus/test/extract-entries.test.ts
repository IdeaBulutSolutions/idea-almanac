import { describe, expect, it } from 'vitest';
import {
  assignIds,
  cacheKey,
  isVagueAppliesWhen,
  parseResponse,
  sharesShingle,
} from '../pipeline/src/extract-entries.ts';

describe('own-words shingle check', () => {
  const source =
    'Apex database operations, such as SOSL and SOQL queries, DML statements, and Database methods, now run in user mode by default.';

  it('rejects a summary copied from the source', () => {
    expect(
      sharesShingle('Apex database operations such as SOSL and SOQL queries now behave differently', source),
    ).toBe(true);
  });

  it('accepts a genuinely rewritten summary', () => {
    expect(
      sharesShingle(
        'DML and queries switch to user-mode defaults, so the running user\'s permissions suddenly apply.',
        source,
      ),
    ).toBe(false);
  });

  it('ignores punctuation and case differences when matching', () => {
    expect(sharesShingle('apex DATABASE operations; such as sosl AND soql queries, dml statements!', source)).toBe(true);
  });

  it('never fires on short summaries (< 8 words)', () => {
    expect(sharesShingle('Apex database operations such as SOSL', source)).toBe(false);
  });
});

describe('vague appliesWhen detection', () => {
  it.each([
    ['components compiled at API >= 55.0', false],
    ['Apex classes pinned below v60', false],
    ['org-wide regardless of component API version', false],
    ['applies to all orgs starting Summer 26', false],
    ['enforced with the release update', false],
    ['API requests at version 66.0 and later', false],
    ['API requests targeting version 67.0 and later', false],
    ['scheduled flows using runtime version of 63.0 or later', false],
    ['when using the feature', true],
    ['in some situations', true],
  ])('%s -> vague=%s', (s, vague) => {
    expect(isVagueAppliesWhen(s)).toBe(vague);
  });
});

describe('response parsing', () => {
  it('parses a bare JSON array', () => {
    expect(parseResponse('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it('parses a fenced array with chatter around it', () => {
    expect(parseResponse('Here you go:\n```json\n[{"a":1}]\n```\nDone.')).toEqual([{ a: 1 }]);
  });
  it('parses an empty array', () => {
    expect(parseResponse('[]')).toEqual([]);
  });
  it('throws on non-JSON responses', () => {
    expect(() => parseResponse('I cannot help with that.')).toThrow();
  });
});

describe('deterministic id assignment', () => {
  it('sequences per area slug', () => {
    const entries = [
      { behaviorArea: 'apex-runtime' },
      { behaviorArea: 'apex-testing' },
      { behaviorArea: 'soql-sosl' },
      { behaviorArea: 'apex-runtime' },
      { behaviorArea: 'nonsense' },
    ];
    assignIds(entries, 'v67');
    expect(entries.map((e) => (e as { id?: string }).id)).toEqual([
      'v67-apex-001',
      'v67-apex-002',
      'v67-soql-001',
      'v67-apex-003',
      'v67-other-001',
    ]);
  });
});

describe('cache key', () => {
  it('is stable for identical inputs and distinct otherwise', () => {
    expect(cacheKey('p', 'claude-cli', '')).toBe(cacheKey('p', 'claude-cli', ''));
    expect(cacheKey('p', 'claude-cli', '')).not.toBe(cacheKey('p', 'copilot-cli', ''));
    expect(cacheKey('p', 'claude-cli', '')).not.toBe(cacheKey('q', 'claude-cli', ''));
  });
});
