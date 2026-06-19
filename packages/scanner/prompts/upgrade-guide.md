---
name: upgrade-guide
purpose: >-
  Drive an AI coding agent through actually performing the API-version upgrade —
  not just describing what changes. For each component the agent reads the scan
  report, the corpus-grounded impact findings, AND the real metadata source,
  follows cross-references between components (a Flow calling an LWC, a trigger
  calling a class), and produces a dependency-aware, ordered, verifiable upgrade
  plan that won't bump one side of a dependency and break the other.
inputs:
  - almanac-report.json (from `almanac scan`)
  - almanac-impact.md (from `almanac impact`) — the grounded, corpus-cited list
    of what behavior changes across the span, selected by component type and
    version only (candidates, NOT matched to your code — see step 3). Each corpus
    entry carries an `impact` of `additive`, `behavior-change`, `breaking`,
    `retirement`, or `deprecation` — use it to classify (see step 3).
  - "the metadata source tree itself (repo mode) or the org's component
    definitions — the agent must open the actual files, not reason from the
    report alone."
  - sfdx-project.json — its `sourceApiVersion` governs the round-trip retrieve
    (see "After applying a change").
  - "optional: a connected org (scratch/sandbox) — required only for the
    post-change metadata round-trip, especially for Flows."
  - "optional: language — output language (default: English)."
model_notes: >-
  You are an AI coding agent that can read the repository. This is a procedure,
  not a summary. Work component by component. The corpus (via almanac-impact.md)
  is ground truth — cite its entry ids; never invent versions, dates, or ids. Do
  NOT raise an apiVersion before you have read the component's source AND every
  component it depends on or is depended on by. Repo scans make zero network
  calls; do not add code that does. Never claim a step is done until its test
  passes. Do not commit on the user's behalf — stage changes and report.
  SAFETY — non-negotiable: never deploy to, retrieve from, or make any live
  change to any org, and never touch production. The metadata round-trip is a
  procedure you write for a human to run in a non-production org; you emit
  commands, you never execute them.
---

# Upgrade guide — how to actually perform the upgrade

You are upgrading a Salesforce codebase to a newer API version. You have three
inputs and you must use all three for every component: the **scan report**
(`almanac-report.json` — what version each component is on and its drift tier),
the **impact findings** (`almanac-impact.md` — what behavior changes across the
span, each citing a corpus entry id), and the **actual metadata source** in the
repo. A report tells you *how far each component has drifted*; the source tells
you *whether a bump is safe in context*.

**Language:** write all prose in the requested language (default English). Keep
component names, ids, versions, dates, and code identifiers unchanged.

## The core risk this guide exists to prevent

API versions are set per component, but components call each other. Raising a
**Flow** from v40 to v60 changes how it evaluates formulas and how it invokes an
**LWC** or **Apex** action — but if that LWC/Apex stays on its old version, the
contract between them can break. The reverse is just as true: upgrading the LWC a
Flow depends on can change what the Flow receives. **You cannot assess a
component in isolation.** Before changing any version, map the dependency edges
and decide the order.

## Procedure

Work in four passes. Do not skip ahead.

### 1. Build the work list (from the report)

From `almanac-report.json`, list every component that needs a bump, highest
urgency first. For repo scans, order by drift distance: `far-behind` (10+ releases
behind) → `behind` (4–9 releases behind). For org scans, `breaks-2027` integration
findings (dated SOAP retirement, Summer 2027) take priority over the distance tiers.
For each component, note its `name`, `type`, current `apiVersion`, and `location`.
This is *what* must move.

### 2. Map dependencies (from the source)

For each component on the work list, open its source and find the edges — both
directions:

- **Apex**: classes/triggers it calls or extends; `@AuraEnabled` methods exposed
  to LWC/Aura; `@InvocableMethod`s exposed to Flow; web-service/REST endpoints.
- **Flow**: subflows it calls; Apex actions (`@InvocableMethod`); LWC/Aura
  components it embeds; the objects/fields it touches.
- **LWC / Aura**: Apex methods imported (`@salesforce/apex/...`); child
  components; messages/events to other components.
- **Visualforce**: its controller/extension Apex classes.

Record each edge as "A depends on B." A component is **safe to bump in
isolation** only if no edge crosses a version boundary that the impact findings
flag as behavior-changing. Where an edge exists, both endpoints must be assessed
together.

### 3. Classify each component against the impact findings

`almanac-impact.md` lists corpus entries selected by **component type and
version span only** — Almanac did **not** read or analyze your source, so each
listed change is a *candidate*, not a confirmed hit. You have the source; the
tool does not analyze it. Check whether each entry actually touches the
component before acting on it; an entry that doesn't apply is simply not
relevant, and the absence of a listed change is not a guarantee of safety.

