# eval: evaluation harness and baselines

Owner: Nathanael. Scores fact-check verdicts against labelled claims, compares the pipeline with baselines and keeps the test set honest.

## Quick start

From the repo root, with Ollama running:

```
npx tsx eval/scripts/prepareFever.ts                      # download FEVER dev, write balanced dev/test samples
npx tsx eval/harness/run.ts --system constant:Supported   # floor, no model needed (checks the harness)
npx tsx eval/harness/run.ts --system no-rag               # qwen3.5:9b with no evidence
npx tsx eval/harness/run.ts --system minicheck            # the app's Wikipedia retrieval (with query-rewrite retries) + Bespoke-MiniCheck
npx tsx eval/harness/run.ts --system minicheck --retries 0   # single search, no rewrite model
npx tsx eval/harness/tuneMinicheck.ts eval/results/<minicheck dev run>.json   # pick --nei-threshold, no model calls
npx tsx eval/harness/run.ts --system pipeline --model qwen3.5:9b           # the whole app: factCheck() from src/orchestrator/
npx tsx eval/harness/run.ts --system pipeline --model qwen3.5:9b --think   # same, with thinking on for the verifier
npx tsx eval/harness/compare.ts eval/results/<a>.json eval/results/<b>.json
npx tsc -p eval --noEmit                                  # typecheck the harness
```

Each run writes `eval/results/<run_id>.json` (every prediction) and `<run_id>.md` (metrics, confusion matrix, every failure, caveats).

Reliability evaluation (needs network access to Wikimedia, no Ollama):

```
npx tsx eval/scripts/prepareRevisions.ts                  # fetch pools, write reliability-dev/test (flags: --dev 20 --test 50 per label, --seed 201)
npx tsx eval/harness/reliabilityRun.ts --system flag-nothing        # floor: never flags Low
npx tsx eval/harness/reliabilityRun.ts --system revert-risk-only    # Low exactly when Lift Wing revert risk >= revertRiskLow
npx tsx eval/harness/reliabilityRun.ts --system scorer              # the real scorer (src/reliability/)
npx tsx eval/harness/reliabilityRun.ts --system scorer --liftwing off   # without Lift Wing
npx tsx eval/harness/tuneReliability.ts eval/results/<scorer dev run>.json   # sweep revertRiskLow 0.30-0.95 from saved signals, no network
npx tsx eval/harness/reliabilityRun.ts --system scorer --split test --final --risk-low <tuned>   # once, at the end
```

Other `reliabilityRun.ts` flags: `--dataset`, `--limit N`, `--out <dir>`. `NOTECHECK_LIFTWING=off` also turns Lift Wing off. Each run writes `<run_id>.json` (every row with its signals, reasons and fired rules) and `<run_id>.md` (precision, recall, F1 and flag rate with intervals, TP/FP/FN/TN, rule firing counts, Unavailable counts, every false positive and false negative). The tuner writes `results/tune-reliability-<run_id>.md`.

Tests: `npm test` only covers `src/retrieval`, and its glob does not expand on Windows, so list the files:

```
npx tsx --test eval/harness/reliabilityDataset.test.ts eval/harness/revisionSampler.test.ts eval/harness/tuneReliability.test.ts eval/harness/reliabilityEval.test.ts
```

## Layout

