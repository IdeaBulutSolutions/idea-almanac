# Contributing to Almanac

Thanks for your interest. Almanac is small on purpose — that's part of its trust
promise — so contributions are reviewed with that bar in mind.

## Dev setup

```bash
git clone https://github.com/IdeaBulutSolutions/idea-almanac.git
cd idea-almanac
npm ci                 # Node >= 22.6
npm test               # vitest across all workspaces
npm run ci             # lint + typecheck + test + validate (same as CI)
```

Build the scanner CLI and run it locally:

```bash
npm run build -w idea-almanac
node packages/scanner/dist/cli.js scan packages/scanner/test/fixtures/sample-sfdx-repo
```

## Ground rules

- **Zero network calls in repo scans.** This is enforced by
  [`packages/scanner/test/no-network.test.ts`](packages/scanner/test/no-network.test.ts)
  and is launch-blocking. PRs that add network calls, telemetry, or update
  checks to the scanner will not be merged.
- **No new runtime dependencies** without prior discussion in an issue. The
  dependency surface is deliberately tiny so the source stays auditable.
- **Schemas are frozen contracts.** Changes to
  `packages/corpus/schema/change-entry.schema.json` or
  `packages/scanner/schema/report.schema.json` require a version bump and a
  changelog row next to the schema.

## Contributing to the corpus

- Entries are **own words only** — never verbatim Salesforce release-note text.
  A shingle test enforces this.
- Salesforce release-note PDFs are **never committed**
  (see `packages/corpus/input-pdfs/NAMING.md` for local naming).
- Every entry needs a source pointer (document, page, heading) and an
  `appliesWhen` value.
- Run `npm run validate` and `npm run manifest --workspace=idea-almanac-corpus`
  before opening a PR; CI checks manifest freshness.

## Pull requests

1. Open an issue first for anything beyond a small fix.
2. Keep PRs focused — one change per PR.
3. Add or update tests for behavior changes.
4. `npm run ci` must pass.

## Reporting bugs

Use [GitHub issues](https://github.com/IdeaBulutSolutions/idea-almanac/issues).
For security issues, see [SECURITY.md](SECURITY.md) — please don't open a
public issue.