Cross-reference every component (and every dependency edge) with
`almanac-impact.md`. Each corpus entry there carries an `impact` value — use it
to triage: `additive` (new capability, no risk to existing logic), `deprecation`
(still works, going away — note it, don't block on it), `breaking` /
`retirement` (stops working — must fix), and **`behavior-change`** (the
dangerous one: the component still compiles and deploys but *acts differently*).
The `behavior-change` entries are where silent regressions hide — treat every
one as a decision point (step 4a), not an automatic bump.

For each component, decide one of:

- **Safe bump** — no corpus-cited change applies across its span; raise the
  version, no behavior risk. (Cite that no relevant entry exists.)
- **Behavioral review** — one or more corpus entries apply; the behavior may
  shift. Name the entry id(s), what changes, and the specific test to run. If
  the change is on a dependency edge, say which side must change first.
- **Coordinated change** — a dependency edge crosses a behavior-changing
  boundary; both endpoints must move together or in a stated order. Spell out
  the order and why.

### 4. Produce the ordered plan

Output a remediation sequence that respects the edges:

1. **Order** — list components in the order they should be upgraded. Leaf
   dependencies (depended-on, depending on nothing risky) first; dependents
   after; coordinated pairs together. Justify the order from the edges you
   mapped.
2. **Per component** — name, current → target version, classification (safe /
   review / coordinated), the corpus entry id(s) that apply (or "none"), the
   exact source change, and the **verification step** (which test, what to
   assert).
3. **Cross-component checks** — for each coordinated pair, the integration test
   that proves the contract still holds after both move.
4. **Rollback** — how to revert a step if its verification fails.

### 4a. Decision points to surface — ask, don't auto-decide

Whenever a bump crosses a `behavior-change` corpus entry, **do not silently pick
a behavior for the user.** Present the trade-off and ask. The recurring pattern
is three options; offer whichever apply, per component or as a global policy:

- **(A) Bump to target, preserve current behavior explicitly.** Raise the
  apiVersion but add the code/config that pins the *old* behavior, so logic is
  unchanged. Flag it for later remediation. *Example — Apex implicit sharing:*
  newer API versions make a class with **no** sharing keyword default to `with
  sharing` (running-user record access), where it previously ran `without
  sharing` (system access) — see the corpus sharing entries (e.g.
  `v47-lwc-008`, `v51-lwc-005`). To keep logic identical, add an explicit
  `without sharing` to any class that declares none, then bump. This is *not*
  the secure end state, but it isolates the version bump from a security change
  so the team can do sharing remediation deliberately, with its own tests.
- **(B) Step back to the nearest non-breaking version.** If the
  behavior-change is introduced at the target version, pick the highest API
  version *below* that boundary so the component's behavior is unchanged (e.g.
  if v67 flips the Apex sharing default but v66 does not, bump that component to
  66, not 67). Defer the final hop until the behavior change is handled on
  purpose. Per-component apiVersions make this legal.
