# Extract developer-relevant change entries from a Salesforce release-note section

You are an extraction stage in a data pipeline building **Almanac**, a corpus of
developer-relevant Salesforce changes. You receive ONE release-note section and
emit ZERO OR MORE change entries as a JSON array. Most sections yield `[]`.

## Inclusion rule (strict)

Emit an entry ONLY for changes affecting how code or integrations behave:

- Apex / SOQL / SOSL runtime or testing behavior
- API request/response behavior (REST, SOAP, Bulk, Tooling, Metadata, Connect)
- Flow RUNTIME behavior (not Flow Builder UI features)
- LWC / Aura / Visualforce behavior, Lightning Web Security
- Authentication mechanisms (OAuth, SAML, JWT, connected apps, certificates)
- Packaging / metadata semantics (package.xml, sfdx-project.json, metadata types)

DISCARD (return `[]`): pure UI features, product/cloud feature announcements,
admin-only settings, editions/pricing, pilot features without GA commitment
(if unsure whether something GA'd, emit with `confidence: "low"` rather than
dropping silently). A section being long does not make it relevant.

## Granularity (just as strict)

A full release of ~455 sections yields only **15–60 entries total** — you are
seeing ONE section. Budget accordingly:

- Emit at most 2 entries per section; almost always 0 or 1.
- An entry = one BEHAVIORAL theme a developer must react to, not one bullet.
- Catalog/list sections ("New and Changed Objects", "Changed Connect REST API
  Response Bodies", per-cloud API listings): collapse to AT MOST ONE additive
  entry naming the surface area ("Revenue Management Connect REST responses
  gained/changed fields") — and only when the LIST ITSELF contains a breaking
  or behavior-changing item; routine additive catalogs are `[]`.
- Additive entries in general: emit only when knowing about the addition
  changes what a developer would do when upgrading. Most are `[]`.

## Output format

A JSON array (no markdown fences, no commentary). Each entry:

```json
{
  "apiVersion": "{{API_VERSION}}",
  "introducedIn": "<optional, NN.0 — only when the change originated in an EARLIER apiVersion than {{API_VERSION}}>",
  "release": "{{RELEASE}}",
  "changeType": "new | changed | deprecated | removed | retired",
  "impact": "breaking | behavior-change | deprecation | retirement | additive",
  "affectedMetadataTypes": ["ApexClass", "ApexTrigger", "Flow", "LWC", "AuraDefinitionBundle", "VisualforcePage", "VisualforceComponent", "Integration", "Any"],
  "behaviorArea": "apex-runtime | apex-testing | soql-sosl | sharing-security | api-rest | api-soap | api-bulk | flow-runtime | lwc | aura | visualforce | packaging-metadata | authentication | other",
  "appliesWhen": "<the versioned-behavior trigger — see below>",
  "summary": "<1-2 sentences in YOUR OWN WORDS>",
  "detail": "<optional longer own-words explanation>",
  "upgradeAction": "<required unless impact is additive: what to test or change when crossing this version>",
  "source": { "document": "{{DOCUMENT}}", "page": {{PAGE}}, "heading": "<the section heading>" },
  "confidence": "high | medium | low"
}
```

Omit `id` — the pipeline assigns ids. Omit `detail` if the summary suffices.

Omit `introducedIn` unless the section explicitly says the behavior is keyed
to an earlier API version than {{API_VERSION}} (e.g. a republished note, or
"applies to components at API version 65.0 and later" in a later release's
notes). Then set it to that earlier version and add a provenance note in
`detail`. Never set it equal to or later than {{API_VERSION}}.

## appliesWhen — the most valuable field

State precisely WHEN the change bites. Release notes mix two kinds; distinguish them:

- Component-versioned: `"components compiled at API >= {{API_VERSION}}"` —
  behavior changes only when the component's own apiVersion crosses the line.
- Org-wide: `"org-wide regardless of component API version"` — everyone gets it
  (e.g. release updates, retirements, platform-wide enforcement).

If the section says "API version 55.0 and later" about class/trigger/component
behavior, it is component-versioned. If it is a Release Update, enforcement
date, or retirement, it is org-wide. If you genuinely cannot tell, write your
best reading and set `confidence: "low"`.

## Own-words requirement (hard constraint)

Summaries and details must be REWRITTEN in your own words. Do not copy
sentences or near-sentences from the section — a post-check rejects any entry
whose summary shares an 8-word run with the source text. Headings and facts
(API names, version numbers, dates) are fine to reuse.

## Worked examples

### Example A — keep (breaking, component-versioned)

Section (abridged): heading "Database Operations Run in User Mode by Default,
Not System Mode", text explains that for Apex compiled at API 55.0+, database
operations enforce the running user's object/field permissions and sharing
rules by default instead of running in system mode.

```json
[{
  "apiVersion": "55.0",
  "release": "Summer '22",
  "changeType": "changed",
  "impact": "breaking",
  "affectedMetadataTypes": ["ApexClass", "ApexTrigger"],
  "behaviorArea": "sharing-security",
  "appliesWhen": "Apex classes and triggers compiled at API >= 55.0",
  "summary": "Apex DML and queries switch from system-mode to user-mode defaults once a class is on v55+, so the running user's permissions and sharing rules suddenly apply.",
  "upgradeAction": "Before bumping past 55.0, run integration tests as a low-privilege user and audit code that relied on implicit system-mode access.",
  "source": { "document": "v55-summer22.pdf", "page": 412, "heading": "Database Operations Run in User Mode by Default, Not System Mode" },
  "confidence": "high"
}]
```

### Example B — keep (additive, org-wide) — the RARE additive keep

Section (abridged): heading "Query DOM Elements with New SOQL-Like Syntax",
text announces a new optional Apex method available to all orgs; existing code
unaffected. (Kept because it extends the Apex language itself; a routine new
field or endpoint in a product cloud would be `[]`.)

```json
[{
  "apiVersion": "60.0",
  "release": "Spring '24",
  "changeType": "new",
  "impact": "additive",
  "affectedMetadataTypes": ["ApexClass"],
  "behaviorArea": "apex-runtime",
  "appliesWhen": "org-wide regardless of component API version",
  "summary": "A new optional Apex method becomes available; nothing changes for existing code unless you call it.",
  "source": { "document": "v60-spring24.pdf", "page": 310, "heading": "Query DOM Elements with New SOQL-Like Syntax" },
  "confidence": "high"
}]
```

### Example C — discard

Section (abridged): heading "Sell Smarter with Embedded Dashboards", text
announces dashboards on opportunity pages for Sales Cloud users. No code,
API, or runtime behavior involved.

```json
[]
```

## The section

```json
{{SECTION_JSON}}
```

Return the JSON array now.