| Path | What it is |
|---|---|
| `datasets/fever-dev.jsonl` | 50 FEVER claims (17 Supported, 17 Refuted, 16 NEI) for tuning and the checkpoint round |
| `datasets/fever-test.jsonl` | 300 FEVER claims (100 per label), frozen, run once at the end |
| `datasets/raw/` | Full FEVER download. Gitignored |
| `scripts/prepareFever.ts` | Download plus seeded, balanced, disjoint sampling (seed 201) |
| `harness/run.ts` | Run one system on one split |
| `harness/compare.ts` | Compare runs on shared claims, paired bootstrap delta against a baseline |
| `harness/tuneMinicheck.ts` | Pick MiniCheck's NEI threshold from a saved dev run, no model calls |
| `harness/rerender.ts` | Rebuild a report from a saved run |
| `harness/metrics.ts` | Macro-F1, per-label P/R/F1, false-flag and miss rates, bootstrap CIs, binary P/R for reliability flags |
| `harness/systems/` | `constant`, `no-rag`, `minicheck`, `pipeline` |
| `harness/git.ts` | `gitCommit()` (short sha, `-dirty` for local changes), shared by both runners |
| `datasets/reliability-dev.jsonl` | 40 revisions (20 reverted, 20 stable) for tuning. Written by `prepareRevisions.ts` |
| `datasets/reliability-test.jsonl` | 100 revisions (50 per label), frozen, run once at the end. Not run yet |
| `scripts/prepareRevisions.ts` | Fetch the reverted and stable pools from recent changes and draw the splits |
| `harness/revisionSampler.ts` | Seeded, balanced, disjoint sampling, one revision per article, plus the file header |
| `harness/reliabilityDataset.ts` | Revision dataset loader and writer, and the reliability run file types |
| `harness/reliabilitySystems.ts` | `flag-nothing`, `revert-risk-only`, `scorer` |
| `harness/reliabilityRun.ts` | Run one reliability system on one split |
| `harness/reliabilityReport.ts` | Reliability report: Low-flag metrics, rule and Unavailable counts, failures, caveats |
| `harness/tuneReliability.ts` | Pick `revertRiskLow` from a saved scorer dev run, no network |
| `harness/*.test.ts` | Tests for the reliability dataset, sampler, tuner and evaluation (`node:test` plus fast-check) |

## Systems

| Name | What it is | Why |
|---|---|---|
| `constant:<label>` | Always one label | Floor. On balanced data, macro-F1 is about 0.17 |
| `no-rag` | `qwen3.5:9b`, claim only, JSON output, temperature 0, thinking off | Proposal baseline. The pipeline must beat it by 10 macro-F1 points |
| `minicheck` | The app's Wikipedia retrieval (`harness/appRetrieval.ts`) + `bespoke-minicheck` | Proposal baseline. MiniCheck only answers Yes or No, so No becomes Refuted if the best passage scores at least `--nei-threshold`, otherwise NEI |
| `pipeline` | `factCheck(req)` from `src/orchestrator/index.ts` | System under test. Multiple cards per claim combine as any Refuted, then Refuted; all Supported, then Supported; anything else, NEI |

### How `minicheck` retrieves, like the app

`harness/appRetrieval.ts` copies the Wikipedia loop in `checkOne` (`src/orchestrator/pipeline.ts`):

