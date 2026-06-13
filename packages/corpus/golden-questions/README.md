# Golden questions

Acceptance harness fixtures for the corpus. `questions.yaml` holds all 10
questions: gq-001..008 are the pilot set (v64→v67 spans);
gq-009..010 are the backfill set added 2026-06-11 once the full v31→v67
corpus was promoted — wide spans (v46→v52, v47→v55) over the long @AuraEnabled
with-sharing enforcement and Salesforce for Outlook retirement chains.

Two layers run this set:

- **Structural guard** (`test/golden-questions.test.ts`) — in the suite on every
  build: ≥10 unique-id questions, every expected id exists in promoted
  `data/*.yaml`, expectAll ids fall inside their span.
- **LLM-grading harness** (`harness.ts` + `run.ts`) — the real
  acceptance run. `harness.ts` (slice/ask/grade) is unit-tested offline in
  `test/golden-harness.test.ts`, including an "oracle" run proving every
  question is gradeable against its slices. Run it for real with:

  ```bash
  cd packages/corpus
  ALMANAC_LLM_PROVIDER=claude-cli npm run golden   # or anthropic | cmd
  ```

  It prints per-question ✓/✗ and exits 1 on any failure. Spends tokens and is
  non-deterministic, so run it **when its inputs change** — after promoting new
  corpus versions or editing questions, and on a release tag — not on every
  build and **never as a merge gate** (the structural guard gates merges). A
  path-filtered CI job on `data/**` + `questions.yaml`, plus manual dispatch, is
  the intended wiring.

## Harness contract

For each question:

1. **Slice**: load only `data/v{NN}.yaml` for versions in `(span.from, span.to]`.
2. **Ask**: feed the LLM the slices + the question; require citations of entry ids.
3. **Grade**:
   - every id in `expectAll` appears in the answer's citations;
   - for each group in `expectAnyOf`, at least one id of that group appears;
   - **groundedness gate**: any cited id that does not exist in the loaded
     slices fails the question (same rule as the impact layer).

Span membership uses `introducedIn ?? apiVersion` (schema 1.1.0) — an entry
filed in v67 with `introducedIn: 66.0` belongs to spans that cross 66.0, not
67.0. Do not key membership off the file the entry sits in.

A run passes when all questions pass. Flaky LLM grading should not gate merges —
run it per release / when the corpus or questions change, not on every build.
