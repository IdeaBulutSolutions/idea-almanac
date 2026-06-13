/**
 * Impact narrative layer. The deterministic union lives in
 * `impact.ts`; this turns it into the LLM-narrative step:
 *   - assemble a self-contained prompt bundle (prompt + report + corpus slices +
 *     the deterministic scaffold) — also what `--no-llm` writes for users who
 *     run their own assistant;
 *   - call an injected model, then enforce the GROUNDEDNESS GATE: every corpus
 *     entry id the model cites must exist in the loaded slices, else the run
 *     fails (no hallucinated citations ship).
 *
 * The model call is injected (`RunModel`), so the gate + assembly are tested
 * offline; the real provider lives in `llm.ts`.
 */
import type { Corpus } from './impact.js';

/** Corpus entry id, e.g. `v48-sharing-006`. */
const ENTRY_ID_RE = /\bv\d{2,3}-[a-z]+-\d{1,3}\b/g;

/** Every entry id present in the loaded corpus slices. */
export function collectValidIds(corpus: Corpus): Set<string> {
  const ids = new Set<string>();
  for (const f of corpus.files.values()) for (const e of f.entries) ids.add(e.id);
  return ids;
}

/** Distinct corpus entry ids cited anywhere in a markdown body. */
export function extractCitedIds(markdown: string): string[] {
  return [...new Set(markdown.match(ENTRY_ID_RE) ?? [])];
}

export interface GroundednessResult {
  citedIds: string[];
  /** Cited but absent from the loaded slices — hallucinated; these fail the run. */
  unknownIds: string[];
  ok: boolean;
}

/** The groundedness gate: no cited id may be outside the slices. */
export function checkGroundedness(markdown: string, validIds: Set<string>): GroundednessResult {
  const citedIds = extractCitedIds(markdown);
  const unknownIds = citedIds.filter((id) => !validIds.has(id));
  return { citedIds, unknownIds, ok: unknownIds.length === 0 };
}

export interface BundleParts {
  /** Text of `prompts/upgrade-impact-review.md`. */
  promptText: string;
  /** Raw `almanac-report.json` text. */
  reportJson: string;
  /**
   * The deterministic grounded markdown (renderImpactMarkdown output). This is
   * the corpus content the model works from — every relevant change, already
   * pulled from the spanned slices with its entry id, summary, and test. We do
   * NOT embed whole corpus files: for a deep span that's megabytes of redundant
   * YAML, and the scaffold already carries the grounded, cite-able subset.
   */
  deterministicMd: string;
  target: number;
  /**
   * Output language for all prose (default: English). Entry ids, versions,
   * dates, and code identifiers always stay as-is. Threaded from `--lang`.
   */
  language?: string;
}

/**
 * Assemble one self-contained markdown bundle: paste it into any assistant (or
 * feed it to the model) and you have the prompt plus every input it needs —
 * sized to the findings, not the whole corpus.
 */
export function assembleBundle(parts: BundleParts): string {
  const langLine =
    parts.language !== undefined && parts.language.trim() !== ''
      ? [
          `**Output language: ${parts.language.trim()}.** Write every sentence of prose in ` +
            `${parts.language.trim()}; keep corpus entry ids, API versions, dates, and code ` +
            'identifiers exactly as they appear below.',
          '',
        ]
      : [];
  return [
    `# Almanac upgrade-impact bundle — target API ${parts.target.toFixed(1)}`,
    '',
    'Self-contained: the instructions, the scan report, and the grounded list of',
    'every change that applies across the span (with corpus entry ids). Paste it',
    'into your assistant. You may ONLY cite the entry ids that appear below —',
    'anything else is a hallucination and will be rejected.',
    '',
    ...langLine,
    '---',
    '',
    '## Instructions (prompt)',
    '',
    parts.promptText.trim(),
    '',
    '---',
    '',
    '## Scan report (JSON)',
    '',
    '```json',
    parts.reportJson.trim(),
    '```',
    '',
    '---',
    '',
    '## Grounded changes across the span (cite these ids; do not invent others)',
    '',
    parts.deterministicMd.trim(),
    '',
  ].join('\n');
}

/** A model invocation: prompt in, markdown out. Sync to match the corpus provider. */
export type RunModel = (prompt: string) => string;

export interface NarrativeResult {
  markdown: string;
  groundedness: GroundednessResult;
}

/**
 * Run the assembled prompt through a model and apply the groundedness gate.
 * Throws if the model cites ids absent from the slices — uncited claims never
 * ship.
 */
export function generateNarrative(
  prompt: string,
  validIds: Set<string>,
  runModel: RunModel,
): NarrativeResult {
  const markdown = runModel(prompt);
  const groundedness = checkGroundedness(markdown, validIds);
  if (!groundedness.ok) {
    throw new Error(
      `Groundedness gate failed: the model cited ${groundedness.unknownIds.length} id(s) ` +
        `not in the loaded corpus slices: ${groundedness.unknownIds.join(', ')}`,
    );
  }
  return { markdown, groundedness };
}
