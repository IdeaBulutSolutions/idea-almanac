---
name: deprecation-horizon
purpose: >-
  A forward-looking, dated list of what still works today but is on the way out —
  the deprecations and retirements that apply across the upgrade span — so a team
  can plan ahead instead of being surprised. Read-only: it reorganizes the
  grounded findings by date; it changes nothing.
inputs:
  - almanac-impact.md (from `almanac impact`) — the grounded, corpus-cited list;
    each entry carries an `impact` of `additive`, `behavior-change`, `breaking`,
    `retirement`, or `deprecation`.
  - "optional: almanac-report.json (from `almanac scan`) — to tie horizon items
    back to the components/integrations actually present."
  - "optional: language — output language (default: English)."
model_notes: >-
  Read-only planning view. Use ONLY the `deprecation` and `retirement` entries
  from almanac-impact.md (ignore additive; breaking/behavior-change belong in the
  upgrade-impact review, not here). Cite each entry's id; never invent ids,
  versions, or dates. Order by date, soonest first. If an item has no firm date,
  say "no fixed date — monitor." Do not recommend code changes here; this is a
  calendar, not a fix plan.
---

# Deprecation horizon

Build a **calendar of what is going away** for this codebase: features, APIs,
endpoints, and settings that *still work now* but are deprecated or scheduled to
retire across the upgrade span. The goal is foresight — let the team budget and
sequence before anything becomes an emergency.

**Language:** write all prose in the requested language (default English). Keep
ids, versions, dates, and component names unchanged.

## What to include

From `almanac-impact.md`, take only entries whose `impact` is:

- **`retirement`** — has (or will have) a hard cut-off date; it *will* stop
  working.
- **`deprecation`** — announced as going away; still works, no removal date yet,
  but don't build on it.

Skip `additive` (new capability), and leave `breaking` / `behavior-change` to
the upgrade-impact review — those are "fix on upgrade," not "horizon."

## Output

1. **One-line summary.** "N items on the horizon: R with firm retirement dates,
   D deprecated with no date yet."

2. **Timeline, soonest first.** Group by date (then "no fixed date — monitor" at
   the end). For each item: the date, a one-line plain description, its
   `impact` (`retirement` / `deprecation`), the corpus entry id, and — if the
   report was provided — whether anything in *this* codebase actually uses it
   ("affects: 3 Apex classes" / "not currently used — informational").

3. **Watch-list call-outs.** The 3–5 items most worth putting on the roadmap
   now, with one sentence each on why (soonest date, or used heavily here).

Close with a single planning line: "Next thing to schedule: <item> by <date>."

## Rules

- Only `deprecation` and `retirement` entries; cite every id; never invent
  dates. "No fixed date" is a valid, honest answer.
- Date-ordered. A horizon with no dates is just a list — lead with the calendar.
- This is a planning calendar, not a remediation plan. No code changes here;
  point to the `upgrade-guide` / `upgrade-impact-review` prompts for the how.
