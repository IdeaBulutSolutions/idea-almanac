# Changelog

All notable changes to the `idea-almanac` package. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## 0.3.0 — unreleased

- **New: schedule staleness guard.** Each scan checks the built-in
  `currentApiVersion` against Salesforce's ~3-releases-a-year cadence
  (`currentApiVersionAsOf`). If it has fallen behind, the scan notes that drift
  distances may be understated and that the tool should be updated — recorded in
  the report and printed to stderr. Advisory; it never fails the run.
- Version-distance tiers — `current` / `behind` / `far-behind` (+ `unknown`) —
  with an upgrade-readiness **staleness score** (0 = everything current).
  `breaks-2027` applies only to dated SOAP `login()` integration findings on org
  scans.
- Corpus-grounded AI upgrade handoff: a golden-master-via-validation procedure
  for Apex, two named validation gates, modernization suggestions kept separate
  from the version bump, review-only handling for Flow/LWC/Aura, a
  production-deploy guard keyed on `Organization.IsSandbox`, and a remote-LLM
  egress warning (a local CLI provider is the default).
- Managed/namespaced components are excluded from the upgradeable inventory.
- Documentation refresh; READMEs in plain language with npm-safe absolute links;
  the corpus ships inside the package (no clone needed to `scan` or `impact`).

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
  the report includes a `stalenessScoreBreakdown` (formula, per-tier contributions,
  plain-language band) and a `recommendedFloor` — the lowest API version in the
  `current` tier (the recommended upgrade target). HTML report shows the metadata
  name, drops empty date cells, explains the staleness score, and surfaces the floor hint.
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
  or a live org (via your existing `sf` CLI session), with version-distance
  tiers (`current`, `behind`, `far-behind`) and a staleness score. Org scans
  additionally surface `breaks-2027` for dated SOAP integrations. JSON, HTML,
  and Markdown reports; `--fail-on` CI gate; `--schedule` override.
- `almanac impact` — corpus-grounded upgrade impact report: every cited change
  references a corpus entry id. Optional AI narrative via `claude-cli`,
  `copilot`, `anthropic`, or `cmd` providers, with a groundedness gate; or a
  paste-anywhere bundle with `--no-llm`.
- Corpus: 39 Salesforce releases (v29 Winter '14 → v67 Summer '26), ~3,000
  own-words change entries with source pointers, bundled into the package.
- Zero-dependency MCP server over the corpus (`list_versions`, `get_changes`,
  `changes_between`, `search_corpus`).
- GitHub Action (`packages/scanner/action`) with `staleness-score`,
  `far-behind-count`, `report-path`, `badge` outputs and optional PR comment.

## 0.0.1 — 2026-06

npm placeholder release.
