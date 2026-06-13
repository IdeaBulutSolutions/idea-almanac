/**
 * Generate data/index.yaml — the corpus manifest.
 *
 * One line per version file: apiVersion, release, entry count, reviewed flag.
 * Plus corpusVersion (schema version from change-entry.schema.json) and
 * generation metadata. Regenerate after any data/*.yaml change:
 *
 *   npm run manifest
 *
 * CI check: `npm run manifest -- --check` exits 1 if data/index.yaml is stale.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';

interface VersionDoc {
  apiVersion: string;
  release: string;
  reviewed?: boolean;
  entries: unknown[];
}

export interface ManifestRow {
  apiVersion: string;
  release: string;
  entryCount: number;
  reviewed: boolean;
}

export function buildManifest(dataDir: string, schemaPath: string): string {
  const files = readdirSync(dataDir)
    .filter((f) => /^v\d{2,3}\.yaml$/.test(f)) // 3 digits from v100 (~2037)
    .sort((a, b) => Number.parseInt(a.slice(1)) - Number.parseInt(b.slice(1)));

  const rows: ManifestRow[] = files.map((f) => {
    const doc = yamlParse(readFileSync(join(dataDir, f), 'utf8')) as VersionDoc;
    return {
      apiVersion: doc.apiVersion,
      release: doc.release,
      entryCount: doc.entries.length,
      reviewed: doc.reviewed === true,
    };
  });

  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { version?: string };
  const total = rows.reduce((s, r) => s + r.entryCount, 0);
  const reviewedCount = rows.filter((r) => r.reviewed).length;

  const lines: string[] = [
    '# Corpus manifest. GENERATED — do not edit by hand.',
    '# Regenerate with: npm run manifest   (CI verifies freshness via --check)',
    `corpusVersion: "${schema.version ?? '1.1.0'}"`,
    `versions: ${rows.length}`,
    `reviewedVersions: ${reviewedCount}`,
    `totalEntries: ${total}`,
    'files:',
  ];
  for (const r of rows) {
    lines.push(
      `  - { apiVersion: "${r.apiVersion}", release: "${r.release.replace(/"/g, '\\"')}", entries: ${r.entryCount}, reviewed: ${r.reviewed} }`,
    );
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const invokedDirectly = process.argv[1]?.endsWith('manifest.ts') ?? false;

if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const corpusRoot = join(here, '..', '..');
  const dataDir = join(corpusRoot, 'data');
  const schemaPath = join(corpusRoot, 'schema', 'change-entry.schema.json');
  const outPath = join(dataDir, 'index.yaml');

  const fresh = buildManifest(dataDir, schemaPath);

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8');
    } catch {
      /* missing counts as stale */
    }
    if (current !== fresh) {
      console.error('✗ data/index.yaml is stale — run `npm run manifest` and commit the result.');
      process.exit(1);
    }
    console.log('✓ data/index.yaml is up to date.');
    process.exit(0);
  }

  writeFileSync(outPath, fresh);
  console.log(`✓ wrote ${outPath}`);
}
