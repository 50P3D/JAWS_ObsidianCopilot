# AI use disclosure log

The course requires us to track how we use AI tools. Add one row per use. Do not edit other people's rows.

| Date | Member | Tool | What we asked it to do | How we used or changed the output |
|---|---|---|---|---|
| 2026-10-12 | Aadhavan | Claude | Drafted the repository README from our proposal and feedback | Reviewed, edited and committed |
| 2026-10-16 | Medapati | Antigravity | Scaffolded Obsidian plugin UI (command, settings, results panel) and MCP server (fact_check and retrieve tools) with contract mock data | Reviewed architecture, validated against ClaimCard schema, committed |
| 2026-10-17 | Nathanael | Kiro (Claude) | Planned and wrote the evaluation harness in `eval/` (FEVER dev/test sampling, no-RAG, MiniCheck and constant baselines, metrics with bootstrap intervals, reports), and ran the first 50-claim dev round | Metrics checked against a hand-computed example. To review before committing |
| 2026-10-17 | Jonathan | Claude | Explained the repo and my responsibilities, then guided me step by step through building the LLM stages and orchestrator. Drafted `src/llm/ollama.ts` (which I typed in), `extract.ts`, `verify.ts`, `src/orchestrator/pipeline.ts` and their tests; debugged issues from my test runs (wrong API path and model name, empty answers fixed with `think: false`, deleted maths replaced with placeholders) | Ran every stage and the end-to-end pipeline locally on qwen3.5:4b and 9b against live Wikipedia, compared the results, kept the fixes, and recorded the results and remaining failures in `src/llm/benchmarks/` and `JONATHAN.md` |