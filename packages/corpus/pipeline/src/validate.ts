/**
 * Stage 4 — validate.
 *
 * ajv against change-entry.schema.json plus lint rules the schema cannot
 * express:
 *   - unique entry ids (within a file and across the whole run)
 *   - entry apiVersion / release match the file header
 *   - entry id version prefix matches the file (v55-… in v55.yaml)
 *   - source.document version matches the file
 *   - introducedIn, when present, is STRICTLY earlier than apiVersion
 *     (schema 1.1.0 — see schema/CHANGELOG.md)
 *   - source.page within the PDF page count, when pipeline/work/v{NN}/meta.json
 *     is available (skipped with a note otherwise — PDFs are gitignored)
 *
 * Runs in CI on data/v*.yaml — invalid corpus data fails the build.
 *
 * Usage:
 *   node --experimental-strip-types pipeline/src/validate.ts            # all data/v*.yaml
 *   node --experimental-strip-types pipeline/src/validate.ts data/v65.yaml pipeline/work/v66/entries.yaml
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { parse as yamlParse } from 'yaml';

// --------------------------------------------------------------------------
// Pure core (exported for tests)
// --------------------------------------------------------------------------

export interface VersionDocument {
  apiVersion: string;
  release: string;
  reviewed?: boolean;
  entries: ChangeEntry[];
}

export interface ChangeEntry {
  id: string;
  apiVersion: string;
  introducedIn?: string;
  release: string;
  impact: string;
  source: { document: string; page: number; heading: string };
  [key: string]: unknown;
}

export interface ValidateOptions {
  /** Filename the document came from, e.g. "v55.yaml" — enables the filename↔apiVersion check. */
  fileName?: string;
  /** Total PDF page count (work/v{NN}/meta.json `pages`) — enables the source.page bound check. */
  pdfPages?: number;
  /** Entry ids already seen in this run, for cross-file uniqueness. Mutated. */
  seenIds?: Set<string>;
}

const versionNumber = (v: string): number => Number.parseFloat(v);

/**
 * Lint a parsed version document. Returns human-readable errors; empty array
 * means the document passes every rule the schema cannot express.
 */
export function lintDocument(doc: VersionDocument, opts: ValidateOptions = {}): string[] {
  const errors: string[] = [];
  const seen = opts.seenIds ?? new Set<string>();

  if (opts.fileName !== undefined) {
    // 2–3 digits: Salesforce reaches v100 around 2037.
    const m = /^v(\d{2,3})\.yaml$/.exec(opts.fileName);
    if (m && `${m[1]}.0` !== doc.apiVersion) {
      errors.push(`file ${opts.fileName}: header apiVersion ${doc.apiVersion} does not match filename`);
    }
  }

  const filePrefix = `v${Number.parseInt(doc.apiVersion, 10)}-`;
  for (const entry of doc.entries) {
    const at = `entry ${entry.id}`;
    if (seen.has(entry.id)) errors.push(`${at}: duplicate id`);
    seen.add(entry.id);
    if (!entry.id.startsWith(filePrefix)) {
      errors.push(`${at}: id prefix does not match file apiVersion ${doc.apiVersion}`);
    }
    if (entry.apiVersion !== doc.apiVersion) {
      errors.push(`${at}: apiVersion ${entry.apiVersion} does not match file header ${doc.apiVersion}`);
    }
    if (entry.release !== doc.release) {
      errors.push(`${at}: release "${entry.release}" does not match file header "${doc.release}"`);
    }
    if (
      entry.introducedIn !== undefined &&
      versionNumber(entry.introducedIn) >= versionNumber(entry.apiVersion)
    ) {
      errors.push(
        `${at}: introducedIn ${entry.introducedIn} must be strictly earlier than apiVersion ${entry.apiVersion} (omit when equal)`,
      );
    }
    if (!entry.source.document.startsWith(filePrefix)) {
      errors.push(`${at}: source.document ${entry.source.document} does not match file apiVersion`);
    }
    if (opts.pdfPages !== undefined && entry.source.page > opts.pdfPages) {
      errors.push(`${at}: source.page ${entry.source.page} exceeds PDF page count ${opts.pdfPages}`);
    }
  }
  return errors;
}

export function compileSchemaValidator(schemaJson: string): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(JSON.parse(schemaJson) as Record<string, unknown>);
}

/** ajv + lint in one pass. */
export function validateDocument(
  validateSchema: ValidateFunction,
  doc: unknown,
  opts: ValidateOptions = {},
): string[] {
  if (!validateSchema(doc)) {
    return (validateSchema.errors ?? []).map(
      (e) => `schema: ${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
    );
  }
  return lintDocument(doc as VersionDocument, opts);
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const invokedDirectly = process.argv[1]?.endsWith('validate.ts') ?? false;

if (invokedDirectly) {
  const corpusRoot = join(here, '..', '..');
  const dataDir = join(corpusRoot, 'data');

  const args = process.argv.slice(2);
  const files =
    args.length > 0
      ? args.map((a) => join(process.cwd(), a))
      : readdirSync(dataDir)
          .filter((f) => /^v\d{2,3}\.yaml$/.test(f)) // 3 digits from v100 (~2037)
          .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))
          .map((f) => join(dataDir, f));

  if (files.length === 0) {
    console.log('validate: no data/v*.yaml files yet (pilot promotion pending) — nothing to check.');
    process.exit(0);
  }

  const validateSchema = compileSchemaValidator(
    readFileSync(join(corpusRoot, 'schema', 'change-entry.schema.json'), 'utf8'),
  );

  const seenIds = new Set<string>();
  let failed = false;
  for (const file of files) {
    const doc = yamlParse(readFileSync(file, 'utf8')) as VersionDocument;
    const name = basename(file);

    let pdfPages: number | undefined;
    const versionMatch = /^(\d{2,3})\.0$/.exec(doc?.apiVersion ?? '');
    if (versionMatch) {
      const metaPath = join(corpusRoot, 'pipeline', 'work', `v${versionMatch[1]}`, 'meta.json');
      if (existsSync(metaPath)) {
        pdfPages = (JSON.parse(readFileSync(metaPath, 'utf8')) as { pages: number }).pages;
      }
    }

    const errors = validateDocument(validateSchema, doc, { fileName: name, pdfPages, seenIds });
    if (errors.length > 0) {
      failed = true;
      console.error(`✗ ${name} — ${errors.length} error(s):`);
      for (const e of errors) console.error(`    ${e}`);
    } else {
      const pageNote = pdfPages === undefined ? ' (page-bound check skipped: no meta.json)' : '';
      console.log(`✓ ${name} — ${(doc.entries ?? []).length} entries valid${pageNote}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
