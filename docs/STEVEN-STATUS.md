# Nathanael's Checkpoint Status

**Member:** Nathanael Steven Chiang
**Components owned:** `eval/` (evaluation harness, datasets and baselines) and `src/reliability/` (source reliability scorer)
**Last updated:** 17 October 2026
**Checkpoint date:** 18 October 2026
**Branch:** `steven-eval`. Full log: `STEVEN.md`.

All code here was written by Kiro (AI assistant) under Nathanael's direction and has not yet been reviewed line by line. See the AI disclaimer in `STEVEN.md`.

---

## 1. What was delivered

| File | Purpose | Status |
|---|---|---|
| `eval/harness/run.ts`, `metrics.ts`, `report.ts`, `compare.ts`, `dataset.ts` | Verdict harness: macro-F1, per-label P/R/F1, false-flag and miss rates, bootstrap ranges, paired comparison, test-split guard | Working |
| `eval/datasets/fever-dev.jsonl`, `fever-test.jsonl` | 50 dev and 300 test FEVER claims, balanced, seed 201 | Done (test frozen, not run) |
| `eval/harness/systems/constant.ts`, `noRag.ts` | Floor and no-RAG baselines | Working |
| `eval/harness/systems/minicheck.ts`, `tuneMinicheck.ts` | MiniCheck baseline and its threshold tuner | Written, never run |
| `eval/harness/systems/pipeline.ts` | Adapter for the real pipeline | Written, never run |
| `src/reliability/` (`types`, `config`, `tags`, `citations`, `history`, `http`, `signals`, `combine`, `aggregate`, `index`) | Four signals, 13-rule badge table, card-level badge, `scoreEvidence` entry point | Working |
| `src/reliability/*.test.ts` (7 files), `testArbitraries.ts` | Unit and fast-check property tests | Passing |
| `src/reliability/smoke.ts` | Live check on Treaty of Versailles, Lift Wing on or off | Working |
| `src/orchestrator/pipeline.ts` (reliability step only) | Replaces the placeholder badge with `scoreEvidence` | Typechecks. Needs Jonathan's PR approval. Not run end to end. |
| `eval/scripts/prepareRevisions.ts`, `eval/harness/revisionSampler.ts`, `reliabilityDataset.ts` | Builds the reverted/stable revision datasets | Working |
| `eval/datasets/reliability-dev.jsonl`, `reliability-test.jsonl` | 40 dev and 100 test revisions, balanced, seed 201 | Done (test frozen, not run) |
| `eval/harness/reliabilitySystems.ts`, `reliabilityRun.ts`, `reliabilityReport.ts`, `tuneReliability.ts` | `flag-nothing`, `revert-risk-only`, `scorer`, run script, report, tuner | Working |
| `eval/harness/*.test.ts` (4 reliability files) | Dataset, sampler, tuner and evaluation tests | Passing |

**AI technique in use:** rule-based scoring over Wikimedia signals, including the Lift Wing `revertrisk-language-agnostic` model, with plain-language reasons.

### Stubbed or unverified

| Part | State |
|---|---|
| Lift Wing revert risk | Not stubbed. Working live. `NOTECHECK_LIFTWING=off` turns it off, and cards then say `stubbed: ["revert-risk"]`. |
| Reliability on pipeline cards | Wired in, but not seen end to end. The orchestrator smoke stopped at extraction because `qwen3.5:4b` is not pulled here. |
| `pipeline` eval adapter | Looks for `factCheck` in `src/orchestrator/index.ts`, which does not exist. The orchestrator exports `runFactCheckPipeline` from `pipeline.ts`. |
| `minicheck` baseline | Never run. `bespoke-minicheck` is not installed. |

---

## 2. Evaluation results (dev splits)

### Verdicts, 50 FEVER claims

| System | Macro-F1 [95% range] | Accuracy | False-flag | Miss |
|---|---|---|---|---|
| `constant:Supported` | 0.169 [0.120, 0.216] | 34.0% | 0.0% | 100.0% |
| `no-rag` (`qwen3.5:9b`) | 0.429 [0.333, 0.512] | 54.0% | 29.4% | 11.8% |

No-RAG never answers Not Enough Info (0 of 16), mostly because FEVER marks plainly false claims as NEI. On Supported and Refuted only, macro-F1 is 0.793.

### Reliability Low flag, 40 revisions (20 reverted, 20 stable)

| System | Precision [95% range] | Recall [95% range] | F1 | Flag rate | TP/FP/FN/TN |
|---|---|---|---|---|---|
| `flag-nothing` | 0.000 | 0.000 | 0.000 | 0.0% | 0/0/20/20 |
| `revert-risk-only` (0.7) | 0.923 [0.750, 1.000] | 0.600 [0.357, 0.813] | 0.727 | 32.5% | 12/1/8/19 |
| `scorer` (0.7) | 0.923 [0.750, 1.000] | 0.600 [0.357, 0.813] | 0.727 | 32.5% | 12/1/8/19 |
| `scorer`, tuned 0.6 (in-sample) | 0.875 | 0.700 | 0.778 | 40.0% | 14/2/6/18 |

0 errors. Lift Wing answered for all 40. `revertRiskLow` changed from 0.7 to 0.6 after tuning on dev. The 0.6 numbers are the ones it was tuned on, not a held-out result.

Main findings: the scorer's Low flag is in practice Lift Wing, because article-level rules (more citations, cleanup, low citations) only give Medium. Five of the 8 misses had revert risk under 0.4 and nothing else wrong with the article. There was one false positive (risk 0.83).

---

## 3. Progress against the proposal

| Proposal item | State |
|---|---|
| Evaluation on FEVER with macro-F1 and baselines | Harness done. No-RAG and constant run on dev. MiniCheck and pipeline not run. |
| Pipeline beats no-RAG by 10 macro-F1 points | Not measured yet |
| Reliability flags: maintenance tags and recent edits | Done |
| Lift Wing revert risk working or documented as stubbed | Working |
| Citation coverage | Done |
| Flags tested on about 50 reverted and 50 stable revisions against "flag nothing" | Dev round done (40). Test round (100) pending. |
| Low flag precision and recall of at least 0.7 | Met on dev at 0.6 (in-sample only). Not met at 0.7 (recall 0.600). Test split decides. |
| Own-notes claims, generated claims, evidence-quality rating | Not started |

---

## 4. Open items

- Run `flag-nothing`, `revert-risk-only` and `scorer` once each on the reliability test split (`--split test --final`).
- See real badges on pipeline cards once the default model is available.
- Decide whether article-level rules should be able to give Low.
- `eval/results/` and `.kiro/` are gitignored, so the run files and the spec are not committed. Decide.
- MiniCheck run, pipeline run, own-notes claims, final FEVER test run.

## 5. Needs from teammates

| Who | What |
|---|---|
| Jonathan | Approve the pipeline PR (reliability step only). Confirm the default model. Agree on the `factCheck` export or adapter change. |
| Group | Agree to `fast-check` 4.10.2 as a dev dependency. Add `src/reliability` and `eval/harness` tests to `npm test` and fix the Windows glob. |
| Medapati | Fix `src/mcp/smoke.ts:35`, the only error in the root typecheck. |
| Aadhavan | Claim-generator output in the eval dataset format. |
