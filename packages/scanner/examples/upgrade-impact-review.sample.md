<!--
Sample output of the `upgrade-impact-review` prompt (packages/scanner/prompts/),
run against a "few releases behind" scan (Apex 55.0, LWC 56.0, Flow 57.0,
trigger 58.0) → target 67.0, paired with the v56–v67 corpus. Every citation is
a real corpus entry id; the groundedness gate passes. Regenerate with
`almanac impact --report <json> --llm`.
-->

# Upgrade-impact review — API 55–58 → 67

You're four to twelve releases behind across four components. The dominant theme
for everything that runs Apex is the **Summer '26 (v67) "secure by default" shift**
— database operations stop running in system mode — and a long **"no-arg
constructor" enforcement chain** for anything invoked by Flow/REST. Review these
before bumping; none are auto-safe.

## ApexClass `QuoteSyncService.cls` (55.0 → 67.0) — highest risk

The big ones, most disruptive first:

1. **DML/SOQL run as the current user by default at v67** — system-mode access
   is no longer implicit (v67-sharing-002, v67-sharing-006, Summer '26).
   *Test:* run this class as a low-permission user; add explicit `WITH SYSTEM_MODE` /
   `without sharing` only where elevated access is intentional.
2. **A missing sharing keyword now means `with sharing`, not `without`**
   (v67-sharing-003, Summer '26). *Test:* confirm record-level rules being
   enforced doesn't silently drop rows this class relied on.
3. **`WITH SECURITY_ENFORCED` is removed from SOQL at v67** (v67-soql-001,
   v67-soql-002, Summer '26). *Test:* replace each occurrence with `WITH USER_MODE`
   or `stripInaccessible()`.
4. **Invocable-parameter classes need a visible no-arg constructor**
   (v67-apex-016, v67-rest-001, v67-rest-012, and origin v66-rest-013/v66-flow-005,
   Spring–Summer '26). *Test:* any `@InvocableVariable` class with a parameterized
   constructor must also expose a public/global no-arg one.
5. **Older breakers along the way:** `URL.getSalesforceBaseUrl()` stops compiling
   at v59 (v59-apex-008); async `Database.insert*` throws `TypeException` on
   non-big-objects (v60-apex-009); mutating a `Set` mid-iteration throws
   (v62-apex-002); `JSON.serialize()` of exceptions throws (v63-apex-008);
   `AccountCleanInfo`/`ContactCleanInfo` are removed (v67-rest-016).

## ApexTrigger `AccountTrigger.trigger` (58.0 → 67.0)

Inherits the v67 secure-by-default changes above (v67-sharing-002,
v67-sharing-006), plus one trigger-specific note:

- **Triggers always run `without sharing` at v67**, regardless of the caller
  (v67-sharing-004, Summer '26). *Test:* verify record-access logic still holds
  under guaranteed system-mode sharing — the opposite direction from Apex classes.

## Flow `Opportunity_Sync.flow` (57.0 → 67.0)

1. **Create Records outputs return field IDs, not strings, at v65** — downstream
   references break on save (v65-flow-004, Winter '26). *Test:* point references
   at the record's `Id` field explicitly.
2. **Before-save flows now enforce field writeability** (v66-flow-006, Spring '26).
   *Test:* remove/guard assignments to non-insertable fields.
3. **Autolaunched flows called from `with sharing` Apex inherit sharing**
   (v62-flow-004, Winter '25) and **Apex-action exceptions roll back the whole
   transaction** (v64-flow-007, Summer '25). *Test:* re-check flows that assumed
   system context or partial commits.

## LWC `quoteList` (56.0 → 67.0)

1. **DOM placeholders changed from text to comment nodes; light-DOM slots add
   empty text nodes** (v60-lwc-002, v60-lwc-003, Spring '24). *Test:* replace
   `childNodes`/`firstChild` traversal with `children`/`firstElementChild`/
   `querySelector`; refresh snapshots.
2. **Decorators (`@api`/`@track`/`@wire`) only on `LightningElement` classes**
   (v60-lwc-004) and **stricter `lwc` import/export validation blocks deploy**
   (v62-lwc-006). *Test:* a local build/VS Code pass will surface both before you
   upgrade.
3. **HTML template syntax errors now block deploy** (v59-lwc-011, Winter '24).

## Coverage

The spanned corpus (v56–v67) is fully reviewed, so there are no gaps in this
range. A handful of cited entries carry `low confidence` in the corpus
(e.g. v64-soql-005, v57-apex-008) — treat those as "verify against the live
release notes" rather than settled. This is a review, not a verdict: each item
above is something to **test before bumping**, not a guaranteed break.
