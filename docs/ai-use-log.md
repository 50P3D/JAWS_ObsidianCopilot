# AI use disclosure log

The course requires us to track how we use AI tools. Add one row per use. Do not edit other people's rows.

| Date | Member | Tool | What we asked it to do | How we used or changed the output |
|---|---|---|---|---|
| 2026-10-12 | Aadhavan | Claude | Drafted the repository README from our proposal and feedback | Reviewed, edited and committed |
| 2026-10-16 | Medapati | Antigravity | Scaffolded Obsidian plugin UI (command, settings, results panel) and MCP server (fact_check and retrieve tools) with contract mock data | Reviewed architecture, validated against ClaimCard schema, committed |
| 2026-10-17 | Nathanael | Kiro (Claude) | Planned and wrote the evaluation harness in `eval/` (FEVER dev/test sampling, no-RAG, MiniCheck and constant baselines, metrics with bootstrap intervals, reports), and ran the first 50-claim dev round | Metrics checked against a hand-computed example. To review before committing |
| 2026-10-17 | Nathanael | Kiro (Claude) | Wrote a spec, then built the reliability scorer in `src/reliability/` (maintenance tags, recent edits, Lift Wing revert risk, citation coverage, rule-based High/Medium/Low badge), wired it into `src/orchestrator/pipeline.ts` in place of the placeholder badge, and built and ran the reliability evaluation in `eval/` (40 dev revisions, threshold tuned on dev) | Checked with 80 unit and property tests, the typechecks (root only fails at the existing `src/mcp/smoke.ts:35`), a live smoke on one article, and the dev round against "flag nothing" and "revert risk only". Pipeline change needs Jonathan's approval. Not yet reviewed line by line; to review before committing |
