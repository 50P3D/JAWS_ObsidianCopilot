# Nathanael's Changes Since the Checkpoint

**Member:** Nathanael Steven Chiang
**Components owned:** `eval/` (evaluation harness, datasets and baselines) and `src/reliability/` (source reliability scorer)
**Checkpoint:** 18 October 2026. Status at that time: `docs/STEVEN-STATUS.md`.
**Last updated:** 9 November 2026
**Branch:** `steven-eval` at `8f1603c` (main merged in, including the `Williams` branch), plus uncommitted fixes.

All code and text here was written by Kiro (AI assistant) under Nathanael's direction. See `docs/ai-use-log.md`, rows dated 2026-11-07 and 2026-11-09.

---

## 1. Summary

- I ran the RAG-versus-no-RAG comparison and the MiniCheck baseline on the 50 FEVER dev claims. At the checkpoint only `no-rag` and `constant` had been run.
- The full pipeline (`qwen3.5:9b`, Wikipedia RAG) scores macro-F1 0.485. That is 5.6 points above `no-rag` (0.429), so the 10-point target is **not met yet**. MiniCheck scores 0.497.
- On Supported and Refuted claims the pipeline is the best system (macro-F1 0.886). It loses points because it almost never answers Not Enough Info.
- I made fixes for those failures in the verifier, extraction fallback and search queries. They are **not yet run with a model**.
- Reliability scorer: no changes since the checkpoint.

---

## 2. Evaluation results, 50 FEVER dev claims

| System | At checkpoint | Now: macro-F1 [95% CI] | Accuracy | False-flag | Miss |
|---|---|---|---|---|---|
| `constant:Supported` | 0.169 | 0.169 [0.120, 0.216] | 34.0% | 0.0% | 100.0% |
| `no-rag` (`qwen3.5:9b`, no evidence) | 0.429 | 0.429 [0.333, 0.512] | 54.0% | 29.4% | 11.8% |
| `minicheck` (single search, threshold 0.5) | Not run | 0.497 [0.381, 0.615] | 58.0% | 35.3% | 0.0% |
| `pipeline` (`qwen3.5:9b` + Wikipedia RAG) | Not run | 0.485 [0.396, 0.556] | 58.0% | 11.8% | 0.0% |

False-flag is the share of true claims called Refuted. Miss is the share of false claims not called Refuted.

- **Against `no-rag`** (paired bootstrap): pipeline +5.6 points [-3.1, +14.6], MiniCheck +6.9 points [-5.8, +19.8]. Both intervals include zero.
- **Supported and Refuted claims only:** pipeline 0.886, MiniCheck 0.818, `no-rag` 0.793.
- **Retrieval mainly cut false flags:** true claims called false fell from 5 of 17 (`no-rag`) to 2 of 17 (pipeline).
- **MiniCheck threshold:** 0.8 gives macro-F1 0.685, but it was tuned on the same 50 claims, so it is optimistic.
- **Reliability results** are the same as at the checkpoint. Both test splits are still frozen and unrun.

Reports: `eval/results/20261107-214030_minicheck_bespoke-minicheck_dev.md`, `eval/results/20261107-220641_pipeline_qwen3.5-9b_dev.md`.

### What failed in the pipeline run

- **NEI called Refuted:** 14 of 16 gold Not Enough Info claims. Some are the known FEVER problem (plainly false claims labelled NEI). Others are real mistakes: the model wrote that the passages "never mention" the fact and still answered Refuted. The verifier prompt told it to pick NEI only when evidence was "truly irrelevant".
- **Wrong article retrieved:** "Dub music" fetched "Rub-a-dub-dub", "Dreamer (2005 film)" fetched Tommy Dreamer, "A View to a Kill" fetched The View.
- **Negation:** "Tim Roth was not born on May 14th, 1961" got the right fact and the wrong label.
- **No answer:** extraction returned no claim for "Dakota Fanning models.", so it counts as invalid.

---

## 3. Evaluation harness changes (`eval/`)

