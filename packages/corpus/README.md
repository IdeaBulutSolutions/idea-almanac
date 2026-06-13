# Almanac corpus

A seasonal record of every Salesforce release: one YAML file per API version
(`data/v29.yaml` … `data/v67.yaml`), each containing developer-relevant change
entries in **our own words** with source pointers (document, page, heading).
No verbatim Salesforce release-note text is ever committed; input PDFs are
gitignored (see [`input-pdfs/NAMING.md`](input-pdfs/NAMING.md)).

- **Manifest:** [`data/index.yaml`](data/index.yaml) — versions, counts, review status (generated: `npm run manifest`; CI checks freshness)
- **Schema (frozen contract):** [`schema/change-entry.schema.json`](schema/change-entry.schema.json) — changes require a version bump and a [changelog row](schema/CHANGELOG.md)
- **Version↔release map:** [`data/releases.yaml`](data/releases.yaml)
- **Pipeline (PDF → YAML):** `pipeline/` — five stages: extract, filter, AI extraction, validate, manifest
- **Acceptance:** `golden-questions/` — known-answer questions the corpus must answer correctly
- **MCP server:** [`mcp/server.ts`](mcp/server.ts) — `npm run mcp`; zero extra
  dependencies, stdio-only, read-only. Tools: `list_versions`, `get_changes`,
  `changes_between`, `search_corpus`. Point Claude Desktop/Code (or any MCP
  client) at it and ask "what breaks between v48 and v67 for Apex?".

**Coverage:** 39 versions (v29 Winter '14 → v67 Summer '26), ~3,000 entries
(52–116 per version; counts per version live in the manifest). v29/v30 are
already retired, but real codebases still carry components pinned to them, so
they're included — reviewed like every other version (see
[`pipeline/review/REVIEW-LOG.md`](pipeline/review/REVIEW-LOG.md)).

A release has 300–500 note sections; only developer-relevant behavior survives
the inclusion rule. The most valuable field in every entry is `appliesWhen`:
whether a change is tied to a component's compiled API version or applies
org-wide.
