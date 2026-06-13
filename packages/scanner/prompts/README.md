# Almanac prompt library

Copy-paste prompts that turn an Almanac scan (and the corpus) into something
useful. Each file has `{name, purpose, inputs, model_notes}` frontmatter and is
meant to be fed to an LLM along with the listed inputs.

| Prompt | Input | Output |
|---|---|---|
| [`upgrade-impact-review.md`](upgrade-impact-review.md) | report JSON + corpus slices | ranked, citation-backed "what changes + one test each" review |
| [`explain-to-my-manager.md`](explain-to-my-manager.md) | report JSON | one-page, business-language risk summary, dates first |
| [`brutal-security-review.md`](brutal-security-review.md) | the scanner source tree | adversarial audit of the zero-network / no-telemetry trust claim |
| [`assistant-handoff.md`](assistant-handoff.md) | this repo | run-mode orientation for an AI coding assistant |

Worked examples, each run on a real artifact and archived in `../examples/`:

- [`explain-to-my-manager.sample.md`](../examples/explain-to-my-manager.sample.md) — from the sample scan report.
- [`upgrade-impact-review.sample.md`](../examples/upgrade-impact-review.sample.md) — a v55–58 → 67 review; all 27 citations pass the groundedness gate.
- [`brutal-security-review.sample.md`](../examples/brutal-security-review.sample.md) — file:line audit of the scanner's trust claims.
