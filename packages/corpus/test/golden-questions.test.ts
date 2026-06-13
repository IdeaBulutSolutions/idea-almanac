import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = join(here, '..');

interface Question {
  id: string;
  question: string;
  span: { from: string; to: string };
  expectAll?: string[];
  expectAnyOf?: string[][];
}

const doc = parse(
  readFileSync(join(corpusRoot, 'golden-questions', 'questions.yaml'), 'utf8'),
) as { schemaVersion: string; questions: Question[] };

const promotedIds = new Set<string>();
for (const f of readdirSync(join(corpusRoot, 'data')).filter((f) => /^v\d{2}\.yaml$/.test(f))) {
  const data = parse(readFileSync(join(corpusRoot, 'data', f), 'utf8')) as {
    entries: { id: string }[];
  };
  for (const e of data.entries) promotedIds.add(e.id);
}

describe('golden questions (fixtures)', () => {
  it('has at least the 8 pilot questions with unique ids', () => {
    expect(doc.questions.length).toBeGreaterThanOrEqual(8);
    expect(new Set(doc.questions.map((q) => q.id)).size).toBe(doc.questions.length);
  });

  it('every expected entry id exists in promoted data/*.yaml', () => {
    const missing: string[] = [];
    for (const q of doc.questions) {
      for (const id of q.expectAll ?? []) if (!promotedIds.has(id)) missing.push(`${q.id}: ${id}`);
      for (const group of q.expectAnyOf ?? [])
        for (const id of group) if (!promotedIds.has(id)) missing.push(`${q.id}: ${id}`);
    }
    expect(missing).toEqual([]);
  });

  it('spans are well-formed and expected ids fall inside their question span', () => {
    for (const q of doc.questions) {
      const from = Number.parseFloat(q.span.from);
      const to = Number.parseFloat(q.span.to);
      expect(from).toBeLessThan(to);
      const inSpan = (id: string): boolean => {
        const v = Number.parseInt(id.slice(1, 3), 10);
        return v > from - 3 && v <= to; // file version; introducedIn may pull membership earlier
      };
      for (const id of q.expectAll ?? []) expect(inSpan(id), `${q.id}: ${id}`).toBe(true);
    }
  });
});
