/**
 * Stage 1 — extract.
 *
 * PDF → pipeline/work/v{NN}/sections.jsonl, one record per leaf outline
 * section: {heading, breadcrumb[], page, text}.
 *
 * Approach (decided on the v67 PDF): Salesforce release-notes PDFs are
 * Prince-generated and carry a complete bookmark outline (v67: 2502 entries,
 * 4 levels). The outline IS the table of contents, so headings + hierarchy
 * come from it; text is extracted per page with y-coordinates and sliced at
 * heading positions.
 *
 * Resumable by design: per-page text is cached under work/v{NN}/pages/, so
 * the run can be interrupted and re-invoked until all pages are cached
 * (useful in time-boxed environments; harmless elsewhere). Use --max-pages
 * to bound one invocation.
 *
 * Usage:
 *   node --experimental-strip-types pipeline/src/extract.ts v67 [--max-pages 400]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = join(here, '..', '..');
const inputDir = join(corpusRoot, 'input-pdfs');
const workRoot = join(corpusRoot, 'pipeline', 'work');

interface OutlineEntry {
  title: string;
  depth: number;
  hasChildren: boolean;
  pageIndex: number; // 0-based
  y: number; // PDF user-space y of the destination (top of heading)
}

interface PageItem {
  s: string; // text
  x: number;
  y: number;
}

interface SectionRecord {
  heading: string;
  breadcrumb: string[];
  page: number; // 1-based PDF page of the heading
  text: string;
}

function fail(message: string): never {
  process.stderr.write(`extract: ${message}\n`);
  process.exit(1);
}

/** Spec §3.1 formula — expected release name for an API version. */
function expectedRelease(version: number): string {
  const offset = version - 31;
  const season = ((offset % 3) + 3) % 3;
  const summerYY = 14 + Math.floor(offset / 3);
  if (season === 0) return `Summer '${summerYY}`;
  if (season === 1) return `Winter '${summerYY + 1}`;
  return `Spring '${summerYY + 1}`;
}

const normalize = (s: string): string =>
  s.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();

// --------------------------------------------------------------------------
// CLI args
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const versionArg = args.find((a) => /^v\d{2}$/.test(a));
if (!versionArg) fail('usage: extract.ts v67 [--max-pages N]');
const maxPagesIdx = args.indexOf('--max-pages');
const maxPages = maxPagesIdx === -1 ? 400 : Number.parseInt(args[maxPagesIdx + 1] ?? '400', 10);

const versionNum = Number.parseInt(versionArg.slice(1), 10);
const pdfName = readdirSync(inputDir).find((f) => f.startsWith(`${versionArg}-`) && f.endsWith('.pdf'));
if (!pdfName) fail(`no PDF matching ${versionArg}-{season}{yy}.pdf in input-pdfs/`);
if (!/^v\d{2}-(spring|summer|winter)\d{2}\.pdf$/.test(pdfName)) {
  fail(`"${pdfName}" does not match the NAMING.md convention — refusing`);
}
const pdfPath = join(inputDir, pdfName);
const workDir = join(workRoot, versionArg);
const pagesDir = join(workDir, 'pages');
mkdirSync(pagesDir, { recursive: true });

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const loadingTask = getDocument({
  data: new Uint8Array(readFileSync(pdfPath)),
  useSystemFonts: true,
  // Note: pdf.js v6 removed the eval-based font path entirely (and with it
  // the isEvalSupported option) — cf. CVE-2024-4367, patched long before v6.
});
const doc = await loadingTask.promise;

