<!--
Sample output of the `brutal-security-review` prompt (packages/scanner/prompts/),
run against the scanner source at this commit. Evidence is file:line from
packages/scanner/src. Re-run after any change that touches network/exec code.
-->

# Brutal security review — idea-almanac scanner

**Verdict: the core trust claim holds.** Repo scans are filesystem-only and
provably so. The two modes that *do* use the network — org scans and the
optional LLM narrative — only reach hosts the user explicitly points them at
(their own org; or, if they opt in, their configured model), authenticated by
credentials the user already holds. One honest caveat: the `anthropic` provider
sends your prompt to a third party **when you choose to configure it** — covered
below. No telemetry, analytics, or update checks exist anywhere in the source.

## Every network/exec-capable sink

| # | Sink | file:line | Reachable in **repo** scan? | Where it can go |
|---|---|---|---|---|
| 1 | `fetch` — Tooling/Data query | `adapters/org.ts:531` | **No** | only `conn.instanceUrl` (the user's org) |
| 2 | `fetch` — EventLogFile CSV download | `adapters/org.ts:431` | **No** | only the org's own `LogFile` URL |
| 3 | `execFile('sf', ['org','display','--json'])` | `adapters/org.ts:501` | **No** | spawns the user's `sf` CLI to read their own session token |
| 4 | `spawnSync` — model call (`claude` / `curl` → api.anthropic.com / `bash -c $ALMANAC_LLM_CMD`) | `analysis/llm.ts:29` | **No** | only when `impact --llm` **and** a provider is configured |

That's the complete list — `grep -rnE '\bfetch\(|spawnSync|execFile|child_process|https?\.|net\.|tls\.'` over `src/` returns nothing else.

## Repo-mode boundary — does it hold?

Yes. `scan <path>` runs `scanRepo` (`adapters/repo.ts`), which only reads the
filesystem. `org.ts` and `llm.ts` are imported at the top of `cli.ts`, but their
network functions are invoked **only** inside the `--org` branch and the
`impact --llm` path respectively; a repo scan never calls them. Module-load of
either file executes no network code (only `promisify(execFile)` and pure
declarations).

This isn't taken on faith: `test/no-network.test.ts` traps `net.connect`,
`net.createConnection`, `tls.connect`, `http(s).request/get`, `dns.lookup/resolve`,
**and** `globalThis.fetch` (lines 30–40), runs a full scan plus all three
reporters, and asserts `attempts` is empty (line 64). It runs in CI. To defeat
the claim you'd have to add a network call that this harness doesn't trap — and
the harness traps every Node egress primitive plus `fetch`.

## Follow the data (org + LLM modes)

- **Org scan:** the only `Authorization: Bearer` token (org.ts:431, 531) is
  `conn.accessToken`, read from the user's own `sf org display` (org.ts:501).
  It is sent only to `conn.instanceUrl` and the org's own `LogFile` URLs — both
  the user's org. Nothing is POSTed outward; these are read queries. No third
  party sees the token or the data.
- **LLM narrative:** `claude-cli` and `cmd` keep data on the user's machine.
  The `anthropic` provider (llm.ts) POSTs the assembled prompt — which contains
  the scan **report** and **corpus slices**, *not* org credentials — to
  `api.anthropic.com`. This is a third-party egress, but it only happens when the
  user sets `ALMANAC_LLM_PROVIDER=anthropic` (or `ANTHROPIC_API_KEY`) and passes
  `--llm`. The safe default is `--no-llm`, which writes a local bundle and calls
  nothing. **This is the one place data leaves the machine, and only on opt-in.**
- **GitHub Action** (`action/`): runs the CLI and, with `comment-pr`, posts the
  report to the PR via `gh` using `${{ github.token }}` — the repo's own token,
  no external host.

## Dependencies

Runtime deps are only `fast-xml-parser` and `yaml` (package.json) — both
parse-only, neither makes network calls or ships network-bearing post-install
scripts. Low surface area.

## What I could NOT verify from source alone

- **Transitive dependencies** of `fast-xml-parser` and `yaml` — confirm with
  `npm audit` and a lockfile review; this audit only inspected first-party code.
- **Runtime of the user's own `sf` CLI and `claude` CLI** — Almanac shells out to
  them (org.ts:501, llm.ts); their network behavior is theirs, not Almanac's.

## Bottom line

Run the repo scan on anything — it cannot phone home, and a CI test proves it.
Org and LLM modes are scoped and opt-in; the single third-party egress
(`anthropic`) is off by default and sends your prompt, never your org token.
This earns the "don't trust us — run this first" line.
