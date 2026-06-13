# Example — a scary sample report

This is a real Almanac run against the deliberately-aging fixture repo at
[`../test/fixtures/sample-sfdx-repo`](../test/fixtures/sample-sfdx-repo). It
spans API versions **28.0 → 67.0** so you can see every tier the scanner emits
without pointing it at your own org.

## What's here

| File | What it is |
|---|---|
| [`almanac-report.md`](almanac-report.md) | The scan, rendered for reading on GitHub |
| [`almanac-report.html`](almanac-report.html) | The same report, self-contained HTML (what `open almanac-report.html` shows) |
| [`almanac-report.json`](almanac-report.json) | The machine-readable report (schema-validated; what `impact` and CI consume) |
| [`almanac-impact.md`](almanac-impact.md) | Corpus-backed upgrade impact for the same report — what actually changes behavior, with citations and test actions |

## The scary part

```
⚠ 1 item — Already failing - retired Summer '25 (REST 410 / SOAP 500 / Bulk 400) (2025-06)
⚠ 1 item — Retires Summer '28 (deprecated Summer '27) (Jun 2028)

Debt score: 27 (0 = clean) · 10 components · 0 integrations
retired: 1 · breaks-2028: 1 · stale: 7 · current: 1
```

`AncientHelper.cls` is pinned at API **28.0** — already failing since June 2025
(REST `410 GONE`) — and the impact report shows it walking into a wall of breaking
changes from v29 onward (ConnectApi feed-element migration, sharing enforcement
on `User`, picklist metadata restructuring, …), each with a corpus citation and
a concrete test action. `LegacyService.cls` at 35.0 retires Summer '28. One file
(`Broken.page`) is malformed and surfaces as a warning rather than crashing the
scan.

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
  --out examples/almanac-impact.md
```

Repo scans make zero network calls, so this is fully deterministic — the only
inputs are the fixture and the built-in retirement schedule. The committed
`almanac-impact.md` elides the long "org-wide changes" union for length; the
command above writes the unabridged version.
