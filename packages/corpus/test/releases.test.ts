import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const doc = parse(
  readFileSync(join(here, '..', 'data', 'releases.yaml'), 'utf8'),
) as { verified: boolean; releases: { apiVersion: string; release: string }[] };

/**
 * Spec §3.1 formula: Summer 'YY -> version 31 + 3*(YY - 14); three releases
 * per year (Summer, Winter, Spring); Winter is named for the FOLLOWING year.
 * Works below v31 too (v29 = Winter '14, v30 = Spring '14) via floored modulo.
 */
function expectedRelease(version: number): string {
  const offset = version - 31;
  const cycle = Math.floor(offset / 3);
  const season = ((offset % 3) + 3) % 3;
  const summerYY = 14 + cycle;
  if (season === 0) return `Summer '${summerYY}`;
  if (season === 1) return `Winter '${summerYY + 1}`;
  return `Spring '${summerYY + 1}`;
}

describe('releases.yaml', () => {
  it('covers v29 through v67 contiguously', () => {
    const versions = doc.releases.map((r) => Number.parseFloat(r.apiVersion));
    expect(versions).toHaveLength(39);
    expect(versions[0]).toBe(29);
    expect(versions[38]).toBe(67);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBe(versions[i - 1]! + 1);
    }
  });

  it('matches the generating formula for every version', () => {
    for (const r of doc.releases) {
      expect(r.release, `apiVersion ${r.apiVersion}`).toBe(
        expectedRelease(Number.parseFloat(r.apiVersion)),
      );
    }
  });

  it('places the v58/v59 boundary per the spec footnote (Summer \'23 = v58, Winter \'24 = v59)', () => {
    const v58 = doc.releases.find((r) => r.apiVersion === '58.0');
    const v59 = doc.releases.find((r) => r.apiVersion === '59.0');
    expect(v58?.release).toBe("Summer '23");
    expect(v59?.release).toBe("Winter '24");
  });

  it("anchors: v29 = Winter '14, v31 = Summer '14, v67 = Summer '26", () => {
    expect(doc.releases[0]).toEqual({ apiVersion: '29.0', release: "Winter '14" });
    expect(doc.releases[2]).toEqual({ apiVersion: '31.0', release: "Summer '14" });
    expect(doc.releases[38]).toEqual({ apiVersion: '67.0', release: "Summer '26" });
  });

  it('is verified against the PDF title pages (v58/v59 boundary confirmed 2026-06-11)', () => {
    expect(doc.verified).toBe(true);
  });
});