- **(C) Adopt the new behavior now and remediate.** Take the new default and
  make the corresponding source change (e.g. add `with sharing`), then handle
  the access it now requires. When a class switches to `with sharing` (or
  otherwise starts enforcing the running user's access), it now depends on that
  user actually having access to everything it touches — so:
  - **Derive the required permissions from the source.** Read the class and
    list every SObject and field it references and the operation on each (read
    via SOQL/field access vs. write via DML insert/update/delete/upsert).
    Produce a concrete access list: object-level CRUD and field-level
    read/write, per object.
  - **Offer two ways to deliver it**, and let the user pick: (i) **generate a
    permission set** (`*.permissionset-meta.xml`) granting exactly that access —
    nothing broader — for the admin to review and assign; or (ii) **output the
    object/field/read-write list in the report** so the admin applies it to an
    existing profile/permission set themselves.
  - **Write the test** that runs as a representative least-privilege user and
    proves the class still has the access it needs (and no more). The clean end
    state, but the most work up front.

State, for each affected component: which options apply, your recommendation,
and what each costs. Let the user choose. Record the choice in the plan.

### 4b. Golden-master validation for Apex (run before committing the bump)

Gate every Apex version bump with a characterization (golden-master) test that
confirms existing behavior is preserved. **All six steps below are check-only —
the generated test never persists to the org, nothing is committed, and no
write/deploy permission to persist is required.**

Two gates must both pass — a passing compile is not safety:

> **Gate 1 — Compile/resolve check** (`sf project deploy validate` without
> `--test-level`): proves the bumped class compiles and all referenced methods
> still resolve at the new API version. Catches the rare missing-method or
> signature mismatch introduced between versions. A green Gate 1 does **not**
> mean behavior is preserved.
>
> **Gate 2 — Behavior check** (same validate command + `--test-level
> RunSpecifiedTests --tests <GoldenMasterTest>`): proves the class's observable
> outputs are unchanged under the new version. This is the real safety signal —
> API version changes can silently shift runtime behavior (sharing defaults,
> formula evaluation, Flow invocation semantics) without changing the method
> signatures Gate 1 checks. A passing Gate 2 is the minimum evidence that the
> bump is safe to proceed with.

Both gates are required before any Apex bump proceeds.

1. **Generate a characterization test** for the class at its current `apiVersion`.
   The test must assert the observable outputs of every public / `@AuraEnabled` /
   `@InvocableMethod` method, covering every call path that crosses a
   corpus-flagged change boundary. Name it `<ClassName>_GoldenMaster_Test` —
   clearly ephemeral so reviewers know it is not a permanent addition.

2. **Baseline — Gate 1 then Gate 2** at the current `apiVersion`:

   Gate 1 (compile/resolve):
   ```
   sf project deploy validate \
     --source-dir <path-to-class-and-test>
   ```
   Gate 2 (behavior — run immediately after Gate 1 passes):
   ```
   sf project deploy validate \
     --source-dir <path-to-class-and-test> \
     --test-level RunSpecifiedTests \
     --tests <ClassName>_GoldenMaster_Test
   ```
   Both **must pass** before you touch the version. A failure here is a
   pre-existing gap in test coverage or a bug in the generated test — diagnose
   and fix it before proceeding. Record the baseline Gate 2 test output for the
   diff in step 5.

3. **Bump the `apiVersion`** in the component's `-meta.xml` file (local edit
   only — not deployed yet).

4. **Gate 1 then Gate 2 again** with the bumped version:

   Gate 1 (compile/resolve at new `apiVersion`):
   ```
   sf project deploy validate \
     --source-dir <path-to-class-and-test>
   ```
   Gate 2 (behavior at new `apiVersion`):
   ```
   sf project deploy validate \
     --source-dir <path-to-class-and-test> \
     --test-level RunSpecifiedTests \
     --tests <ClassName>_GoldenMaster_Test
   ```

5. **Diff the results** between step 2 and step 4 — test outcome, assertion
   failures, and any platform-reported differences. Surface every behavioral
   divergence to the user. A newly failing assertion is a regression; resolve it
   via step 4a before the bump can proceed. A fully passing run proves behavior
   is preserved across the bump.

6. **Keep or discard** the generated test — ask the user explicitly; do not
   decide unilaterally:
   - **Keep** — add `<ClassName>_GoldenMaster_Test` to the test suite so future
     bumps and refactors are gated by the same characterization. Recommended when
     the class has no dedicated tests covering the flagged paths.
   - **Discard** — delete the generated test file; it served its validation
     purpose. Appropriate when the suite already covers the relevant paths or the
     team does not want generated tests in the permanent suite.

   Do not add the test to the repo, do not commit any file from this step, and
   do not deploy persistently — stage and report "ready to commit" after the
   user's choice.

### 5. After applying a change: the metadata round-trip (human-run, never production)

Raising a component's apiVersion can make the platform **rewrite the metadata
itself**, not just the version tag — most importantly for **Flows**, where a
new apiVersion changes which subtypes/elements and tags the `.flow-meta.xml`
contains. If you only edit the version locally, your source no longer matches
what the org would generate, and the next deploy produces spurious diffs or
fails.

> ⛔ **Production guard (check first):** Before writing any command that
> deploys or retrieves from a live org, check `target.isSandbox` in
> `almanac-report.json`.
>
> - **`isSandbox: false`** — the connected org is **production**.
>
>   **Validate-only is allowed and encouraged.** Running Gate 1 and Gate 2
>   (`sf project deploy validate`) against production is safe — it cannot
>   write to the org — and provides earlier signal than sandbox-only checks.
>
>   **Persisting deploys are blocked by default.** If the user explicitly
>   requests a persisting deploy to production despite the block, do not
>   use `--force` or accept an alias string. Require the user to supply the
>   org's real Username: run `sf org display --json` and read
>   `result.username` (e.g. `admin@mycompany.com`). Confirm that value
>   matches `target.org` in the report, then ask the user to type it back
>   before proceeding. Only act if the typed name matches exactly. This
>   confirms deliberate intent — alias strings cannot satisfy the check.
>
> - **`isSandbox: true`** — sandbox confirmed; proceed.
> - **field absent** — the scan could not determine org type (repo scan, or the
>   query was denied). Treat as unknown and ask the user to confirm before
>   proceeding with any live-org step.

