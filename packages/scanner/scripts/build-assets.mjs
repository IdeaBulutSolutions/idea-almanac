// Build-time asset copy (no shell-isms, works on Windows too).
//
// 1. retirement-schedule.json -> dist/ (read at runtime next to compiled code)
// 2. ../corpus/data/*.yaml -> corpus-data/  (bundled into the published npm
//    package so `npx idea-almanac impact` finds corpus data without a
//    monorepo checkout — see defaultCorpusDir() in src/cli.ts)
//
// Copies file-by-file with overwrite and treats cleanup as best-effort, so a
// half-written previous run or odd file permissions never brick the build.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(join(pkgRoot, 'dist', 'core'), { recursive: true });
copyFileSync(
  join(pkgRoot, 'src', 'core', 'retirement-schedule.json'),
  join(pkgRoot, 'dist', 'core', 'retirement-schedule.json'),
);

// LICENSE + NOTICE live at the repo root; npm only packs files inside the
// package dir, so copy them in at build time.
for (const f of ['LICENSE', 'NOTICE']) {
  const src = join(pkgRoot, '..', '..', f);
  if (existsSync(src)) copyFileSync(src, join(pkgRoot, f));
}

const corpusSrc = join(pkgRoot, '..', 'corpus', 'data');
const corpusDest = join(pkgRoot, 'corpus-data');

if (!existsSync(corpusSrc)) {
  console.warn('corpus data not found at ../corpus/data — package will rely on --corpus/ALMANAC_CORPUS_DIR');
} else {
  // Best-effort cleanup of files that no longer exist upstream.
  const wanted = new Set(readdirSync(corpusSrc).filter((f) => f.endsWith('.yaml')));
  mkdirSync(corpusDest, { recursive: true });
  for (const f of readdirSync(corpusDest)) {
    if (!wanted.has(f)) {
      try {
        rmSync(join(corpusDest, f), { force: true });
      } catch {
        console.warn(`could not remove stale ${f} (continuing)`);
      }
    }
  }
  let copied = 0;
  for (const f of wanted) {
    // writeFileSync overwrite is more permission-tolerant than copyFileSync
    // on some mounts; content equality is all that matters here.
    writeFileSync(join(corpusDest, f), readFileSync(join(corpusSrc, f)));
    copied++;
  }
  console.log(`bundled ${copied} corpus files -> ${corpusDest}`);
}
