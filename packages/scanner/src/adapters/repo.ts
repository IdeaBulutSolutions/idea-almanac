/**
 * Repo adapter. Walks an sfdx project tree and normalizes
 * every versioned artifact into the common inventory model.
 *
 * TRUST INVARIANT: this module makes ZERO network calls — filesystem only.
 * Enforced by test/no-network.test.ts.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, basename, resolve, sep } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  ComponentType,
  Inventory,
  InventoryItem,
  ScanWarning,
} from '../core/inventory.js';

const ALWAYS_SKIP = new Set(['node_modules', '.sfdx', '.git', '.sf', 'dist', 'coverage']);

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

export function scanRepo(rootPath: string): Inventory {
  const root = resolve(rootPath);
  const items: InventoryItem[] = [];
  const warnings: ScanWarning[] = [];
  const ignore = loadGitignore(root);

  const files: string[] = [];
  walk(root, root, ignore, files);

  // Pass 1: project default — needed to resolve inherited LWC versions, and
  // always reported as its own line item (people forget it constantly).
  let sourceApiVersion: string | null = null;
  for (const file of files) {
    if (basename(file) === 'sfdx-project.json') {
      const rel = relPath(root, file);
      try {
        const project = JSON.parse(readFileSync(file, 'utf8')) as {
          sourceApiVersion?: string;
        };
        sourceApiVersion = project.sourceApiVersion ?? null;
        items.push({
          id: rel,
          type: 'ProjectDefault',
          apiVersion: sourceApiVersion,
          versionSource: 'explicit',
          location: rel,
        });
        if (sourceApiVersion === null) {
          warnings.push({
            code: 'missing-source-api-version',
            message: 'sfdx-project.json has no sourceApiVersion',
            location: rel,
          });
        }
      } catch {
        warnings.push({
          code: 'malformed-json',
          message: 'Could not parse sfdx-project.json',
          location: rel,
        });
      }
    }
  }

  // Pass 2: everything else.
  for (const file of files) {
    const name = basename(file);
    if (name === 'sfdx-project.json') continue;
    const rel = relPath(root, file);

    if (name === 'package.xml') {
      const version = readXmlVersion(file, rel, 'version', warnings);
      if (version !== undefined) {
        items.push({
          id: rel,
          type: 'Manifest',
          apiVersion: version,
          versionSource: 'explicit',
          location: rel,
        });
      }
      continue;
    }

    const type = classify(rel);
    if (type === null) continue;

    const apiVersion = readXmlVersion(file, rel, 'apiVersion', warnings);
    if (apiVersion === undefined) continue; // malformed — warning already recorded

    if (apiVersion === null && type === 'LWC') {
      // apiVersion tag optional for LWC pre-Spring '25 => inherit project default.
      items.push({
        id: rel,
        type,
        apiVersion: sourceApiVersion,
        versionSource: 'inherited',
        location: rel,
      });
      if (sourceApiVersion === null) {
        warnings.push({
          code: 'unresolved-inherited-version',
          message:
            'LWC has no apiVersion and no sfdx-project.json sourceApiVersion to inherit',
          location: rel,
        });
      }
      continue;
    }

    if (apiVersion === null) {
      warnings.push({
        code: 'missing-api-version',
        message: `${type} meta file has no <apiVersion>`,
        location: rel,
      });
      items.push({ id: rel, type, apiVersion: null, versionSource: 'explicit', location: rel });
      continue;
    }

    items.push({ id: rel, type, apiVersion, versionSource: 'explicit', location: rel });
  }

  // Derive the metadata API name from each item's path (location == rel here),
  // so reporters can show "AccountTrigger" instead of an opaque path/id.
  for (const it of items) it.name = componentName(it.location);

  return { items, integrations: [], warnings };
}

/**
 * Metadata API/developer name from a repo path: the basename with the
 * `-meta.xml` suffix and the metadata extension stripped, e.g.
 * `.../classes/AncientHelper.cls-meta.xml` → `AncientHelper`,
 * `.../lwc/orderList/orderList.js-meta.xml` → `orderList`.
 */
