---
name: effort-estimate
purpose: >-
  Turn an Almanac scan report into a manager-facing effort-and-timeline
  estimate: how long to fix the findings and ship them, broken down by
  severity. Produces two costed scopes — (A) bring the whole org to the current
  API version, and (B) breaking changes first — so the budget owner can choose
  between "fix everything" and "stop the bleeding now, schedule the rest."
inputs:
  - almanac-report.json (from `almanac scan`)
  - "optional: almanac-impact.md (from `almanac impact`) — sharpens the
    behavioral-review effort, since it lists what actually changes on upgrade."
  - "optional: team — number of developers available, to convert effort into a
    calendar timeline (default: assume 1 developer; state the assumption)."
  - "optional: execution-model — `ai-assisted` (default) or `manual`. AI-assisted
    means an AI agent does the mechanical bumps in batch and drafts the
    behavioral analysis + tests, with a developer reviewing and approving."
  - "optional: language — output language (default: English). All prose in this
    language; dates, counts, and component names stay as-is."
model_notes: >-
  This prompt produces PLANNING ESTIMATES, not commitments. The single biggest
  error to avoid: pricing every component as bespoke work. The large majority
  are mechanical, BATCHABLE version bumps — price them per batch, not per
  component — and only the subset that crosses a corpus `behavior-change` or
  `breaking` entry needs developer review. Default to the AI-assisted execution
  model (agent bumps in batch + drafts tests, developer reviews). You MUST: (1)
  state every assumption in an editable block; (2) give every number as a range;
  (3) derive counts strictly from the report; (4) run the sanity check — if your
  AI-assisted total works out to more than ~0.1 dev-day per component on
  average, you are pricing batchable work as bespoke; recheck. Lead with the
  highest-urgency tier first: `breaks-2027` (dated, org scans only) if present,
  then `far-behind`.
---

# Estimate the fix-and-release effort

You are estimating, for a budget owner, how long it takes to bring an Almanac
scan report's components up to current and get those changes released — and what
changes if they tackle **everything** versus only the **highest-drift** items
first. Input is a JSON report whose components each carry a `tier` and an
`apiVersion`. Integration findings from org scans also carry a `retirementDate`.

**Language:** write all prose in the requested language (default English). Keep
dates, counts, file/component names, and product names unchanged.

## Severity, highest urgency first

Map tiers to urgency. Old Salesforce metadata keeps running — the risk is
accumulated behavioral drift, not a hard break:

| Urgency | Tier(s) | Plain meaning | Driver |
|---|---|---|---|
| **P1 — dated** | `breaks-2027` | SOAP `login()` stops working (org scans only) | Summer '27 deadline |
| **P2 — high drift** | `far-behind` | 10+ releases behind — high accumulated drift | Drift distance |
| **P3 — moderate drift** | `behind` | 4–9 releases behind — drift accumulating | Drift distance |

`breaks-2027` only appears for org-scan integration findings (SOAP integrations
calling old endpoints) — never for metadata components. `current` tier needs no
action.

## Effort model (AI-assisted by default — show the bands, let the manager edit)

**Execution model.** Default to **AI-assisted with developer review**: an AI
agent applies the mechanical bumps in batch and drafts the behavioral analysis
and tests; a developer reviews, runs, and approves. The work compresses, it
doesn't vanish — human review is the floor. Show a **manual** comparison
alongside so the saving is visible and the manager can choose.

**Most components are mechanical — this is where estimates blow up.** Do not
price every component as bespoke work. The large majority are **safe, batchable
version bumps** applied in one pass. Only the subset that crosses a corpus
`behavior-change` or `breaking` entry (from `almanac-impact.md`) needs
behavioral review. Use the impact findings to size that subset. **Without
`almanac-impact.md`, assume only ~10–20% of components need behavioral review
and the rest are safe bumps** — never assume the whole org is behavioral, and
never multiply a per-component band across hundreds of stale components.

