# AI Use Log: Nathanael Steven Chiang

<!--
Edit only your own file.

Add one entry per task in which an AI tool produced or substantially
shaped work you submit. Add entries as you work, and commit each entry
together with the work it describes.

Outcome is one of: Kept, Changed, Rejected.
-->

Entries up to 2026-11-09 were moved from the shared table in `docs/ai-use-log.md` on 2026-11-10. Where that table did not record a detail, such as the model, the entry says "not recorded".

## 2026-10-17 · Evaluation harness and first dev round
- **Tool (model):** Kiro (Claude; Opus 5.5)
- **Files:** eval/ (harness, FEVER dev and test samples, baselines, metrics, reports, README)
- **Outcome:** Kept

### What I asked for
A plan, then the evaluation harness in `eval/`: FEVER dev and test sampling,
the no-RAG, MiniCheck and constant baselines, metrics with bootstrap
intervals, and reports. Then a first 50-claim dev round.

### How I checked it
Checked the metrics against an example computed by hand.

### What I kept or changed
Kept the harness. Still to review before committing.

## 2026-10-17 · Reliability scorer and its evaluation
- **Tool (model):** Kiro (Claude; Opus 5.5)
- **Files:** .kiro/specs/reliability-scorer/, src/reliability/, src/orchestrator/pipeline.ts (reliability step only), eval/ (reliability evaluation)
- **Outcome:** Kept

### What I asked for
A spec first, then the reliability scorer in `src/reliability/`: maintenance
tags, recent edits, Lift Wing revert risk, citation coverage and a
rule-based High/Medium/Low badge. Then wire it into
`src/orchestrator/pipeline.ts` in place of the placeholder badge, and build
and run the reliability evaluation in `eval/` (40 dev revisions, threshold
tuned on dev).

### How I checked it
Ran 80 unit and property tests and both typechecks (the root typecheck only
fails at the existing `src/mcp/smoke.ts:35`). Ran a live smoke on one
article, and the dev round against "flag nothing" and "revert risk only".

### What I kept or changed
Kept the scorer and the evaluation. Not yet reviewed line by line; to review
before committing. The pipeline change needs Jonathan's approval.

## 2026-11-07 · MiniCheck and pipeline dev rounds
- **Tool (model):** Kiro (Claude; Opus 5.5, GPT 5.6 Terra)
- **Files:** eval/harness/appRetrieval.ts, eval/harness/tuneMinicheck.ts, src/orchestrator/pipeline.ts (`rewriteQuery` export), eval/README.md, eval/results/
- **Outcome:** Kept

### What I asked for
Pull `bespoke-minicheck` and run the `minicheck` dev round (single search).
Make the `minicheck` baseline search Wikipedia like the app: a new
`eval/harness/appRetrieval.ts` that uses the app's query-rewrite retries
through `rewriteQuery`, now exported from `src/orchestrator/pipeline.ts`.
Add offline threshold replay in `tuneMinicheck.ts` and per-search detail in
the reports. Then run the `pipeline` dev round with `qwen3.5:9b` as the only
chat model, compare it with `no-rag` and `minicheck`, and analyse the
failures.

### How I checked it
Typechecks pass. Checked the replay logic on hand-made cases, and ran a
4-claim smoke before the full runs.

### What I kept or changed
Kept the changes and recorded the results in `eval/README.md` and
`eval/results/`: macro-F1 on 50 dev claims is 0.497 for minicheck, 0.485 for
pipeline and 0.429 for no-rag. The minicheck threshold of 0.8 is tuned
in-sample. The `rewriteQuery` export needs Jonathan's approval.

## 2026-11-09 · Fixes for the pipeline's dev failures
- **Tool (model):** Kiro (Claude; Opus 5.5, GPT 5.6 Terra)
- **Files:** src/llm/verify.ts, src/llm/ollama.ts, src/orchestrator/pipeline.ts, src/plugin/main.ts, src/retrieval/query.ts, eval/ (`--think` option)
- **Outcome:** Changed

### What I asked for
Proposals and fixes for the pipeline's dev failures:
- a verifier prompt that treats missing facts as Not Enough Info, a negation
  rule, and the explanation before the verdict (`src/llm/verify.ts`)
