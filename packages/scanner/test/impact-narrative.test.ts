/**
 * Impact narrative layer: bundle assembly + the groundedness gate.
 * The model call is injected, so the gate is tested without any provider.
 */
import { describe, expect, it } from 'vitest';
import {
  assembleBundle,
  checkGroundedness,
  collectValidIds,
  extractCitedIds,
  generateNarrative,
} from '../src/analysis/impact-narrative.js';
import type { Corpus } from '../src/analysis/impact.js';

function corpusWith(ids: string[]): Corpus {
  return {
    warnings: [],
    files: new Map([
      [
        60,
        {
          apiVersion: '60.0',
          release: "Spring '24",
          reviewed: true,
          entries: ids.map((id) => ({ id })),
        },
      ],
    ]),
  } as unknown as Corpus;
}

describe('impact narrative', () => {
  it('extracts and de-dupes corpus entry ids from markdown', () => {
    const ids = extractCitedIds('uses v60-rest-001, again v60-rest-001, and v67-soap-002.');
    expect(ids).toEqual(['v60-rest-001', 'v67-soap-002']);
  });

  it('collectValidIds gathers every id across the loaded slices', () => {
    const valid = collectValidIds(corpusWith(['v60-rest-001', 'v60-flow-009']));
    expect([...valid].sort()).toEqual(['v60-flow-009', 'v60-rest-001']);
  });

  it('groundedness gate flags ids not present in the slices', () => {
    const valid = collectValidIds(corpusWith(['v60-rest-001']));
    const ok = checkGroundedness('cite v60-rest-001 here', valid);
    expect(ok.ok).toBe(true);
    const bad = checkGroundedness('cite v60-rest-001 and v99-fake-001', valid);
    expect(bad.ok).toBe(false);
    expect(bad.unknownIds).toEqual(['v99-fake-001']);
  });

  it('assembleBundle is self-contained and proportional (no raw corpus files)', () => {
    const bundle = assembleBundle({
      promptText: '# Upgrade-impact review\nInstructions here.',
      reportJson: '{"debtScore":27}',
      deterministicMd: '# scaffold\n- **[breaking]** ... (v60-rest-001)',
      target: 67,
    });
    expect(bundle).toContain('## Instructions (prompt)');
    expect(bundle).toContain('## Scan report (JSON)');
    expect(bundle).toContain('v60-rest-001');
    expect(bundle).toContain('target API 67.0');
    // It must NOT embed whole corpus YAML files.
    expect(bundle).not.toContain('```yaml');
    // No language requested => no language instruction injected.
    expect(bundle).not.toContain('Output language');
  });

  it('assembleBundle injects the output-language instruction when given (--lang)', () => {
    const bundle = assembleBundle({
      promptText: 'Instructions.',
      reportJson: '{}',
      deterministicMd: '- (v60-rest-001)',
      target: 67,
      language: 'Turkish',
    });
    expect(bundle).toContain('**Output language: Turkish.**');
    expect(bundle).toContain('keep corpus entry ids, API versions, dates');
  });

  it('generateNarrative returns a gated narrative, throwing on hallucinated ids', async () => {
    const valid = collectValidIds(corpusWith(['v60-rest-001', 'v65-soap-002']));
    const good = await generateNarrative('prompt', valid, () => 'See v60-rest-001 and v65-soap-002.');
    expect(good.groundedness.ok).toBe(true);
    expect(good.groundedness.citedIds.length).toBe(2);

    await expect(
      generateNarrative('prompt', valid, () => 'Also v99-fake-001.'),
    ).rejects.toThrow(/groundedness gate failed/i);

    // An async (streaming) model is awaited the same way.
    const streamed = await generateNarrative('prompt', valid, () =>
      Promise.resolve('See v60-rest-001.'),
    );
    expect(streamed.groundedness.ok).toBe(true);
  });
});