export function componentName(rel: string): string {
  const base = rel.split('/').pop() ?? rel;
  return base
    .replace(/-meta\.xml$/, '')
    .replace(/\.(cls|trigger|flow|js|cmp|app|evt|intf|page|component)$/, '');
}

/** Map a relative path to a component type, or null to skip. */
export function classify(rel: string): ComponentType | null {
  const p = rel.split(sep).join('/');
  if (p.endsWith('.cls-meta.xml')) return 'ApexClass';
  if (p.endsWith('.trigger-meta.xml')) return 'ApexTrigger';
  if (p.endsWith('.flow-meta.xml')) return 'Flow';
  if (p.endsWith('.js-meta.xml') && p.includes('/lwc/')) return 'LWC';
  if (
    p.includes('/aura/') &&
    (p.endsWith('.cmp-meta.xml') ||
      p.endsWith('.app-meta.xml') ||
      p.endsWith('.evt-meta.xml') ||
      p.endsWith('.intf-meta.xml'))
  ) {
    return 'Aura';
  }
  if (p.endsWith('.page-meta.xml')) return 'VisualforcePage';
  if (p.endsWith('.component-meta.xml')) return 'VisualforceComponent';
  return null;
}

/**
 * Parse an XML file and read a version tag (`apiVersion` or `version`) from
 * its root element. Returns:
 *   - "55.0"   tag present
 *   - null     valid XML, tag absent
 *   - undefined  malformed XML (warning recorded — never a crash)
 */
function readXmlVersion(
  file: string,
  rel: string,
  tag: 'apiVersion' | 'version',
  warnings: ScanWarning[],
): string | null | undefined {
  const text = readFileSync(file, 'utf8');
  if (XMLValidator.validate(text) !== true) {
    warnings.push({ code: 'malformed-xml', message: 'Could not parse XML', location: rel });
    return undefined;
  }
  const doc = parser.parse(text) as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(doc)) {
    if (key.startsWith('?')) continue; // XML declaration
    const value = doc[key]?.[tag];
    if (value === undefined || value === null) return null;
    const version = String(value).trim();
    return /^\d+(\.\d+)?$/.test(version) ? normalizeVersion(version) : null;
  }
  return null;
}

function normalizeVersion(v: string): string {
  return v.includes('.') ? v : `${v}.0`;
}

function relPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

// ---------------------------------------------------------------------------
// Directory walk with basic .gitignore support
// ---------------------------------------------------------------------------

interface IgnoreRule {
  pattern: string;
  dirOnly: boolean;
  anchored: boolean;
}

/**
 * Minimal ignore-file support (root `.gitignore` AND root `.forceignore` —
 * sfdx projects routinely use the latter): comments, dir/ suffix, leading-/
 * anchoring, * and ? globs within a single segment. Negation (!) patterns are
 * not supported and are skipped. Good enough for repo scans;
 * node_modules/.sfdx/.git are always skipped regardless.
 */
function loadGitignore(root: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const name of ['.gitignore', '.forceignore']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
      const dirOnly = line.endsWith('/');
      const anchored = line.startsWith('/');
      const pattern = line.replace(/\/+$/, '').replace(/^\//, '');
      rules.push({ pattern, dirOnly, anchored });
    }
  }
  return rules;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('')
    .map((ch) => {
      if (ch === '*') return '[^/]*';
      if (ch === '?') return '[^/]';
      return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    })
    .join('');
  return new RegExp(`^${escaped}$`);
}

function isIgnored(rel: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  const p = rel.split(sep).join('/');
  const name = p.split('/').pop() ?? p;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    const re = globToRegExp(rule.pattern);
    if (rule.anchored || rule.pattern.includes('/')) {
      if (re.test(p)) return true;
    } else if (re.test(name)) {
      return true;
    }
  }
  return false;
}

function walk(root: string, dir: string, rules: IgnoreRule[], out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      if (isIgnored(rel, true, rules)) continue;
      walk(root, full, rules, out);
    } else if (entry.isFile()) {
      if (isIgnored(rel, false, rules)) continue;
      out.push(full);
    }
  }
}