- `fallbackToText` when extraction returns no claims, used by the selection
  command and the eval (`src/orchestrator/pipeline.ts`, `src/plugin/main.ts`)
- subject and bracket-title search queries (`src/retrieval/query.ts`)
- an optional verifier thinking mode (`--think`, `src/llm/ollama.ts`)

### How I checked it
Estimated the effect of the prompt fix offline from the saved run before
changing it. Ran both typechecks, the 149 existing tests, the plugin build,
and a keyword-mode retrieval check: the expected page was found for 51 of 57
claims, up from 43, with none lost. Not yet run with a model; the dev rerun
is pending.

### What I kept or changed
The changes to `src/llm`, `src/orchestrator`,
`src/retrieval` and `src/plugin` need their owners' approval.
Eventually, the update was changed and repurposed with William's changes.
The new prompts now use Williams one, not the previous rigid prompt.
Logic of fallbackToText, thinking mode restored after merging William's changes.

## 2026-11-09 · Ghost text not appearing
- **Tool (model):** Kiro (Claude; Opus5.5, GPT 5.6 Terra)
- **Files:** src/plugin/main.ts, src/plugin/ghostText.ts, src/plugin/GHOST-TEXT.md
- **Outcome:** Kept

### What I asked for
Find out why ghost text often never appeared, even after waiting 40 to 60
seconds. Kiro found two causes. With live fact-checking on, a suggestion was
dropped (not retried) whenever a live check was running at the end of the
typing pause. And a fact-check request pushed the ghost model out of memory.
Kiro changed `requestGhost` in `src/plugin/main.ts` to try again every 500 ms
until the live check is done (typing or moving the cursor still cancels it),
made ghost requests ask Ollama for a 2048-token context (`num_ctx`) in
`src/plugin/ghostText.ts`, and updated `src/plugin/GHOST-TEXT.md`.

### How I checked it
Measured against the local Ollama before changing anything: the plugin's own
prompt and cleaning gave a suggestion at 36 of 44 cursor positions in a test
note (median 186 ms), so the model and prompt were not the cause. After the
change, `qwen3.5:2b` uses 2.3 GB instead of 4.1 GB, and a suggestion after a
fact-check takes about 6 s instead of 23 s. The 143 plugin tests and the
typecheck pass, and the plugin builds. No new unit tests. The retry is not
yet tried in Obsidian.

### What I kept or changed
Kept the changes. The 4b fact-check model (131072 context, 8.9 GB) still
evicts the ghost model; shrinking that context is not done. The change
touches `src/plugin/`, so the plugin owner must approve.

## 2026-11-09 · Course files not picked up
- **Tool (model):** Kiro (Claude; Opus 5.5)
- **Files:** src/plugin/courseFiles.ts, src/plugin/main.ts, src/course/index.ts
- **Outcome:** Kept

### What I asked for
Find out why course files were not picked up. Kiro found that `courseFiles`
in `src/plugin/main.ts` only listed markdown files (`getMarkdownFiles`), so
PDFs were never seen. It also matched the setting with a case-sensitive
folder prefix, so a different letter case, a single file path, a quoted path
or an absolute Windows path matched nothing.

Kiro added `src/plugin/courseFiles.ts`: setting-to-path matching that
ignores case and accepts a folder or one file, quotes, `./`, backslashes and
absolute paths inside the vault, plus PDF text extraction through Obsidian's
built-in pdf.js. It changed `courseFiles` to use `getFiles()` for `.md` and
`.pdf` and to read PDFs with `readBinary`, made `fileTitle` in
`src/course/index.ts` strip `.pdf`, and made the index notices say when no
files were found.

### How I checked it
The typecheck passes, the 11 course tests and 143 plugin tests pass, and the
plugin builds. Checked the path matching on 12 settings and the PDF text
joining with a fake pdf.js in a throwaway script, not added as tests. Not yet
tried in Obsidian on a real PDF.

### What I kept or changed
Kept the changes. Scanned PDFs with no text layer still give no passages,
and `src/course/node.ts` (MCP side) still reads `.md` only. The change
touches `src/plugin/` and `src/course/`, so the plugin owner must approve.
