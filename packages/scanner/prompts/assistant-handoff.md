---
name: assistant-handoff
purpose: >-
  Orient an AI coding assistant (Claude Code, Copilot, Cowork, etc.) pointed at
  this repo: where the CLI, schemas, corpus, and prompts live, and the sequence
  to run. Not a prompt — a run-mode README the agent reads first.
inputs:
  - this repository
model_notes: >-
  Read this before doing anything else in the repo. Repo scans never touch the
  network; don't add code that does. The corpus is ground truth; cite entry ids,
  never invent them.
---

# Assistant handoff

You are an AI assistant working in the **Almanac** repo. Almanac has two halves:
a **scanner** that finds Salesforce API-version debt, and a **corpus** that
records what each version changes. Here's where things live and what to run.

## Map

- **CLI:** `packages/scanner/src/cli.ts` → built to `packages/scanner/dist/cli.js`.
  Build with `npm run build -w idea-almanac`. Commands: `scan [path]`,
  `scan --org <alias>`, `impact --report <json>`.
- **Adapters:** `packages/scanner/src/adapters/` — `repo.ts` (filesystem, zero
  network) and `org.ts` (Tooling/Data API via the user's `sf` session).
- **Corpus data:** `packages/corpus/data/v{NN}.yaml` (v31→v67), plus
  `releases.yaml`. Each entry has an `id`, `impact`, `summary`, `upgradeAction`,
  `source`, and optional `introducedIn`.
- **Schemas:** `packages/corpus/schema/change-entry.schema.json`,
  `packages/scanner/schema/report.schema.json`.
- **Prompts:** `packages/scanner/prompts/` — `upgrade-impact-review`,
  `explain-to-my-manager`, `brutal-security-review`, and this file.
- **Examples:** `packages/scanner/examples/` — a real scan + impact report.

## Sequence

1. `npm ci && npm run build -w idea-almanac`
2. Scan: `node packages/scanner/dist/cli.js scan <sfdx-path>` (or `--org <alias>`)
   → writes `almanac-report.json` + `.html`.
3. Impact: `node packages/scanner/dist/cli.js impact --report almanac-report.json`
   → grounded markdown of what changes behavior across the span.
4. For narrative/business/security output, feed the report (and corpus slices)
   to the matching prompt in `prompts/`.

## Ground rules

- **Repo scans make zero network calls** — enforced by
  `packages/scanner/test/no-network.test.ts`. Never add a network path reachable
  from repo mode.
- **The corpus is ground truth.** Cite entry ids; never invent versions, dates,
  or ids. If a version has no corpus file, say so.
- **Verify before you trust.** Run `npm run ci` (lint + typecheck + test +
  validate) before claiming anything works.
- Don't commit on the user's behalf; report "ready to commit" instead.