// -- Title cross-check: outline root must name the expected release.
const expected = expectedRelease(versionNum);
const rawOutline = (await doc.getOutline()) ?? [];
if (rawOutline.length === 0) fail(`${pdfName} has no PDF outline — extraction approach assumes one`);
const rootTitle = normalize(rawOutline[0]?.title ?? '');
let titleOk = rootTitle.includes(normalize(expected));
if (!titleOk) {
  // Pre-~v33 release notes use a generic outline root ("About the Release
  // Notes"); fall back to other top-level outline titles, the PDF metadata
  // title, then the first page's text.
  titleOk = rawOutline.some((n) => normalize(n.title ?? '').includes(normalize(expected)));
}
if (!titleOk) {
  const meta = (await doc.getMetadata().catch(() => null)) as { info?: { Title?: string } } | null;
  titleOk = normalize(meta?.info?.Title ?? '').includes(normalize(expected));
}
if (!titleOk) {
  const page1 = await doc.getPage(1);
  const content = await page1.getTextContent();
  const text = normalize(
    content.items.map((i) => ('str' in i ? (i as { str: string }).str : '')).join(' '),
  );
  titleOk = text.includes(normalize(expected));
}
if (!titleOk) {
  fail(
    `title cross-check failed: ${pdfName} should be "${expected}" but the document says "${rootTitle}". ` +
      'The PDF is ground truth — fix the filename or replace the file.',
  );
}

// -- Flatten the outline, resolving destinations to (pageIndex, y).
interface RawOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutlineNode[];
}

const outline: OutlineEntry[] = [];
let unresolvedDests = 0;

async function resolveDest(dest: string | unknown[] | null): Promise<{ pageIndex: number; y: number } | null> {
  let explicit: unknown[] | null = Array.isArray(dest) ? dest : null;
  if (typeof dest === 'string') explicit = await doc.getDestination(dest);
  if (!explicit || explicit.length === 0) return null;
  try {
    const pageIndex = await doc.getPageIndex(explicit[0] as Parameters<typeof doc.getPageIndex>[0]);
    // XYZ destinations carry [ref, {name:'XYZ'}, x, y, zoom]; default to page top.
    const y = typeof explicit[3] === 'number' ? (explicit[3] as number) : 792;
    return { pageIndex, y };
  } catch {
    return null;
  }
}

async function flatten(
  nodes: RawOutlineNode[],
  depth: number,
  inherited: { pageIndex: number; y: number },
  topLevel = false,
): Promise<{ pageIndex: number; y: number }> {
  let cursor = inherited;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    // Salesforce PDFs emit stray top-level bookmarks beside the real root
    // (v67 has 38, carrying whole mis-nested subtrees — confirmed identical
    // in pypdf, so it's the PDF, not the parser). Re-parent them under the
    // root. Consequence: the FIRST breadcrumb element can be junk for those
    // subtrees; immediate parents remain correct, and Stage 2 matches any
    // breadcrumb element, so recall is unaffected.
    const d = topLevel && i > 0 ? 1 : depth;
    const resolved = await resolveDest(node.dest);
    if (resolved === null) unresolvedDests++;
    const pos = resolved ?? cursor; // inherit previous position when unresolvable
    cursor = pos;
    outline.push({
      title: normalize(node.title),
      depth: d,
      hasChildren: (node.items?.length ?? 0) > 0,
      pageIndex: pos.pageIndex,
      y: pos.y,
    });
    if (node.items && node.items.length > 0) {
      cursor = await flatten(node.items, d + 1, cursor);
    }
  }
  return cursor;
}
await flatten(rawOutline as RawOutlineNode[], 0, { pageIndex: 0, y: 792 }, true);
writeFileSync(join(workDir, 'outline.json'), JSON.stringify(outline, null, 1));

const numPages = doc.numPages;
writeFileSync(
  join(workDir, 'meta.json'),
  JSON.stringify(
    { file: pdfName, release: expected, pages: numPages, outlineEntries: outline.length, unresolvedDests },
    null,
    2,
  ),
);

