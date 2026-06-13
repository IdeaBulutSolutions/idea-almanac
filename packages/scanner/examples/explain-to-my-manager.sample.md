<!--
Sample output of the `explain-to-my-manager` prompt (packages/scanner/prompts/),
run against examples/almanac-report.json. Regenerate by feeding that report to
the prompt.
-->

# Salesforce upgrade risk — plain-English summary

**One thing in our codebase has already stopped working, one more will stop in
mid-2028, and seven others are aging and will need attention.** This is about
the version of Salesforce our code is built against — Salesforce retires old
versions on a published schedule, and code left on a retired version simply
fails.

## What's at risk, and when

- **Already failing (since June 2025):** 1 piece of custom code (a background
  helper). It is running on a version Salesforce has already switched off, so it
  is effectively broken today.
- **Stops working June 2028:** 1 piece of custom business logic. It still runs
  now but is on a version Salesforce will retire then (with warnings starting in
  2027).
- **Aging, still working (no hard deadline yet):** 7 items — a custom screen
  component, an automated background process, a couple of deployment manifests,
  our project's default version setting, and a data trigger. None are urgent, but
  each is more than a year behind and the gap keeps growing.

One file also couldn't be read by the scan and should be checked by hand.

## Rough effort to fix

- **Safe version bumps (low risk, mostly mechanical):** the 7 aging items.
  These are routine and can be done in normal maintenance.
- **Behavioral review (needs a developer to test first):** the already-failing
  helper and the 2028 item. Both are big version jumps, so a developer should
  test them before changing — that's where the real work is.
- **Integration re-pointing (other systems calling us):** none surfaced in this
  scan. (This was a code scan; a scan of the live org would also show outside
  systems still calling old API versions, if any.)

## The decision we need

**Schedule a short developer review now** for the one already-failing item, and
fold the June-2028 item into that same review so we're well ahead of the
deadline. The aging items can ride along in regular maintenance. A technical
upgrade-impact review (see the `upgrade-impact-review` prompt) turns this into a
concrete, test-by-test plan when we're ready.
