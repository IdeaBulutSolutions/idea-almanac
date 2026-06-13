# Security policy

Almanac's core security claims are testable in this repo:

- Repo scans make **zero network calls** — enforced by
  [`packages/scanner/test/no-network.test.ts`](packages/scanner/test/no-network.test.ts).
- Org scans talk only to **your own org**, reusing your existing `sf` CLI
  session. Almanac never asks for, stores, or forwards credentials.
- No telemetry, no update checks, no data leaves your machine.

If you find a violation of any of these claims, or any other vulnerability,
we want to know.

## Reporting a vulnerability

Please report privately via
[GitHub private vulnerability reporting](https://github.com/IdeaBulutSolutions/idea-almanac/security/advisories/new)
(Security tab → "Report a vulnerability").

Please do **not** open a public issue for security reports.

You can expect an acknowledgment within 72 hours. Supported version: the
latest release on npm.