| Work type | Sizing | AI-assisted (default) | Manual (for contrast) |
|---|---|---|---|
| **Safe version bumps** | priced **per batch**, not per component — one scripted/agent pass + a review sample | ~0.5–1 dev-day per **50 components** | 0.1–0.25 dev-day each |
| **Behavioral review** | only components crossing a `behavior-change`/`breaking` entry; AI drafts analysis + tests, developer reviews | 0.25–0.75 dev-day per affected component | 0.5–2 dev-days each |
| **Integration re-pointing** | external endpoints; coordination-bound, AI helps least | 1–3 dev-days per client | 1–5 dev-days each |

Add **release overhead** as its own line: one regression-test pass + a
deployment window per release cycle (2–5 dev-days; one cycle for Scope B, one or
two for Scope A). Convert total dev-days to a **calendar range** using team size
(default 1 developer — say so); P0/P1/P2 work parallelizes across developers,
integration re-pointing is gated by external parties.

**Sanity check (required, show your work).** Mechanical bumps dominate the
*count* but must not dominate the *effort*. After totaling, divide the
AI-assisted dev-days by the total component count and state the result: if the
average exceeds **~0.1 dev-day per component**, you are pricing batchable work as
bespoke — recheck the safe-bump vs behavioral split before reporting. A
400-component org with no integrations should land in the low tens of
AI-assisted dev-days, not the hundreds.

## Output — one page, three layers

1. **Executive summary (3–5 sentences).** The two numbers a manager needs, in
   the **AI-assisted** model: "High-drift items first: ~X–Y weeks to
   fixed-and-released. Full org to current: ~W–Z weeks." Lead with drift counts
   (`far-behind` / `behind`) and note any dated deadlines (`breaks-2027` if
   present), then add one contrast line: "Done manually this would be roughly N×
   the effort." End with the single decision: which scope to fund now.

2. **Assumptions (editable block).** Execution model (AI-assisted vs manual),
   team size, the effort bands used, the assumed safe-bump vs behavioral split
   (and whether it came from `almanac-impact.md` or the ~10–20% default), and
   release overhead. One line each: "Change these and the totals move."

3. **The estimate, by severity.** A table — one row per severity, soonest
   deadline first (effort columns are AI-assisted):

   | Severity | # findings | Work mix (bump / review / integration) | AI-assisted effort (dev-days) | + release | Calendar to released |
   |---|---|---|---|---|---|

   Below the table, state the **sanity check**: total AI-assisted dev-days ÷
   component count = per-component average (must be ≲ 0.1), and the manual
   comparison total.

   Then the two scope roll-ups:

   - **Scope A — full org to current:** all tiers, total effort range,
     total calendar range, how many release cycles.
   - **Scope B — highest-drift first (P1+P2):** `breaks-2027` + `far-behind`
     only; excludes P3 (`behind`) drift. Total effort range, calendar range.
     Note what P3 work is deferred and roughly what it would add later.

Close with **the recommended sequence and the one decision**: e.g. "Fund Scope B
now — `far-behind` carries the highest drift and is ~N dev-days; the `behind`
backlog can wait for next quarter," or "Scope A is only ~M more dev-days than B
and avoids a second release cycle — do it in one pass."

## Rules

- Counts come straight from the report; never invent how many components are
  affected.
- **Price mechanical bumps per batch, not per component.** Never multiply a
  per-component band across hundreds of stale components — that's the mistake
  that produces absurd totals.
- Only the `behavior-change`/`breaking` subset is behavioral review; default the
  rest (~80–90%) to safe batched bumps unless `almanac-impact.md` says otherwise.
- Run the sanity check and show it: AI-assisted dev-days ÷ components ≲ 0.1. If
  it's higher, fix the split before reporting.
- Every effort and calendar figure is a **range**, and every range traces to the
  stated assumptions. No single-point "it'll take 3 weeks."
- These are planning estimates, not commitments — say so once, plainly.
- Never claim components are failing or broken — old Salesforce metadata keeps
  running; Almanac measures drift distance, not failure.
- `breaks-2027` is the only dated tier (org scans, SOAP integration findings);
  lead with it and price it first if present. `far-behind` follows.
- Keep layers 1–2 readable in under two minutes. No bullet-point soup.