// -- Cache page text (resumable).
const pageFile = (i: number): string => join(pagesDir, `${String(i + 1).padStart(4, '0')}.json`);
let extractedThisRun = 0;
let cached = 0;
for (let i = 0; i < numPages; i++) {
  if (existsSync(pageFile(i))) {
    cached++;
    continue;
  }
  if (extractedThisRun >= maxPages) continue;
  const page = await doc.getPage(i + 1);
  const content = await page.getTextContent();
  const items: PageItem[] = (content.items as { str: string; transform: number[] }[])
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ s: it.str, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0 }));
  writeFileSync(pageFile(i), JSON.stringify(items));
  page.cleanup();
  extractedThisRun++;
  cached++;
}

if (cached < numPages) {
  process.stdout.write(
    `extract: ${cached}/${numPages} pages cached (+${extractedThisRun} this run) — run again to continue.\n`,
  );
  process.exit(0);
}

// -- All pages cached: assemble sections.jsonl.
const pages: PageItem[][] = [];
for (let i = 0; i < numPages; i++) {
  pages.push(JSON.parse(readFileSync(pageFile(i), 'utf8')) as PageItem[]);
}

/** Document-order key: later page first; within a page, higher y comes first. */
const posKey = (pageIndex: number, y: number): number => pageIndex * 10000 + (1000 - y);

const headingKeys = outline.map((e) => posKey(e.pageIndex, e.y));

function sliceText(startIdx: number): { page: number; text: string } {
  const start = headingKeys[startIdx]!;
  // Section ends at the next outline entry positioned after this one.
  let end = Number.POSITIVE_INFINITY;
  for (let j = startIdx + 1; j < outline.length; j++) {
    if (headingKeys[j]! > start) {
      end = headingKeys[j]!;
      break;
    }
  }
  const entry = outline[startIdx]!;
  const lines: string[] = [];
  for (let p = entry.pageIndex; p < numPages; p++) {
    if (posKey(p, 1000) > end) break; // page starts after section end
    const lineMap = new Map<number, { x: number; s: string }[]>();
    for (const item of pages[p]!) {
      const k = posKey(p, item.y);
      if (k < start - 2 || k >= end) continue; // -2pt: keep the heading line itself
      const lineY = Math.round(item.y / 3) * 3;
      const line = lineMap.get(lineY) ?? [];
      line.push({ x: item.x, s: item.s });
      lineMap.set(lineY, line);
    }
    const ys = [...lineMap.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      lines.push(
        lineMap
          .get(y)!
          .sort((a, b) => a.x - b.x)
          .map((seg) => seg.s)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
  }
  return { page: entry.pageIndex + 1, text: lines.join('\n').trim() };
}

const breadcrumbStack: string[] = [];
const records: SectionRecord[] = [];
let leafCount = 0;
let leavesWithText = 0;

for (let i = 0; i < outline.length; i++) {
  const entry = outline[i]!;
  breadcrumbStack.length = entry.depth;
  breadcrumbStack[entry.depth] = entry.title;
  if (entry.hasChildren) continue; // leaf sections only
  leafCount++;
  const { page, text } = sliceText(i);
  if (text !== '') leavesWithText++;
  records.push({
    heading: entry.title,
    // Drop the document root (depth 0) — it's the same title on every record.
    breadcrumb: breadcrumbStack.slice(1, entry.depth),
    page,
    text,
  });
}

writeFileSync(
  join(workDir, 'sections.jsonl'),
  records.map((r) => JSON.stringify(r)).join('\n') + '\n',
);

const coverage = leafCount === 0 ? 0 : Math.round((1000 * leavesWithText) / leafCount) / 10;
process.stdout.write(
  [
    `extract: ${pdfName} ("${rootTitle}")`,
    `  pages: ${numPages} · outline entries: ${outline.length} (unresolved dests: ${unresolvedDests})`,
    `  leaf sections written: ${records.length} -> ${join('pipeline/work', versionArg, 'sections.jsonl')}`,
    `  Coverage: ${leavesWithText}/${leafCount} leaf sections with text (${coverage}%)${coverage >= 95 ? ' ✓' : ' ✗ BELOW 95%'}`,
    '',
  ].join('\n'),
);
await loadingTask.destroy();
