# idea-almanac

**Find which Salesforce API versions in your project or org have drifted from current — and get a safe, structured upgrade path.**

Salesforce API versions accumulate silently. Components pinned to old versions keep running — Salesforce does not break saved Apex or metadata on retirement — but they accumulate **drift**: each missed release is behavior the platform changed without your code being tested against it. Almanac scans your project (or a live org), finds everything that has drifted from current, and hands you a **safe, structured path to upgrade**.

Beyond the scan, Almanac ships two things built for the upgrade itself: a
reviewed, **citable corpus** of what behavior changed across the releases you
skipped, and an **AI upgrade handoff** that turns that corpus into a safe,
test-gated procedure an agent can follow.

It does this two ways:

- **Repo scan** — points at your Salesforce project folder and reads the metadata files. It makes **zero network calls** (a test, [`no-network.test.ts`](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/scanner/test/no-network.test.ts), enforces this). Nothing leaves your machine.
- **Org scan** — points at a live org and reads it through your existing `sf` CLI login. The only server it ever talks to is your own org. No passwords, no uploads, no telemetry.

## Quickstart (3 steps)

```bash
cd your-sfdx-project        # 1. go to your Salesforce project folder
npx idea-almanac scan       # 2. scan it (writes almanac-report.json + almanac-report.html)
open almanac-report.html    # 3. open the report and read the dates
```

That's it. No install, no account, no config.

