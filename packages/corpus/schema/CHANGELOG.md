# change-entry.schema.json changelog

Frozen contract: every change bumps `version` and lands a row here.

## (metadata only, no version bump) — 2026-06-13

- `$id` host path corrected to the public repo
  (`IdeaBulutSolutions/idea-almanac`). No contract change; all documents
  valid under 1.1.0 remain valid.

## 1.1.0 — 2026-06-10 (pilot re-freeze)

- Added optional entry field `introducedIn` (`NN.0` pattern): the apiVersion
  where the change behaviorally originated, for republished/keep-with-note
  entries that sit in a later file (e.g. CUC: keyed 65.0, filed v67). Absent
  means same as the entry's `apiVersion`. Driven by REVIEW-LOG rest-001 and
  rest-015 — the impact layer must use `introducedIn`, not file
  placement, for span math, or version-range queries will false-positive.
- Backward compatible: all 1.0.0 documents remain valid.

## 1.0.0 — initial freeze
