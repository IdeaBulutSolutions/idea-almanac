# Almanac

**Find the Salesforce API versions in your org that are about to stop working — before they do.**

[![npm](https://img.shields.io/npm/v/idea-almanac)](https://www.npmjs.com/package/idea-almanac)
[![CI](https://github.com/IdeaBulutSolutions/idea-almanac/actions/workflows/ci.yml/badge.svg)](https://github.com/IdeaBulutSolutions/idea-almanac/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Salesforce retires old API versions on a schedule. Anything still pinned to a
retired version doesn't fail gently — it breaks with `410 GONE`. Almanac is two
things in one repo:

- a **scanner** that lists every API version in your Salesforce project or live
  org and puts a retirement date next to each one, and
- a **corpus** — a plain-language record of every Salesforce release since
  Winter '14 (v29 → v67, ~3,000 change entries written in our own words) — that
  tells you what actually changes when you upgrade.

> 🔒 **Privacy.** Scanning your project folder makes **zero network calls** —
> enforced by a test ([`no-network.test.ts`](packages/scanner/test/no-network.test.ts)).
> Scanning a live org only ever talks to *your* org, through *your* existing
> `sf` CLI login. Nothing is uploaded anywhere. No telemetry, no tracking.

## Quickstart

```bash
cd your-sfdx-project        # 1. go to your repo
npx idea-almanac scan       # 2. scan (writes almanac-report.json + .html)
open almanac-report.html    # 3. read the dates
```

No install, no config, no credentials, and **nothing else to download** — the
corpus of Salesforce changes ships inside the npm package, so `scan` and
`impact` work straight away. (You only need to clone this repo if you want to
rebuild the corpus or run the MCP server.)

**See it before you run it:**
[`packages/scanner/examples/`](packages/scanner/examples/) holds a real scan of
a deliberately old sample project — a class already failing, another retiring in
2028, and the impact report of what changes on upgrade.

## What it reports

Every Apex class/trigger, Flow, LWC, Aura component, Visualforce page,
`package.xml`, and your `sfdx-project.json` default — each with its API version
and a **dated tier**:

| Tier | Meaning |
|---|---|
| `retired` | API ≤ 30.0 — already failing since June 2025 (REST 410 / SOAP 500 / Bulk 400) |
| `breaks-2027` | SOAP `login()` on API ≤ 64.0 — retires Summer '27 |
| `breaks-2028` | API 31.0–40.0 — retires Summer '28 |
| `stale` | More than a year behind the current version |
| `current` | Fine |

Plus a debt score (0 = clean). Dates and tiers live in one data file
([`retirement-schedule.json`](packages/scanner/src/core/retirement-schedule.json))
— override it with `--schedule`.

## Usage

```
almanac scan [path]              scan an sfdx repo (default: cwd)
almanac scan --org <alias>       scan a live org via your existing sf CLI session
  --json <file> --html <file> --md <file>
  --fail-on retired|breaks-2027|breaks-2028|stale
  --schedule <file>
almanac impact --report <file>   what changes behavior on upgrade (corpus-backed)
  --no-llm | --llm  --lang <language>  --corpus <dir>
almanac --version
```

**Repo scans** walk your sfdx tree respecting `.gitignore` and `.forceignore`.

**Org scans** (`--org`) inventory Apex, Visualforce, Aura, LWC, and Flows via
the Tooling API, reusing the access token your `sf` CLI already holds. They
also report **integrations** — who is calling your org's API and at which
versions, from `ApiTotalUsage` event logs (no paid Event Monitoring required).

**CI gate:**

```bash
npx idea-almanac scan --fail-on retired   # exit 1 if anything is already broken
```

**Upgrade impact:** `almanac impact` pairs your scan report with the corpus and
writes a deterministic, citation-grounded `almanac-impact.md` — every change
cites a corpus entry id. Want a readable narrative? Either paste the
self-contained bundle (`--no-llm`) into your own assistant, or configure a
model (`ALMANAC_LLM_PROVIDER=claude-cli|copilot|cursor|anthropic|cmd`) and
Almanac applies a **groundedness gate**: if the model cites an id that isn't in
the corpus, the run fails — so it can't invent facts.

Full CLI documentation: [`packages/scanner/README.md`](packages/scanner/README.md).

## GitHub Action

```yaml
# .github/workflows/almanac.yml
on: [pull_request]
permissions: { contents: read, pull-requests: write }  # write only if comment-pr
jobs:
  almanac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: IdeaBulutSolutions/idea-almanac/packages/scanner/action@v1
        with:
          path: force-app        # your sfdx source
          fail-on: retired       # optional CI gate
          comment-pr: true       # optional: post the report on the PR
```

Outputs: `debt-score`, `retired-count`, `report-path`, `badge`.

## Ask the corpus directly (MCP)

The corpus runs as a zero-dependency, read-only, stdio MCP server:

```bash
cd packages/corpus && npm run mcp
```

Point Claude Desktop/Code (or any MCP client) at it and ask *"what breaks
between v48 and v67 for Apex?"* Tools: `list_versions`, `get_changes`,
`changes_between`, `search_corpus`.

## Repo layout

| Package | What |
|---|---|
| [`packages/scanner`](packages/scanner/) | `idea-almanac` CLI — scanner, impact layer, GitHub Action. Published to npm with the corpus data bundled in. |
| [`packages/corpus`](packages/corpus/) | Per-API-version change entries (YAML, v29 → v67), the PDF → YAML ingestion pipeline, golden-question acceptance harness, MCP server. |

The corpus contains **no verbatim Salesforce release-note text** — original
own-words summaries with source pointers (document, page, heading). See
[NOTICE](NOTICE).

## Development

```bash
npm ci                # Node >= 22.6
npm test              # vitest across all workspaces
npm run ci            # lint + typecheck + test + validate (same as CI)
npm run build -w idea-almanac   # build the CLI to packages/scanner/dist
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security
reports: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE) · built by [Idea Bulut Solutions](https://ideabulut.com).
Salesforce and related marks are trademarks of Salesforce, Inc.; this project
is not affiliated with or endorsed by Salesforce, Inc.
