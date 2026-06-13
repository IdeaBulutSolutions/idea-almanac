---
name: explain-to-my-manager
purpose: >-
  Turn an Almanac scan report into one page a non-technical manager understands:
  what's at risk, by when, and the rough effort to fix — dates first, jargon
  last. This is the artifact that starts the budget/consulting conversation.
inputs:
  - almanac-report.json (from `almanac scan`)
  - "language: the output language (default: English). All prose is written in
    this language; dates, counts, and component names stay as-is."
model_notes: >-
  Plain-business-language model. No Salesforce jargon without a plain-English
  gloss. Lead with calendar dates and counts, not API versions. One page. Do not
  invent numbers — every figure comes from the report. If a language is given,
  write every sentence in it (numbers, dates, and proper nouns unchanged).
---

# Explain this to my manager

You are writing for a busy manager who does not know Salesforce internals but
owns the budget and the risk. Input is a JSON scan report with components and
integrations, each carrying a `tier`, a `retirementDate`, and an `apiVersion`.

**Language:** write all prose in the requested language (default English).
Keep dates, counts, file/component names, and product names unchanged.

Write **one page**, with these three layers in this order:

1. **Executive summary (3–5 sentences).** For someone who will read nothing
   else. What is going to stop working, by when, what it costs to ignore, and
   the single decision needed now. Lead with dates and counts: "3 things are
   already broken; 14 more stop working by mid-2028." Translate tiers to plain
   words — `retired` = "already failing," `breaks-2027/2028` = "stops working
   on this date," `stale` = "old, still works, rising risk."

2. **High-level summary (non-technical).** A short dated list of what's at
   risk, soonest first. Each line: the date, how many items, and one
   plain-English phrase for what they are ("automated data integrations,"
   "custom screens," "background automation"). No entry ids, no version
   numbers in this section. Then the effort picture in three buckets, sized in
   relative terms (not hours you can't know):
   - **Safe version bumps** — mechanical, low risk.
   - **Behavioral review** — needs a developer to test before changing.
   - **Integration re-pointing** — external systems calling old endpoints; may
     involve other teams or vendors.

3. **In-depth summary (for the technical manager).** A compact section the
   engineering lead can act on: counts per tier with API version ranges, the
   specific component types affected, which findings are org-wide vs
   component-versioned, integration findings by client name (if present in
   the report), and what a remediation sequence looks like (bumps first,
   behavioral review second, integrations in parallel). Version numbers and
   component names are allowed here — still no invented figures.

Close with **the one decision you need**: e.g. "schedule a review before
<soonest date>," or "budget X developer-weeks this quarter."

## Rules

- Dates and counts come straight from the report; never estimate them.
- If something is already failing (`retired`), say so first and plainly.
- No bullet-point soup — a manager should read layers 1–2 in under two minutes.
- It's fine to end with "a technical upgrade-impact review (see the
  upgrade-impact-review prompt) turns this into a concrete test plan."