**Want to see a report first?** The [`examples/` folder](https://github.com/IdeaBulutSolutions/idea-almanac/tree/main/packages/scanner/examples) has a real scan of a deliberately old sample project (API 28 → 67) — tier names, staleness score, and an [upgrade-impact report](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/scanner/examples/almanac-impact.md) of what accumulated while the code stayed pinned. No org needed.

## Do I need to download anything else? No.

Everything Almanac needs is **inside the npm package** — including its built-in database of Salesforce changes (the "corpus"). You do **not** need to clone the GitHub repo to scan, to run an upgrade-impact report, or to use the prompts. `npx idea-almanac …` just works.

(You'd only clone the repo if you want to rebuild the corpus from Salesforce release notes yourself, or run the optional MCP server — neither is needed for normal use.)

## Common recipes (copy & paste)

`npx idea-almanac@latest` always runs the newest version. Prefer a permanent `almanac` command? Install it once (next section) and drop the `npx` prefix.

### Install it permanently (optional)

```bash
npm install -g idea-almanac@latest      # now you can just type `almanac`
almanac --version
```

### Scan one project

```bash
cd path/to/sfdx-project
npx idea-almanac@latest scan            # writes the report into the current folder
open almanac-report.html
```

### Scan a live org

```bash
sf org login web --alias prod           # log in once (if you haven't already)
npx idea-almanac@latest scan --org prod
```

Not logged in? You get a short message telling you how — never a crash.

### Do everything in one command (`--mode`)

`--mode` runs a whole pipeline at once. The levels build on each other — pick how far you want to go:

| `--mode` | What it does | Files it adds |
|---|---|---|
| `scan` (default) | the scan only | `almanac-report.json` + `.html` |
| `impact` | + what actually changes on upgrade | `almanac-impact.md` |
| `manager` | + a plain-English summary for your manager + an effort estimate | `almanac-manager*`, `almanac-estimate*` |
| `full` | + a step-by-step upgrade guide for an AI coding agent | `almanac-upgrade-guide*` |

The AI steps use whatever model you've set in `ALMANAC_LLM_PROVIDER`. If you haven't set one, Almanac instead writes a ready-to-paste `*-bundle.md` file you can drop into any AI chat yourself.

```bash
# technical: scan + what changes on upgrade
npx idea-almanac@latest scan path/to/sfdx-project --mode impact

# for your manager: scan + summary + effort estimate, written in Spanish by Claude
ALMANAC_LLM_PROVIDER=claude-cli \
  npx idea-almanac@latest scan path/to/sfdx-project --mode manager --llm --lang Spanish

# everything, against a live org — adds the AI upgrade guide
sf org login web --alias prod
ALMANAC_LLM_PROVIDER=claude-cli \
  npx idea-almanac@latest scan --org prod --mode full --llm
```

A few good-to-knows:

- On a big org, the AI review looks at the **top 50 most urgent components by default** (it asks you first, or you can set `--limit <n>` or `--limit all`). The scan report still lists *every* component — only the AI review is trimmed, to keep cost and time down.
- Every AI-written file starts with a **disclaimer**: the numbers are AI-assisted, AI can be wrong, and you must **test in a non-production environment before deploying**. Testing and deployment are your responsibility.
- `--mode full-impact` still works as an old name for `--mode impact`.

### Scan several projects into one folder

The report files have default names, so they'd overwrite each other. Give each one its own path:

```bash
mkdir -p ~/almanac-results
REPOS=( ~/code/repo1 ~/code/repo2 ~/code/repo3 )
for r in "${REPOS[@]}"; do
  name=$(basename "$r")
  npx idea-almanac@latest scan "$r" \
    --json ~/almanac-results/$name.json \
    --html ~/almanac-results/$name.html \
    --md   ~/almanac-results/$name.md
done
open ~/almanac-results
```

### Use it as a CI check

```bash
npx idea-almanac@latest scan --fail-on far-behind   # exits with an error if any component is 10+ releases behind
```

### A summary for your manager, in Spanish

The `explain-to-my-manager` prompt turns a scan report into a one-page, plain-language summary. The easy way is `--mode manager --llm` above. To run the prompt by hand:

```bash
cd path/to/sfdx-project
npx idea-almanac@latest scan

PROMPT="$(npm root -g)/idea-almanac/prompts/explain-to-my-manager.md"   # needs the global install

claude -p "$(cat "$PROMPT")

Language: Spanish. Write every sentence in Spanish; keep dates, counts, and
component names exactly as they appear.

--- almanac-report.json ---
$(cat almanac-report.json)" > resumen-para-gerente.md
```

You get a one-page summary with three layers: a short executive summary, a non-technical dated risk list, and a more technical section — all built only from the real dates and counts in your report.

### A "how long will this take?" effort estimate

```bash
cd path/to/sfdx-project
npx idea-almanac@latest scan
npx idea-almanac@latest impact --report almanac-report.json --no-llm   # optional, sharpens the estimate

PROMPT="$(npm root -g)/idea-almanac/prompts/effort-estimate.md"

claude -p "$(cat "$PROMPT")

Team: 2 developers. Language: Spanish.

--- almanac-report.json ---
$(cat almanac-report.json)

--- almanac-impact.md ---
$(cat almanac-impact.md)" > estimacion-de-esfuerzo.md
```

It gives two options — fix everything vs. fix only the breaking changes first — each broken down by severity, with a timeline. Tell it your team size to turn effort into calendar weeks. Drop the `Language:` line for English.

## Hand the results to an AI agent (cheaper and grounded)

Almanac isn't just a report to file away. Its output is a small, tidy package you can hand to an AI coding agent (Claude Code, Cursor, Copilot, Cowork) so it can help fix your org — using far fewer tokens, and without making things up.

**Why fewer tokens.** Pasting your whole project plus all of Salesforce's release-note history into an AI is huge and mostly irrelevant. Almanac does the narrowing first, in plain code (free):

- `scan` boils a whole project/org down to a structured list of only the parts with version debt.
- `impact` attaches **only the Salesforce changes between your versions and the target** — not the entire history.

So the agent gets a small, focused brief instead of everything.

**Why you can trust it.** Every change in `almanac-impact.md` cites a real entry from the built-in corpus. A "groundedness gate" automatically fails the run if the AI cites an entry that isn't in the data — so it can't invent fake version numbers or dates.

**The files you can hand off:**

| File | What it's for | How to get it |
|---|---|---|
| `almanac-report.json` | the structured list of version debt | `scan` |
| `almanac-impact.md` | what changes on upgrade, with citations and a test for each | `impact` |
| `almanac-impact-bundle.md` | the prompt + report + data in one file, ready to paste into any AI | `impact --no-llm` |
| [prompt library](prompts/) | ready-made prompts (upgrade review, manager summary, security audit) | feed with the report |
| [`upgrade-guide.md`](prompts/upgrade-guide.md) | walks an agent through the actual upgrade — reads the report, the impact, **and your real metadata**, follows links between components (a Flow that calls an LWC that calls Apex), and writes an ordered, testable plan | `--mode full` |
| [`assistant-handoff.md`](prompts/assistant-handoff.md) | a one-page orientation for an agent working inside the source repo | read first |
| [corpus MCP server](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/corpus/mcp/server.ts) | lets an agent ask the corpus "what changed between v48 and v67?" live | `npm run mcp` in `packages/corpus` |

## What's in the report

Almanac checks every Apex class and trigger, Flow, LWC, Aura component, Visualforce page, `package.xml`, and your `sfdx-project.json` default. Each one gets an API version and a dated **tier**:

| Tier | What it means |
|---|---|
| `current` | Within 3 releases of current — fine |
| `behind` | 4–9 releases behind — drift accumulating |
| `far-behind` | 10+ releases behind — high behavioral drift |

Org scans also surface `breaks-2027` for SOAP integrations still calling the API at version 64 or older (retires Summer 2027). These dates aren't hardcoded — they live in one file, [`retirement-schedule.json`](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/scanner/src/core/retirement-schedule.json), and you can swap it with `--schedule`.

The report also gives a **recommended floor** (`recommendedFloor`): the lowest API version in the `current` tier — the recommended upgrade target. The HTML report surfaces this as a hint when any dated integration findings fall below it.

**Staleness score.** A single 0–100 number (0 = clean). It's a weighted average of how far behind each component is — useful as a headline metric. The HTML report shows exactly how the score was calculated.

## All the options

```
almanac scan [path]              scan a Salesforce project folder (default: current folder)
almanac scan --org <alias>       scan a live org through your sf CLI login
                                 (leave out <alias> to use your default org)
almanac scan --mode <tier>       run a whole pipeline (scan | impact | manager | full)
almanac impact --report <json>   show what changes on upgrade, from the corpus

Scan options:
  --json <file>     where to write the JSON report   (default: ./almanac-report.json)
  --html <file>     where to write the HTML report   (default: ./almanac-report.html)
  --md <file>       also write a Markdown report     (off by default)
  --mode <tier>     scan | impact | manager | full (each builds on the last)
  --fail-on <tier>  exit with an error if anything is in this tier (for CI)
  --schedule <file> use your own retirement schedule instead of the built-in one

Impact / AI options:
  --report <json>   the almanac-report.json from a scan (required for `impact`)
  --target <ver>    target API version (default: the current version)
  --llm             use an AI model to write the narrative (needs ALMANAC_LLM_PROVIDER)
  --no-llm          write a paste-ready bundle instead of calling a model
  --lang <language> output language for the AI text (default: English), e.g. --lang Spanish
  --limit <n|all>   how many components the AI reviews (default: top 50)
  -y, --yes         skip the "this is a big review" prompt (for scripts/CI)

  -v, --version     print the version
```

Repo scans skip `node_modules`, `.sfdx`, and `.git`, and respect your `.gitignore` and `.forceignore`.

### About org scans

`--org` reads your org's Apex, Visualforce, Aura, LWC, and Flows through the Salesforce Tooling API, reusing the login your `sf` CLI already has. Almanac never asks for or stores credentials.

Org scans also list **integrations** — which outside systems call your org's API, and at which versions — read from free `ApiTotalUsage` event logs. SOAP `login()` usage is flagged separately because it retires in Summer 2027. If those logs aren't available, you just get a note; the scan never fails because of it.

### Choosing an AI model

For any `--llm` step, set one environment variable:

```
ALMANAC_LLM_PROVIDER = claude-cli | copilot | cursor | cmd | anthropic
```

**Local providers (recommended — no content leaves your machine):**

- `claude-cli` — the `claude` CLI (`claude -p`). Default choice; runs locally through your existing Claude login.
- `copilot` — the GitHub Copilot CLI
- `cursor` — the Cursor CLI (`cursor-agent -p`)
- `cmd` — any command you choose, via `ALMANAC_LLM_CMD`

**Remote provider:**

- `anthropic` — the Anthropic API (needs `ANTHROPIC_API_KEY`). Almanac prints a
  data-egress warning before sending any content. For air-gapped or
  privacy-sensitive orgs, use a local provider instead. Note: having
  `ANTHROPIC_API_KEY` set does **not** automatically select this provider —
  you must set `ALMANAC_LLM_PROVIDER=anthropic` explicitly.

Each AI call is capped by `ALMANAC_LLM_TIMEOUT_MS` (default 10 minutes) so a stuck CLI can never hang Almanac. No provider set? Almanac just writes the paste-ready bundle instead.

The built-in corpus ships inside this package, so `impact` works with no setup. (Advanced: point at a different corpus with `--corpus <dir>` or `ALMANAC_CORPUS_DIR`.)

## Run it on every pull request (GitHub Action)

```yaml
# .github/workflows/almanac.yml
on: [pull_request]
permissions: { contents: read, pull-requests: write }   # write only if comment-pr is on
jobs:
  almanac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: IdeaBulutSolutions/idea-almanac/packages/scanner/action@v1
        with:
          path: force-app        # your Salesforce source folder
          fail-on: far-behind     # optional: fail the build on high-drift components
          comment-pr: true        # optional: post the report as a PR comment
```

Inputs: `path`, `org`, `fail-on`, `comment-pr`, `command`. Outputs: `staleness-score`, `far-behind-count`, `report-path`, `badge`. The Action also prints a shields.io badge snippet you can paste into your README.

## How Almanac fits together

The **scanner** (this package) tells you **how far each component has drifted** from current and surfaces the accumulated behavior changes along the upgrade path. The [Almanac corpus](https://github.com/IdeaBulutSolutions/idea-almanac/tree/main/packages/corpus) — Salesforce's release-note changes, written in plain language — grounds every impact citation in a real entry. The [prompt library](prompts/) turns a report plus the corpus into a test plan, a manager summary, or a security review.

---

Apache-2.0 · built by [Idea Bulut Solutions](https://ideabulut.com)
