import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  compileSchemaValidator,
  lintDocument,
  validateDocument,
  type VersionDocument,
} from '../pipeline/src/validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const validateSchema = compileSchemaValidator(
  readFileSync(join(here, '..', 'schema', 'change-entry.schema.json'), 'utf8'),
);

const loadValid = (): VersionDocument =>
  parse(readFileSync(join(here, 'fixtures', 'valid-v55.yaml'), 'utf8')) as VersionDocument;

describe('validate stage', () => {
  it('passes the valid fixture (schema + lint)', () => {
    const errors = validateDocument(validateSchema, loadValid(), {
      fileName: 'v55.yaml',
      pdfPages: 500,
    });
    expect(errors).toEqual([]);
  });

  it('reports schema errors via ajv', () => {
    const doc = loadValid();
    delete (doc.entries[0] as Record<string, unknown>).upgradeAction; // breaking entry
    const errors = validateDocument(validateSchema, doc);
    expect(errors.some((e) => e.startsWith('schema:'))).toBe(true);
  });

  it('rejects duplicate ids within a file', () => {
    const doc = loadValid();
    doc.entries[1]!.id = doc.entries[0]!.id;
    // keep schema-valid: copy entry 0 wholesale under entry 1's slot
    doc.entries[1] = { ...doc.entries[0]! };
    expect(lintDocument(doc).some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('rejects duplicate ids across files via shared seenIds', () => {
    const seenIds = new Set<string>();
    expect(lintDocument(loadValid(), { seenIds })).toEqual([]);
    const errors = lintDocument(loadValid(), { seenIds });
    expect(errors.filter((e) => e.includes('duplicate id'))).toHaveLength(3);
  });

  it('rejects an entry whose apiVersion disagrees with the file header', () => {
    const doc = loadValid();
    doc.entries[0]!.apiVersion = '54.0';
    const errors = lintDocument(doc);
    expect(errors.some((e) => e.includes('does not match file header 55.0'))).toBe(true);
    // id prefix check also fires? No — id is still v55-…, apiVersion mismatch only.
  });

  it('rejects an id whose version prefix disagrees with the file', () => {
    const doc = loadValid();
    doc.entries[0]!.id = 'v54-apex-001';
    expect(lintDocument(doc).some((e) => e.includes('id prefix'))).toBe(true);
  });

  it('rejects introducedIn equal to or later than apiVersion', () => {
    const doc = loadValid();
    doc.entries[0]!.introducedIn = '55.0';
    expect(lintDocument(doc).some((e) => e.includes('strictly earlier'))).toBe(true);
    doc.entries[0]!.introducedIn = '56.0';
    expect(lintDocument(doc).some((e) => e.includes('strictly earlier'))).toBe(true);
    doc.entries[0]!.introducedIn = '54.0';
    expect(lintDocument(doc)).toEqual([]);
  });

  it('rejects a source.page beyond the PDF page count', () => {
    const doc = loadValid();
    const errors = lintDocument(doc, { pdfPages: 400 }); // fixture cites page 412
    expect(errors.some((e) => e.includes('exceeds PDF page count'))).toBe(true);
  });

  it('skips the page-bound check when pdfPages is unknown', () => {
    expect(lintDocument(loadValid())).toEqual([]);
  });

  it('rejects a source.document version that disagrees with the file', () => {
    const doc = loadValid();
    doc.entries[0]!.source.document = 'v54-spring22.pdf';
    expect(lintDocument(doc).some((e) => e.includes('source.document'))).toBe(true);
  });

  it('rejects a filename that disagrees with the header apiVersion', () => {
    const errors = lintDocument(loadValid(), { fileName: 'v56.yaml' });
    expect(errors.some((e) => e.includes('does not match filename'))).toBe(true);
  });
});
