# idea-almanac

**Find the Salesforce API versions in your org that are about to stop working — before they do.**

> 🔒 **Trust promise.** Repo scans make **zero network calls** (enforced by a test in this repo: [`test/no-network.test.ts`](test/no-network.test.ts)). Org scans only call *your* org via *your* existing `sf` CLI session. Nothing is ever uploaded anywhere. No telemetry, no update checks. Don't trust us — read the source; it's small on purpose.

## Quickstart (3 steps, that's the whole point)

```bash
cd your-sfdx-project        # 1. go to your repo
npx idea-almanac scan       # 2. scan (writes almanac-report.json + .html)
open almanac-report.html    # 3. read the dates
```

CI gate:

```bash
npx idea-almanac scan --fail-on retired      # exit 1 if anything is already broken
```

**See it first:** [`examples/`](examples/) has a real scan of a deliberately-aging
repo (API 28.0 → 67.0) — a class already failing (REST `410 GONE`), another retiring in
2028, and a [corpus-backed impact report](examples/almanac-impact.md) of what
breaks on upgrade. No org required.

## What it reports

Every Apex class/trigger, Flow, LWC, Aura component, Visualforce page, `package.xml`, and your `sfdx-project.json` default — each with its API version and a **dated tier**:

| Tier | Meaning |
|---|---|
| `retired` | API ≤ 30.0 — already failing since June 2025 (REST 410 / SOAP 500 / Bulk 400) |
| `breaks-2027` | SOAP `login()` on API ≤ 64.0 — retires Summer '27 |
| `breaks-2028` | API 31.0–40.0 — retires Summer '28 |
| `stale` | More than a year behind the current version |
| `current` | Fine |

Dates and tiers live in one data file ([`src/core/retirement-schedule.json`](src/core/retirement-schedule.json)) — override it with `--schedule`.

**Debt score** (secondary to the dates): `round(100 × Σ weight(tier) / N)` over all findings, where weights are `retired 1.0, breaks-2027 0.9, breaks-2028 0.7, stale 0.15, current 0`. 0 = clean.

## Usage

```
almanac scan [path]              scan an sfdx repo (default: cwd)
almanac scan --org <alias>       scan a live org via your existing sf CLI session
                                 (omit <alias> for your default org)
  --json <file> --html <file> --md <file>
  --fail-on retired|breaks-2027|breaks-2028|stale
  --schedule <file>
almanac --version                print version
```

Repo scans walk your sfdx tree respecting the root `.gitignore` **and**
`.forceignore` (comments, `dir/`, leading-`/`, `*`/`?` globs; `!` negations are
skipped). `node_modules`, `.sfdx`, `.git` are always skipped.

### Org scans

`--org` inventories a live org's Apex classes, triggers, Visualforce
pages/components, Aura bundles, LWC bundles, and Flows via the **Tooling API**,
reusing the access token your `sf` CLI already holds — Almanac never asks for or
stores credentials, and the only host it talks to is your own org.

```bash
sf org login web --alias prod     # if you're not already authenticated
almanac scan --org prod           # writes almanac-report.json + .html
```

No session? You get a one-line message telling you to log in — never a stack trace.

Org scans also report **integrations**: who is calling your org's API and at
which versions, read from `ApiTotalUsage` event logs (no paid Event Monitoring
required — 1-day retention free, 30 with it). SOAP `login()` usage is called out
separately because it retires Summer '27. If those logs aren't readable, you get
an "integration visibility unavailable" note — the scan never fails on it.

## Upgrade impact (what actually changes behavior)

A scan tells you *what version* things are on; `impact` tells you *what changes*
when you cross to the target, by pairing the report with the [corpus](../corpus/):

```bash
almanac impact --report almanac-report.json        # writes almanac-impact.md
```

That `almanac-impact.md` is deterministic and grounded — every change cites a
corpus entry id. On top of it you can get a ranked, readable narrative two ways:

- **Your own assistant (default, zero trust required):** with no model
  configured, `impact` also writes `almanac-impact-bundle.md` — a self-contained
  prompt + report + grounded change list you paste into any assistant. Force it
  with `--no-llm`.
- **A configured model:** set `ALMANAC_LLM_PROVIDER` (`claude-cli` | `copilot` |
  `anthropic` | `cmd`) and pass `--llm`; Almanac runs the narrative and applies a
  **groundedness gate** — if the model cites any id not in the loaded corpus
  slices, the run fails. No hallucinated citations ship.

Corpus data ships **inside this package** (bundled at build), so
`npx idea-almanac impact` works out of the box; override with `--corpus <dir>`
or `ALMANAC_CORPUS_DIR`.

`--lang <language>` makes the AI narrative/bundle come back in that language
(entry ids, versions, and dates stay as-is) — e.g. `--lang Turkish`. The
[`explain-to-my-manager`](prompts/explain-to-my-manager.md) and
[`upgrade-impact-review`](prompts/upgrade-impact-review.md) prompts produce
three layers: a short executive summary, a high-level summary for
non-technical readers, and an in-depth section for the technical manager.

Prefer MCP? The corpus also runs as a zero-dependency
[MCP server](../corpus/mcp/server.ts) (`npm run mcp` in `packages/corpus`), so
your assistant can query "what breaks between v48 and v67?" directly.

## GitHub Action

Scan on every PR and (optionally) fail the build or comment the report:

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
          fail-on: retired        # optional CI gate
          comment-pr: true        # optional: post the report on the PR
```

Inputs: `path`, `org` (alias, for org scans), `fail-on`, `comment-pr`, `command`.
Outputs: `debt-score`, `retired-count`, `report-path`, `badge`.

The Action also emits a **shields.io badge snippet** for your README (and the job
summary), e.g.:

```markdown
![Almanac API debt](https://img.shields.io/badge/API%20debt-1%20retired-red)
```

> A dynamic, always-current endpoint badge is planned; for now the badge is a
> static snippet you paste after a scan.

## Part of Almanac

The scanner tells you **what** will break and **when**. The [Almanac corpus](../corpus/) tells you **what changes behavior** when you bump each version. The [prompt library](prompts/) turns a report (and the corpus) into a ranked test plan, a manager-friendly summary, or an adversarial security audit of the trust claims.

---

Apache-2.0 · built by [Idea Bulut Solutions](https://ideabulut.com)
