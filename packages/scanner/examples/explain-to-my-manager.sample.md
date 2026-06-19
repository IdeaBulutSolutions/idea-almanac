<!--
Sample output of the `explain-to-my-manager` prompt (packages/scanner/prompts/),
run against examples/almanac-report.json. Regenerate by feeding that report to
the prompt.
-->

# Salesforce API version maintenance — plain-English summary

**Ten components in this project are behind the current Salesforce API version.
Seven are far behind — meaning dozens of platform behavior changes have
accumulated since they were last updated — and two more are moderately behind.
No dated retirement deadlines apply (this was a code scan; a live-org scan would
also show any external integrations calling old API versions).**

## What's here

All 10 components are still running today. Salesforce does not break metadata
when it releases a new API version — each component stays pinned to the behavior
of the version it was written for. What Almanac is measuring is **drift**: how
many platform changes have accumulated since each component was last bumped, and
therefore how much risk has built up if those components ever need to be changed
or diagnosed.

## The drift picture

- **7 components — far behind (10+ releases behind current).**
  The most significant gap. The oldest, `AncientHelper.cls`, is 39 releases
  behind; `LegacyService.cls` is 32 behind. Each one spans a long list of
  platform changes — sharing rule enforcement, API restructuring, field-picklist
  changes — that a developer touching the code would need to reason through.
- **2 components — behind (4–9 releases behind).**
  Accumulating drift but not yet a large gap.
- **1 component — current.**
  No action needed.
- **2 warnings (scan only):** one file could not be read (malformed) and should
  be checked by hand. The other is an informational note.

## Rough effort to fix

- **Safe version bumps (low risk, mostly mechanical):** most of the 9 components
  that need a bump fall here. These are routine; an AI agent can apply them in
  batch, and a developer reviews.
- **Behavioral review (needs a developer to test first):** any component that
  spans a corpus-flagged behavior change. The two oldest (`AncientHelper.cls`
  and `LegacyService.cls`) carry the most accumulated changes and will need
  explicit testing before the bump is considered safe.
- **Integration re-pointing:** none surfaced in this scan (code scan only; a
  live-org scan would surface these if they exist).

## The decision we need

**Schedule a maintenance pass** — prioritise `AncientHelper.cls` and
`LegacyService.cls` (far-behind, 30+ releases each) as the highest-effort items,
then batch the remaining seven. An upgrade-impact review (the `upgrade-guide`
prompt) turns this into a concrete, test-by-test plan when the team is ready.