| Change | Files |
|---|---|
| Pulled `bespoke-minicheck` and ran the baseline. At the checkpoint it was written but never run | `systems/minicheck.ts` |
| `minicheck` now searches Wikipedia the way the app does: claim first, then up to 3 query rewrites by `qwen3.5:9b` using the app's own `rewriteQuery` prompt. `--retries 0` gives the old single search | `harness/appRetrieval.ts` (new), `systems/minicheck.ts`, `systems/index.ts` |
| Every MiniCheck search is saved, so the threshold tuner replays the app's retry loop at each threshold, with no model calls | `tuneMinicheck.ts` |
| Reports list every search query for each failed claim | `report.ts` |
| Ran the `pipeline` adapter for the first time. It records `pipeline_version` and has a `--think` flag for the verifier | `systems/pipeline.ts` |
| Documented the new runs, flags and results | `eval/README.md` |

The MiniCheck run in the table used a single search. The retry version has only had a 4-claim smoke run.

---

## 4. App changes from the evaluation (uncommitted, not yet run)

These files belong to other members (`src/llm`, `src/orchestrator`: Jonathan; `src/retrieval`: Aadhavan; `src/plugin`: Medapati). Each change needs its owner's approval.

| Change | Where | Targets |
|---|---|---|
| Verifier: a passage that never mentions the fact means Not Enough Info, and Refuted needs passage text that conflicts with the claim | `src/llm/verify.ts` | NEI called Refuted |
| Verifier: judge the claim as written, with a "not born in 1961" example | `src/llm/verify.ts` | Negation |
| Verifier: `explanation` comes before `verdict` in the JSON schema | `src/llm/verify.ts` | Explanations that contradicted their verdict |
| `fallbackToText`: if extraction finds no claim in one short sentence, check it as written. On for the selection command and the eval, off for live checking | `src/orchestrator/pipeline.ts`, `src/plugin/main.ts` | "Dakota Fanning models." |
| Search queries: bracket titles and the claim's subject go first; "There" is no longer a name; "Apollo 11" keeps its number | `src/retrieval/query.ts` | Wrong article retrieved |
| Optional thinking mode for the verifier only | `src/llm/ollama.ts`, `src/orchestrator/pipeline.ts` | To try after the rest |
| `rewriteQuery` exported so the eval uses the app's prompt | `src/orchestrator/pipeline.ts` | Fair MiniCheck comparison |

How these were checked without a model:

- **Prompt estimate:** re-scoring the saved pipeline run gave about 0.74 macro-F1, by turning Refuted into NEI wherever the model's own explanation said the fact was not mentioned. This is an estimate, not a result.
- **Retrieval check** (keyword mode, Wikipedia only): on 57 claims with a known correct article, the right article came back for 51, up from 43, with none lost.
- **Build:** both typechecks pass, all 149 tests pass, and the plugin builds.

---

## 5. Open items from the checkpoint

| Item in `STEVEN-STATUS.md` | Now |
|---|---|
| `minicheck` baseline never run | Done on dev (single search) |
| `pipeline` adapter could not find `factCheck` | Fixed by Medapati's `src/orchestrator/index.ts` (merged). Run on dev |
| Pipeline beats no-RAG by 10 points: not measured | Measured: +5.6, not met yet |
| Root typecheck error at `src/mcp/smoke.ts:35` | Fixed upstream. Root typecheck passes |
| Reliability badges not seen on real pipeline cards | Pipeline runs end to end now, but I have not checked the badges yet |
| Reliability test split (100 revisions) | Still pending |
| Windows: `npm test` glob does not expand | Still open. List the test files explicitly |
| Own-notes claims, generated claims, evidence-quality rating | Not started |

---

## 6. Next steps

- Rerun `pipeline` and `minicheck` on the dev split with the fixes, then compare against `no-rag`.
- Freeze the prompt and the MiniCheck threshold. Then run every verdict system once on the 300-claim test split (`--split test --final`), and the reliability systems once on the 100-revision test split.
- Check reliability badges on real pipeline cards.
- 50 own-notes claims, the generated-claims spot check, and the two-rater evidence-quality study (target 80%).

## 7. Needs from teammates

| Who | What |
|---|---|
| Jonathan | Approve the `src/llm/verify.ts` and `src/orchestrator/pipeline.ts` changes (verifier prompt, `fallbackToText`, `verifierThink`, `rewriteQuery` export) |
| Aadhavan | Approve the search-query change in `src/retrieval/query.ts` |
| Medapati | Approve the one-line `fallbackToText` change in `src/plugin/main.ts` (selection command only) |