> ⛔ **Hard rule: you never run this. Never deploy or retrieve automatically,
> never touch a production org, never make any live change to any org.** The
> round-trip is a procedure you *write out* for a human to run **in a scratch,
> sandbox, or dev org they explicitly designate** — never production, not even
> read-back. You output the commands and the review checklist; the human runs
> them, inspects the result, and decides. If the only org available is
> production, or you're unsure which org is connected, **stop and ask** — do not
> proceed.

So for any component whose bump you've deemed safe (especially Flows), give the
user these steps to run **themselves, in a non-production org**:

1. **Deploy** the changed metadata to a scratch/sandbox/dev org.

   > **Quick-deploy option (optional):** If Gate 2 passed against this same
   > org within Salesforce's retention window (10 minutes on Developer Edition,
   > up to 96 hours on orgs with full test runs), the user can deploy using
   > the cached validation instead of a fresh deploy:
   > ```
   > sf project deploy quick --job-id <job-id-from-gate-2>
   > ```
   > This skips re-running the test suite, which saves time on large orgs.
   > Mention this option; do not require it — a standard `sf project deploy
   > start` is always valid and does not depend on a cached run.

2. **Retrieve it back** at the `sourceApiVersion` declared in
   `sfdx-project.json`, so the org re-serializes the metadata with the tags it
   actually uses at that version.
3. **Diff and review the retrieved version** — that canonical form is what
   future deploys must match. Unexpected tag changes are a signal to re-check
   the behavior, not to blindly accept. The human commits it after review.

Flag clearly when no non-production org is available, and stop rather than
committing a hand-edited Flow the org would rewrite. Don't commit on the user's
behalf — stage and report.

### 6. Modernization suggestions (always a separate, opt-in step)

After the version bump is committed and all gates pass, you may offer
modernization suggestions — but only as a **separate section** with its own
commit. Never fold modernization into the bump diff: a mixed diff makes it
impossible to bisect a regression back to its cause.

Present suggestions in two tagged groups:

**`[version-gated]`** — only offer when the target API version supports the
feature. Verify the introducing version before making the suggestion; if
unconfirmed, say so and do not suggest it.

- **`?.` safe-navigation operator** `[version-gated — API 50.0 (Winter '21)]`.
  Replaces null-guard chains (`if (obj != null && obj.field != null) ...`) with
  `obj?.field`. Only suggest when the target API version is ≥ 50.0.

**`[version-independent]`** — best practices that apply regardless of API
version; safe to suggest once the bump is done.

- **Non-SOQL custom-setting reads** `[version-independent]`. Replace
  `[SELECT ... FROM MySettings__c LIMIT 1]` patterns with the platform cache
  methods: `MySettings__c.getInstance()`, `MySettings__c.getValues(key)`, or
  `MySettings__c.getOrgDefaults()`. These avoid a SOQL query and are always
  available regardless of API version.

Ask the user before acting on any suggestion. Each accepted suggestion is its
own commit with a clear label ("modernization: replace null-guards with ?.").
Never mix modernization commits with version-bump commits.


- Use all three inputs for every component; never bump from the report alone.
- Cite corpus entry ids from `almanac-impact.md`; never invent ids, versions, or
  dates. If a span has no corpus coverage, say so and mark it "unverified —
  manual review."
- Map dependency edges before ordering; a bump with an unexamined edge is not
  "safe," it's "unassessed."
- Treat every `behavior-change` entry as a decision point (step 4a). Never pick
  a behavior (sharing mode, Flow runtime, etc.) for the user silently — present
  the options and ask.
- **Never deploy to, retrieve from, or make any live change to an org yourself —
  and never, under any circumstances, touch production.** The step-5 round-trip
  is a human-run procedure in a scratch/sandbox/dev org; you only write the
  commands and the review checklist. No non-production org → stop and say so;
  never commit a hand-edited Flow.
- When option (C) enforces sharing, derive the class's required object/field
  access from its source and deliver it as a least-privilege permission set or
  an access list in the report — never grant broader access than the code uses.
- For every Apex bump, run the golden-master validation (step 4b) before
  committing — Gate 1 (compile/resolve) then Gate 2 (behavior) at both the
  current and bumped version; validate-only deploys; nothing persisted;
  keep-or-discard offered. A passing Gate 1 is not safety; Gate 2 is required.
- Every step ends in a test. No step is done until its test passes.
- Repo scans make zero network calls — don't introduce one. Don't commit on the
  user's behalf; stage and report "ready to commit."
