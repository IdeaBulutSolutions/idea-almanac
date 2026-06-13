# Almanac prompt library

A **prompt** here is a ready-made instruction you hand to an AI (Claude, Copilot, Cursor, or any chat model) together with your Almanac scan. Each one turns the scan into a specific, useful document — a manager summary, an effort estimate, an upgrade plan, and so on.

You usually don't run these by hand. `almanac scan --mode manager` (or `--mode full`) runs the right ones for you. Run them yourself only if you want to tweak the wording or feed them to a different tool — paste the prompt file plus the listed input into your AI of choice.

| Prompt | What you give it | What you get back |
|---|---|---|
| [`upgrade-impact-review.md`](upgrade-impact-review.md) | the scan report + the matching corpus changes | a ranked list of what changes on upgrade, each with a citation and one test to run |
| [`explain-to-my-manager.md`](explain-to-my-manager.md) | the scan report | a one-page, plain-business-language summary, dates first |
| [`effort-estimate.md`](effort-estimate.md) | the scan report (+ optional impact file) | how long the fix takes, by severity — fix-everything vs. breaking-changes-first |
| [`upgrade-guide.md`](upgrade-guide.md) | the scan report + impact file + your source code | a step-by-step upgrade plan for an AI coding agent, in the right order, with tests |
| [`deprecation-horizon.md`](deprecation-horizon.md) | the impact file (+ optional report) | a dated calendar of what still works but is going away — for planning |
| [`brutal-security-review.md`](brutal-security-review.md) | the scanner's source code | a tough, independent audit of the "zero network / no tracking" promise |
| [`assistant-handoff.md`](assistant-handoff.md) | the source repo | a one-page orientation for an AI agent working inside the code |

Each prompt file starts with a short header (`name`, `purpose`, `inputs`, `model_notes`) describing exactly what it expects.

**Real examples**, each produced from an actual scan:

- [`explain-to-my-manager.sample.md`](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/scanner/examples/explain-to-my-manager.sample.md) — a manager summary from the sample report.
- [`upgrade-impact-review.sample.md`](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/scanner/examples/upgrade-impact-review.sample.md) — a v55–58 → 67 review; all 27 citations are real corpus entries.
- [`brutal-security-review.sample.md`](https://github.com/IdeaBulutSolutions/idea-almanac/blob/main/packages/scanner/examples/brutal-security-review.sample.md) — a line-by-line audit of the privacy claims.
