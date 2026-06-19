---
name: modernization
purpose: >-
  Opt-in, post-bump modernization suggestions for Salesforce Apex code.
  Always a separate step from the version bump — never mixed into the same
  diff. Each suggestion is tagged version-gated or version-independent.
inputs:
  - almanac-report.json (from `almanac scan`) — to know the target API version
  - the Apex source files being modernized
model_notes: >-
  These suggestions are strictly opt-in and always a separate commit from any
  version bump. Never fold modernization into a bump diff. Verify version-gated
  suggestions against the target before offering them; if the introducing version
  is unconfirmed, say so explicitly and do not suggest the feature. Ask the user
  before acting. Each accepted suggestion is its own commit.
---

# Modernization suggestions — post-bump, opt-in

Run this prompt **only after** the version bump is committed and all validation
gates pass. Never mix these changes with the bump diff.

Each suggestion below carries one of two tags:

- **`[version-gated]`** — only valid at or above a specific API version. Check
  that the component's bumped version (or the project `sourceApiVersion`)
  meets the threshold before offering it. If the introducing version is listed
  as UNCONFIRMED, do not make the suggestion until it is verified.

- **`[version-independent]`** — safe to apply regardless of API version.

## Suggestions

### Safe-navigation operator `?.` `[version-gated — API 50.0 (Winter '21)]`

Replaces nested null-guard chains with concise safe-navigation:

```apex
// before
if (account != null && account.Owner != null) {
    name = account.Owner.Name;
}
// after
name = account?.Owner?.Name;
```

> Offer this only when the component's bumped API version (or the project
> `sourceApiVersion`) is **50.0 or higher** — `?.` was introduced in Winter '21
> (API 50.0).

### Non-SOQL custom-setting reads `[version-independent]`

Replace ad-hoc SOQL queries against custom-setting objects with the
platform-provided cache methods. These avoid a SOQL query count, are
always available regardless of API version, and are the documented pattern.

| Pattern | Replacement |
|---|---|
| `[SELECT ... FROM MySettings__c LIMIT 1]` | `MySettings__c.getOrgDefaults()` |
| `[SELECT ... FROM MySettings__c WHERE SetupOwnerId = :userId]` | `MySettings__c.getInstance(userId)` |
| `[SELECT ... FROM MySettings__c WHERE Name = :key]` | `MySettings__c.getValues(key)` |

Apply once the version bump is committed. Wrap in a null check where the
setting may be absent in some orgs.

## Rules

- Ask the user before applying any suggestion. Do not apply silently.
- Each accepted suggestion is its own commit: `modernization: <brief description>`.
- Never fold modernization commits into version-bump commits.
- For `[version-gated]` items, state the introducing version (or "UNCONFIRMED")
  explicitly in the output before making the suggestion.
- If the org's tooling or tests are not set up to verify a suggestion, say so.
