# Changelog

All notable changes to the `idea-almanac` package. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## 0.2.1 — unreleased

Documentation only — no code or behavior changes.

- Rewrote the README files in plain, beginner-friendly language.
- Fixed links in the published package README to absolute GitHub URLs so they
  work on npmjs.com and after install (the old monorepo-relative links 404'd).
- Made explicit that the corpus ships inside the package — no repo clone needed
  to scan or run `impact`.
- Switched the documentation's example language from Turkish to Spanish.

## 0.2.0 — 2026-06

- `almanac scan --mode <tier>` — run a whole pipeline in one command:
  `impact` (scan + upgrade-impact), `manager` (+ manager explanation + effort
  estimate), or `full` (+ agent upgrade guide). Honors all impact flags and
  `--fail-on`.
- Prompt library additions: `effort-estimate` (AI-assisted fix-and-release
  timeline by severity, full-to-current vs. breaking-changes-first),
  `upgrade-guide` (dependency-aware, agent-driven upgrade procedure with a
  never-touch-production guardrail and permission-set guidance), and
  `deprecation-horizon` (read-only dated calendar of what's going away).
- Report **schema 1.2.0**: each component now carries its metadata API `name`;
  the report includes a `debtScoreBreakdown` (formula, per-tier contributions,
  plain-language band) and a `nonBreakingFloor` — the lowest API version that
  clears every dated retirement tier (the nearest non-breaking target). HTML
  report shows the metadata name, drops empty date cells, explains the debt
  score, and surfaces the non-breaking-floor hint.
- AI steps print clear progress + per-step timing so a long run reads as working,
  not frozen.
- AI reviews default to the **top 50 most urgent components** (`--limit <n|all>`,
  or confirm interactively) so a large org doesn't spend tokens on everything by
  surprise; the scan report still lists every component.
- Every AI-assisted artifact carries a **disclaimer**: figures are AI-assisted
  and corpus-grounded, AI can err, always test in a non-production environment
  before deploying, and Idea Bulut Solutions is not liable for issues introduced.
- New `cursor` LLM provider (Cursor CLI headless, `cursor-agent -p`), and a
  per-call timeout for all providers (`ALMANAC_LLM_TIMEOUT_MS`, default 10 min)
  so a hung agent CLI surfaces a clear error instead of stalling.

## 0.1.0 — 2026-06

First public release.

- `almanac scan` — API version inventory of an sfdx repo (zero network calls)
  or a live org (via your existing `sf` CLI session), with dated retirement
  tiers (`retired`, `breaks-2027`, `breaks-2028`, `stale`, `current`) and a
  debt score. JSON, HTML, and Markdown reports; `--fail-on` CI gate;
  `--schedule` override.
- `almanac impact` — corpus-grounded upgrade impact report: every cited change
  references a corpus entry id. Optional AI narrative via `claude-cli`,
  `copilot`, `anthropic`, or `cmd` providers, with a groundedness gate; or a
  paste-anywhere bundle with `--no-llm`.
- Corpus: 39 Salesforce releases (v29 Winter '14 → v67 Summer '26), ~3,000
  own-words change entries with source pointers, bundled into the package.
- Zero-dependency MCP server over the corpus (`list_versions`, `get_changes`,
  `changes_between`, `search_corpus`).
- GitHub Action (`packages/scanner/action`) with `debt-score`,
  `retired-count`, `report-path`, `badge` outputs and optional PR comment.

## 0.0.1 — 2026-06

npm placeholder release.
