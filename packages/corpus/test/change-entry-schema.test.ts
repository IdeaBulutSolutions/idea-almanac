import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(here, '..', 'schema', 'change-entry.schema.json'), 'utf8'),
);
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

type VersionFile = {
  apiVersion: string;
  release: string;
  reviewed?: boolean;
  entries: Record<string, unknown>[];
};

const loadValid = (): VersionFile =>
  parse(readFileSync(join(here, 'fixtures', 'valid-v55.yaml'), 'utf8')) as VersionFile;

describe('change-entry.schema.json (frozen contract)', () => {
  it('accepts the three hand-written sample entries', () => {
    const doc = loadValid();
    expect(doc.entries).toHaveLength(3);
    const ok = validate(doc);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('rejects a non-additive entry without upgradeAction', () => {
    const doc = loadValid();
    delete doc.entries[0]!.upgradeAction; // entry 0 is impact: breaking
    expect(validate(doc)).toBe(false);
  });

  it('accepts an additive entry without upgradeAction', () => {
    const doc = loadValid();
    expect(doc.entries[1]!.impact).toBe('additive');
    expect(doc.entries[1]!.upgradeAction).toBeUndefined();
    expect(validate(doc)).toBe(true);
  });

  it('accepts an entry with introducedIn and entries without it (schema 1.1.0)', () => {
    const doc = loadValid();
    expect(doc.entries[0]!.introducedIn).toBe('54.0');
    expect(doc.entries[1]!.introducedIn).toBeUndefined();
    expect(validate(doc)).toBe(true);
  });

  it('rejects a malformed introducedIn', () => {
    const doc = loadValid();
    doc.entries[0]!.introducedIn = '54'; // must be NN.0
    expect(validate(doc)).toBe(false);
  });

  it('rejects a malformed id', () => {
    const doc = loadValid();
    doc.entries[0]!.id = 'apex-v55-1'; // wrong shape
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown enum value', () => {
    const doc = loadValid();
    doc.entries[0]!.impact = 'catastrophic';
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown affectedMetadataTypes value', () => {
    const doc = loadValid();
    doc.entries[0]!.affectedMetadataTypes = ['ApexClass', 'Workflow'];
    expect(validate(doc)).toBe(false);
  });

  it('rejects a source missing its page', () => {
    const doc = loadValid();
    doc.entries[0]!.source = { document: 'v55-summer22.pdf', heading: 'x' };
    expect(validate(doc)).toBe(false);
  });

  it('rejects unknown extra fields (schema is a frozen contract)', () => {
    const doc = loadValid();
    doc.entries[0]!.vibes = 'immaculate';
    expect(validate(doc)).toBe(false);
  });

  it('rejects a source document that does not follow the NAMING.md convention', () => {
    const doc = loadValid();
    (doc.entries[0]!.source as Record<string, unknown>).document = 'release-notes.pdf';
    expect(validate(doc)).toBe(false);
  });
});
