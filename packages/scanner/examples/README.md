# Example — a sample report

This is a real Almanac run against a deliberately old sample project at
[`../test/fixtures/sample-sfdx-repo`](../test/fixtures/sample-sfdx-repo). It
spans API versions **28 → 67**, so you can see every tier the scanner produces
without pointing it at your own org.

## What's here

| File | What it is |
|---|---|
| [`almanac-report.md`](almanac-report.md) | The scan, rendered for reading on GitHub |
| [`almanac-report.html`](almanac-report.html) | The same report, self-contained HTML (what `open almanac-report.html` shows) |
| [`almanac-report.json`](almanac-report.json) | The machine-readable report (schema-validated; what `impact` and CI consume) |
| [`almanac-impact.md`](almanac-impact.md) | Corpus-backed upgrade impact — what behavior actually changes across each component's span, with citations |

## What it surfaces

```
✅ No dated API retirement items.

Staleness score: 41 (0 = clean) · 10 components · 0 integrations
far-behind: 7 · behind: 2 · current: 1
Warnings: 2 (see report)
```

Everything in this repo **keeps running** — old Salesforce API versions are
pinned per component and don't stop working when a version is retired. What
Almanac flags is **drift**: how far each component's pinned version is from
current, and therefore how many platform behavior changes have accumulated
since it was last bumped.

`AncientHelper.cls` is pinned at API **28.0** — 39 releases behind current.
It compiles and runs today, but the upgrade impact report shows it walking
into a wall of accumulated behavior changes from v29 onward (ConnectApi
feed-element migration, sharing enforcement on `User`, picklist metadata
restructuring, …), each with a corpus citation and a concrete test action.
`LegacyService.cls` at 35.0 is 32 releases behind. One file (`Broken.page`)
is malformed and surfaces as a warning rather than crashing the scan.

The staleness score (41/100) reflects the weighted average of how far behind
the components are — 0 = all current, 100 = everything maximally behind.

## Regenerate it yourself

From the scanner package root, after `npm run build`:

```bash
# the scan (writes all three report formats here)
node dist/cli.js scan test/fixtures/sample-sfdx-repo \
  --json examples/almanac-report.json \
  --html examples/almanac-report.html \
  --md   examples/almanac-report.md

# the corpus-backed upgrade impact
node dist/cli.js impact --report examples/almanac-report.json \
  --out examples/almanac-impact.md \
  --no-llm -y
```

Repo scans make zero network calls, so this is fully deterministic — the only
inputs are the fixture and the built-in retirement schedule.
