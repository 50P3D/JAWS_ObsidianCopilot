# AI Use Log: Jonathan Ho

<!--
Edit only your own file.

Add one entry per task in which an AI tool produced or substantially
shaped work you submit. Add entries as you work, and commit each entry
together with the work it describes.

Outcome is one of: Kept, Changed, Rejected.
-->

Entries up to 2026-10-17 were moved from the shared table in `docs/ai-use-log.md` on 2026-11-10. Where that table did not record a detail, such as the model, the entry says "not recorded".

## 2026-10-17 · LLM stages and orchestrator
- **Tool (model):** Claude, in a Claude chat project with access to the repository (model not recorded)
- **Files:** src/llm/ollama.ts, src/llm/extract.ts, src/llm/verify.ts, src/orchestrator/pipeline.ts and their tests, src/llm/benchmarks/, JONATHAN.md
- **Outcome:** Kept

### What I asked for
An explanation of the repo and my responsibilities, then step-by-step
guidance through building the LLM stages and the orchestrator. Claude
drafted `src/llm/ollama.ts` (which I typed in), `extract.ts`, `verify.ts`,
`src/orchestrator/pipeline.ts` and their tests, and debugged the issues from
my test runs.

### How I checked it
Ran every stage and the end-to-end pipeline locally on `qwen3.5:4b` and
`qwen3.5:9b` against live Wikipedia, and compared the results. My test runs
showed a wrong API path and model name, empty answers (fixed with
`think: false`), and deleted maths that had been replaced with placeholders.

### What I kept or changed
Kept the fixes. Recorded the results and the remaining failures in
`src/llm/benchmarks/` and `JONATHAN.md`.
