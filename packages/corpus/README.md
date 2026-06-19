# Almanac corpus

The corpus is Almanac's built-in record of **what changed in every Salesforce release**. There's one file per API version (`data/v29.yaml` … `data/v67.yaml`), and each file lists the developer-relevant changes from that release — written in **our own words**, with a pointer back to the source (which document, page, and heading).

This is what powers `almanac impact`: when you upgrade from one API version to another, the corpus is how Almanac knows what actually changes behavior along the way.

The corpus contains **no copied Salesforce release-note text** — only our own summaries. The original PDFs are never committed (see [`input-pdfs/NAMING.md`](input-pdfs/NAMING.md)).

## What's in here

- **[`data/`](data/)** — one YAML file per API version, plus:
  - [`index.yaml`](data/index.yaml) — a generated list of versions, entry counts, and review status (`npm run manifest`).
  - [`releases.yaml`](data/releases.yaml) — which API version maps to which Salesforce release/season.
- **[`schema/change-entry.schema.json`](schema/change-entry.schema.json)** — the fixed shape every entry must follow. Changing it requires a version bump and a [changelog row](schema/CHANGELOG.md).
- **`pipeline/`** — the tooling that turns a release-note PDF into reviewed YAML, in five steps: extract → filter → AI extraction → validate → manifest.
- **`golden-questions/`** — known-answer questions the corpus must get right, as a quality check.
- **[`mcp/server.ts`](mcp/server.ts)** — an optional server that lets an AI assistant query the corpus directly (see below).

## Coverage

39 versions, from **v29 (Winter '14) to v67 (Summer '26)** — about **3,000 entries** (roughly 52–116 per version; exact counts live in the manifest). v29 and v30 are already retired, but real projects still have code pinned to them, so they're included and reviewed like every other version (see [`pipeline/review/REVIEW-LOG.md`](pipeline/review/REVIEW-LOG.md)).

A typical release has 300–500 note sections; only the changes that actually affect developers make the cut. The most important field in each entry is `appliesWhen`: whether the change is tied to a component's API version, or applies to the whole org regardless.

## Ask the corpus directly (MCP)

The corpus can run as a small, read-only [MCP](https://modelcontextprotocol.io) server — no extra dependencies, no network:

```bash
npm run mcp
```

Point Claude Desktop/Code (or any MCP client) at it and ask things like *"what changed between v48 and v67 for Apex?"*. Available tools: `list_versions`, `get_changes`, `changes_between`, `search_corpus`.
