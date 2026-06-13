# Changelog

All notable changes to the `idea-almanac` package. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## 0.1.0 — unreleased

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