1. Search with the claim: `retrieveEvidence(claim)` (hybrid keyword + `nomic-embed-text`, 3 articles, top 3 passages, the app's defaults).
2. If the answer is Not Enough Info, the chat model writes a new search query with the app's own `rewriteQuery` prompt, and retrieval runs again on that query. Up to `--retries` extra searches (default 3, as in the app). It stops early when the new query is empty or was already tried.
3. The verdict is the first search that is not Not Enough Info, or the first search if all are.

MiniCheck replaces the app's verifier. Claim extraction and reliability badges are skipped: FEVER claims are already single claims, and badges do not change the verdict. `pipeline` runs all of it.

Which searches the app would run depends on the threshold. So `minicheck` keeps searching after every No (any score) and stops at the first Yes, saves every search in `extra.attempts`, and replays the app's loop on them. `tuneMinicheck.ts` does the same replay at each threshold, so tuning stays exact without model calls. Because of the extra searches, a run's latency is an upper bound; `extra.app_ms` is what the app's loop would take. Failures in the report list every search query with its answer and best score.

Flags: `--retries N` (0 is the old single-search baseline), `--rewrite-model` (default `qwen3.5:9b`, the plugin default), `--nei-threshold`, `--retrieval-mode`, `--top`.

`minicheck` needs `ollama pull bespoke-minicheck` (4.7 GB) and, with retries, the rewrite model. On an 8 GB GPU the two models do not fit together, so Ollama swaps them on each rewrite: about 20 s per extra search. A dev run takes roughly half an hour. `--rewrite-model qwen3.5:4b` is faster but no longer matches the plugin default.

For a fair no-RAG comparison, `no-rag` should use the verifier's prompt with the evidence removed, once that prompt exists in `src/llm/`. Change `NO_RAG_PROMPT` and bump `PROMPT_VERSION` in `harness/systems/noRag.ts`.

## Metrics

- **Macro-F1** over the labels present in the gold data (headline, as in the proposal). Unparseable outputs count as wrong.
- **Per-label precision, recall and F1**, plus a confusion matrix.
- **False-flag rate**: share of true (Supported) claims called Refuted. **Miss rate**: share of false (Refuted) claims not called Refuted. The instructor asked for both.
- **95% intervals** from 2000 seeded bootstrap resamples. `compare.ts` uses a paired bootstrap, so both systems are scored on the same resampled claims.
- Reports also show a **Supported and Refuted only** section, because FEVER's NEI label is unreliable (see below).
- **Reliability**: `binaryMetrics` scores the Low badge against "was reverted" (gold positive = reverted, predicted positive = badge Low). Precision, recall, F1 and flag rate, with the same seeded bootstrap intervals. A row that errors counts as not flagged. The proposal target is precision and recall of at least 0.7.

## Rules that keep the numbers honest

- **Tune on dev, test once.** `--split test` refuses to run without `--final` (in `run.ts` and `reliabilityRun.ts`), and every test run is appended to `results/TEST_RUNS.md`. More than one row per system means we peeked. `tuneMinicheck.ts` and `tuneReliability.ts` work from saved dev runs only.
- **Balanced labels.** Both splits have about equal Supported, Refuted and NEI, interleaved so `--limit N` stays balanced.
- **Judge and system from different families.** Every run records the model family (`qwen`, `claude` and so on). A Claude judge can mark Qwen. Qwen must not mark Qwen. There is no judge yet, so the check (`modelFamily` in `harness/ollama.ts`) gets wired in when the judge is added.
- **Reproducible.** Runs record the git commit (with `-dirty` if there were local changes), the dataset sha256, the prompt version and every setting.

## Caveats

- **FEVER may be contaminated.** It was published in 2018 from a 2017 Wikipedia dump, so current models have probably seen it. A good no-RAG score may come from memory. The own-notes and Claude-generated claims are the check on this.
- **FEVER NEI is about the 2017 dump, not the world.** "Tinker Tailor Soldier Spy stars Jonah Hill" is NEI in FEVER, but any reader can see it is false. A model that says Refuted is marked wrong.
- **Wikipedia has changed since 2017.** Retrieval reads today's pages, so a few gold labels may no longer match.
- **50 claims is small.** One claim is 2 points of accuracy. Read the intervals.

## First round (checkpoint, dev split, 50 FEVER claims)

| System | Macro-F1 [95% CI] | Accuracy | False-flag | Miss | Median latency |
|---|---|---|---|---|---|
| `constant:Supported` | 0.169 [0.120, 0.216] | 34.0% | 0.0% | 100.0% | 0 ms |
| `no-rag` (`qwen3.5:9b`) | 0.429 [0.333, 0.512] | 54.0% | 29.4% | 11.8% | 2.6 s |

Full reports: `results/20261016-225821_no-rag_qwen3.5-9b_dev.md`, `results/compare-dev.md`.

What failed:

- **It never answers NEI** (0 of 16). Ten gold-NEI claims were called Refuted, and most of those are plainly false ("Qui-Gon Jinn is portrayed by Johnny Depp"), so this is mostly the FEVER NEI problem, not the model. On Supported and Refuted claims only, macro-F1 is 0.793.
- **It calls true claims false** (5 of 17). Some are confident hallucinations: Brubaker "is about a police officer, not a prison drama", and Fabian Nicieza's birth date.
- **Ambiguous titles.** "Due Date was shot in the United States" was read as being about a rapper, not the 2010 film. Retrieval and disambiguation should fix this.
- **A wrong gold label.** "Tim Roth was not born on May 14th, 1961" is Supported in FEVER, but Tim Roth was born on 14 May 1961, so the claim is false. The model's Refuted is right. (Earlier versions of this README called this a negation error.)

Later (single search, before the rewrite retries were added): `minicheck` at threshold 0.5 scored macro-F1 0.497 [0.381, 0.615], accuracy 58.0%, false-flag 35.3%, miss 0.0%. Threshold 0.8, tuned on the same 50 claims, gives 0.685 (in-sample). Report: `results/20261107-214030_minicheck_bespoke-minicheck_dev.md`.

`pipeline` with `qwen3.5:9b` as the only chat model (extraction, query rewrites, verifier; `nomic-embed-text` for retrieval): macro-F1 0.485 [0.396, 0.556], accuracy 58.0%, false-flag 11.8%, miss 0.0%, 1 invalid (extraction returned no claim for "Dakota Fanning models."), median latency 10.2 s. On Supported and Refuted only, macro-F1 0.886. It never answers NEI (14 of 16 gold NEI called Refuted). Against `no-rag`: +5.6 points [-3.1, +14.6], short of the +10 target. Report: `results/20261107-220641_pipeline_qwen3.5-9b_dev.md`.

### Changes after that round (`PIPELINE_VERSION` 2, not yet run)

Each change targets failures in that report. Every one changes the app, not just the eval.

| Change | Where | Failure it targets |
|---|---|---|
| Missing is not false: a passage that never mentions the fact is NEI, and Refuted needs passage text that conflicts with the claim. Replaces "prefer Supported or Refuted based on the closest match" | `src/llm/verify.ts` | 14 of 16 gold NEI called Refuted, often with "the passages never mention..." |
| Judge the claim as written, with a worked "not born in 1961" example | `src/llm/verify.ts` | Negated claims in general. (Targeted at Tim Roth, which turned out to be a wrong gold label, not a model error) |
| `explanation` comes before `verdict` in the JSON schema, so the model says what the passages say before deciding | `src/llm/verify.ts` | Explanations that contradicted their own verdict |
| `fallbackToText`: if extraction returns no claims for one short sentence, check the sentence as it is. On for the selection command and the eval, off for the live checker | `src/orchestrator/pipeline.ts`, `src/plugin/main.ts` | "Dakota Fanning models." came back with no card |
| Search queries: titles with a bracket written in the claim ("Dreamer (2005 film)") and the subject before the main verb ("Dub music", "A View to a Kill") go first; sentence-start words like "There" are not names; "Apollo 11" keeps its number | `src/retrieval/query.ts` | Rub-a-dub-dub, Tommy Dreamer, The View, "Who Goes There?" |
| `--think` turns on qwen3.x thinking for the verifier only (`verifierThink`) | `src/llm/ollama.ts`, `src/orchestrator/pipeline.ts` | Optional; try after the rest. Slower |

Retrieval check, keyword mode, no Ollama: on 57 claims with known pages (34 FEVER dev with `evidence_pages`, the 20 in `src/retrieval/testdata/claims.json`, and 3 FEVER NEI claims whose article is obvious), a passage from an expected page came back for 43 before and 51 after, with none lost. Wikipedia rate-limits (HTTP 429) quick repeated runs, so pause between them. Retrieval feeds `minicheck` too, so rerun both before comparing them.

Expected cost: more NEI answers trigger more query-rewrite retries, so `pipeline` will be slower than 10.2 s median.

## Reliability dev round (40 revisions, 0 errors)

| System | Precision [95% CI] | Recall [95% CI] | F1 | Flag rate |
|---|---|---|---|---|
| `flag-nothing` | 0.000 | 0.000 | 0.000 | 0.0% |
| `revert-risk-only` (0.7) | 0.923 [0.750, 1.000] | 0.600 [0.357, 0.813] | 0.727 | 32.5% |
| `scorer` (0.7) | Same as `revert-risk-only` | | | |
| `scorer` tuned 0.6 (in-sample) | 0.875 | 0.700 | 0.778 | 40.0% |

On dev the scorer's Low flag is in practice Lift Wing. Full reports: `results/20261017-*_reliability-*_dev.md`, `results/tune-reliability-20261017-190041_reliability-scorer_dev.md`.

## Plan

| Phase | Work | State |
|---|---|---|
| 1 | Verdict harness, FEVER dev/test, `no-rag` and `constant` baselines, first round on 50 claims | Done |
| 1 | `minicheck` baseline | Single-search dev run done (macro-F1 0.497 at threshold 0.5). Now uses the app's retrieval with rewrite retries; dev run with retries pending |
| 1 | `pipeline` adapter | Dev run done with `qwen3.5:9b` (macro-F1 0.485, +5.6 over `no-rag`). Fixes for that round are in (`PIPELINE_VERSION` 2, below); dev rerun pending |
| 2 | 50 claims from our own notes (`source: "notes"`) | Todo, needs the team's notes |
| 2 | Spot check of Claude-generated claims (`source: "generated"`, `human_checked`) | Todo, after Aadhavan's `tools/claim-generator` |
| 2 | Evidence-quality sheet for two raters, 50 sampled verdicts, with agreement (Cohen's kappa) | Todo |
| 3 | Reliability scorer in `src/reliability/`, evaluated on 50 reverted and 50 stable revisions against "flag nothing" and "revert risk only" | Datasets built. Dev round done, `revertRiskLow` tuned 0.7 → 0.6 on dev. Test run pending |
| 4 | Final: tune on dev, run each system once on test with `--final`, write up | Todo |

## Dataset format

One JSON object per line. Lines starting with `//` are comments.

```json
{"id": "notes-001", "claim": "...", "label": "Supported", "source": "notes", "split": "dev"}
```

`label` is `Supported`, `Refuted` or `Not Enough Info`. `source` is `fever`, `notes` or `generated`. `split` is `dev` or `test`. Optional fields: `evidence_pages`, `original_fact`, `rationale`, `human_checked`, `note`.

FEVER (Thorne et al., 2018) is licensed CC BY-SA 3.0.

## Revision dataset format

One JSON object per line, with a `//` header recording the split, counts, seed, recent-changes query, fetch time and pool sha256.

```json
{"id": "rev-1380758127", "rev_id": 1380758127, "page_title": "...", "timestamp": "2026-10-01T12:34:56Z", "reverted": true, "split": "dev"}
```

Only these six keys are written or read. No user names or IP addresses are fetched or stored. The loader rejects, with a line number, a missing or duplicate `id`, a non-numeric `rev_id`, a non-boolean `reverted` and a split other than `dev` or `test`.

Gold label, from English Wikipedia `list=recentchanges` (main namespace, no bots, edits only, no page creations, up to 2000 rows per pool):

- `reverted: true`: the edit carries the `mw-reverted` tag.
- `reverted: false`: the edit is 7 to 30 days old and has none of `mw-reverted`, `mw-rollback`, `mw-undo`, `mw-manual-revert`.

Labels are interleaved and each article appears at most once across both splits. The feed is live, so rerunning the script gives different pools; the committed files and their header sha256 are the record.

**As of the revision timestamp.** `scorer` and `revert-risk-only` score each revision with `asOf` set to its own `timestamp`, so edits, reverts and pending reviews after the save are ignored, and systems never see the `reverted` label. The scorer never reads the `mw-reverted` tag.

Caveats (also in every report):

- `mw-reverted` only marks reverts MediaWiki detects (rollback, undo, exact manual revert), so some "stable" edits were undone by hand. A stable edit can also be reverted after sampling.
- Evaluation scores the edit as of its save time; live use scores the current revision. Recency signals behave differently, but they only give Medium, so the Low flag is unaffected.
- Lift Wing revert risk is trained on revert data, so `revert-risk-only` is a strong baseline. The question is whether the rules add precision or recall beyond it.
- 40 dev and 100 test revisions are small. One revision moves precision or recall by several points. Tuning on 40 will overfit somewhat.
