# NATHANAEL.md: Nathanael's progress log

Area: **evaluation harness and baselines** (`eval/`) and the **reliability scorer** (`src/reliability/`). The scorer is built, wired into the pipeline (pending Jonathan's approval) and evaluated on the dev split. The frozen test split has not been run.
Branch: steven-eval
Last updated: 17 October 2026.
Short checkpoint summary: `docs/STEVEN-STATUS.md`.

## AI disclaimer

The code, datasets and documentation in `eval/` and `src/reliability/` were written by **Kiro** (an AI coding assistant built from AWS leveragin models such as Anthropic/Claude), working inside Nathanael's repo. No other AI provider was used.

Nathanael directed the work and asked for the evaluator first, with a plan based on the repo and the proposal PDF. Kiro read the repo and the proposal, wrote the files, ran the commands and reported the results. This covers:

- everything under `eval/` (harness, scripts, README, the dataset files, the saved run results)
- one row added to `docs/ai-use-log.md`
- this file

For the reliability scorer, Nathanael asked for a spec first (`.kiro/specs/reliability-scorer/`: requirements, design, tasks), then had Kiro carry it out. Kiro wrote:

- `src/reliability/`: `types.ts`, `config.ts`, `tags.ts`, `citations.ts`, `history.ts`, `http.ts`, `signals.ts`, `combine.ts`, `aggregate.ts`, `index.ts`, `smoke.ts`, `testArbitraries.ts`, and the tests `tags`, `citations`, `history`, `combine`, `aggregate`, `signals` and `index` `.test.ts`
- `src/orchestrator/pipeline.ts`: the reliability step only (Jonathan's folder, needs his PR approval)
- `eval/harness/`: `git.ts`, `reliabilityDataset.ts`, `revisionSampler.ts`, `reliabilitySystems.ts`, `reliabilityReport.ts`, `reliabilityRun.ts`, `tuneReliability.ts`, and the tests `reliabilityDataset`, `revisionSampler`, `tuneReliability` and `reliabilityEval` `.test.ts`
- `eval/scripts/prepareRevisions.ts`
- `eval/harness/run.ts`: `gitCommit` moved to `git.ts`, no change in behaviour
- `eval/README.md` (reliability sections)
- `eval/datasets/reliability-dev.jsonl` (40 revisions) and `reliability-test.jsonl` (100)
- `package.json` and `package-lock.json`: `fast-check` 4.10.2 as an exact-pinned dev dependency
- a second row in `docs/ai-use-log.md`, `docs/STEVEN-STATUS.md`, and the updates to this file

Nathanael has not yet reviewed the code line by line or run it on his own machine. Do that before committing. (Testing and review will be done by next commits)

## Additional notes (from me)

I think there could be fine-tuning or better information scraper to improve the model's accuracy, correctness, and helpfulness. The model (Qwen 3.5:9b) tends to hallucinate a bit if used without any training whatsoever. However, it still shows some promising features for a small model like this.

I will be waiting for test cases later, if we have the chance to finetune it.

## What the evaluator does

The job: take a labelled claim set, run a fact-checking system on every claim, and score the verdicts the way the proposal says (macro-F1 over Supported, Refuted and Not Enough Info).

1. **Build the data.** `prepareFever.ts` downloads the labelled FEVER dev file and draws two balanced samples from it with a fixed seed: a 50-claim dev set (tuning and the checkpoint round) and a 300-claim test set (frozen). The two never share a claim.
2. **Run a system.** `run.ts` feeds each claim to one system and records the verdict, the explanation, the raw model output, any evidence and the time taken. A failed or unparseable answer counts as wrong, never guessed.
3. **Score it.** Macro-F1, per-label precision, recall and F1, a confusion matrix, and two rates the instructor asked for: how often true claims are called Refuted (false-flag) and how often false claims are missed. Each headline number has a 95% range from a seeded bootstrap.
4. **Report.** Each run saves every prediction as JSON and a markdown report that lists every failure.
5. **Compare.** `compare.ts` scores runs on the claims they share and tests the change in macro-F1 against a baseline, using a paired bootstrap, so the proposal's "10 points above no-RAG" target can be checked with a range, not a single number.

Four systems can be scored:

| System | What it is |
|---|---|
| `constant:<label>` | Always answers one label. The floor, and a way to test the harness without a model. |
| `no-rag` | `qwen3.5:9b` with the claim only, no Wikipedia. The proposal's main baseline. |
| `minicheck` | Our retrieval (`src/retrieval`) plus Bespoke-MiniCheck. MiniCheck only says Yes or No, so a No becomes Refuted when the best passage scored at or above a threshold, and Not Enough Info otherwise. |
| `pipeline` | The real NoteCheck pipeline, through `factCheck(req)` from `src/orchestrator/`. |

Safeguards against fooling ourselves:

- The test split will not run without `--final`, and every test run is appended to `eval/results/TEST_RUNS.md`.
- Both splits have about equal numbers of each label (Arne's feedback on balance).
- Each run records the git commit (with `-dirty` for local changes), the dataset hash, the prompt version and all settings.
- Each system records its model family, ready for a judge-versus-system check once a judge exists.

## Results so far

Dev split, 50 FEVER claims (17 Supported, 17 Refuted, 16 Not Enough Info). With 50 claims, one claim is 2 points of accuracy, so read the ranges.

| System | Macro-F1 [95% range] | Accuracy | False-flag | Miss | Median time per claim |
|---|---|---|---|---|---|
| `constant:Supported` | 0.169 [0.120, 0.216] | 34.0% | 0.0% | 100.0% | under 1 ms |
| `no-rag` (`qwen3.5:9b`) | 0.429 [0.333, 0.512] | 54.0% | 29.4% | 11.8% | 2.6 s |

No-RAG is 26 points above the floor. This says nothing yet about the proposal's target, which is the pipeline beating no-RAG by 10 points. The pipeline has not been run.

Confusion matrix for no-RAG (rows are gold):

| gold \ predicted | Supported | Refuted | NEI |
|---|---|---|---|
| Supported | 12 | 5 | 0 |
| Refuted | 2 | 15 | 0 |
| NEI | 6 | 10 | 0 |

### Failures (documented for the checkpoint)

- **It never answers Not Enough Info (0 of 16).** Ten of those claims were called Refuted. Most are plainly false to any reader ("Qui-Gon Jinn is portrayed by Johnny Depp", "Brian De Palma was born in Taipei"). FEVER labels them NEI because the 2017 Wikipedia dump did not settle them, not because they are unknowable. So this failure is largely the dataset, not the model. Reading only the Supported and Refuted claims, macro-F1 is 0.793 [0.642, 0.912].
- **It calls true claims false (5 of 17).** Some are confident hallucinations: it said Brubaker is "a 1980 film about a police officer, not a prison drama", and gave a different birth date for Fabian Nicieza.
- **It misreads ambiguous titles.** "Due Date was shot in the United States" became a statement about a rapper, not the 2010 film. Disambiguation in retrieval should help here.
- **It slips on negation.** "Tim Roth was not born on May 14th, 1961" is Supported in FEVER. The model stated the right date and gave the wrong label.
- **It says Supported to claims that FEVER marks unverifiable** (6 of 16 NEI), often by agreeing with a plausible sentence ("Steve Ditko was a comic cartoonist").

Full report: `eval/results/20261016-225821_no-rag_qwen3.5-9b_dev.md`. Comparison: `eval/results/compare-dev.md`.

## Reliability scorer

Stage 3 of the pipeline (feature 2 in the proposal, "source reliability flags"). For each Wikipedia revision used as evidence, it collects four signals and turns them into a `High`, `Medium` or `Low` badge with plain reasons. The entry point is `scoreEvidence(evidence)` in `src/reliability/index.ts`. It fills the existing `Reliability` field. `src/contract/claimCard.ts` is unchanged.

### Signals

| Signal | Where it comes from |
|---|---|
| Maintenance tags | Banners (POV, disputed, unreferenced, more citations, cleanup, current event) and inline tags ("citation needed", "failed verification", "dubious", "clarification needed"), read from the pinned revision with `action=parse&oldid=<rev>`, not from today's article |
| Edit activity | Age of the revision, whether it is the latest, pending review, edits and reverts in the 30 days up to As_Of. Only ids, timestamps and tags are requested. No user fields. |
| Revert risk | Wikimedia Lift Wing `revertrisk-language-agnostic`, the probability that the revision gets reverted |
| Citation coverage | Share of prose paragraphs (at least 200 characters, no lists, tables or templates) with at least one `<ref`, `{{sfn` or `{{harvnb` |

Any signal that cannot be measured is marked Unavailable with a short cause.

### Rule table

13 rules, in a fixed order:

- **Low:** revert risk at or above `revertRiskLow` (now 0.6, tuned on dev, was 0.7), or a POV, disputed or unreferenced banner.
- **Medium:** a more-citations, cleanup or current-event banner; 10 or more inline tags; revert risk at or above 0.4; latest edit under 24 hours old; pending review; 3 or more reverts in 30 days; under 50% of paragraphs cited.
- **High:** nothing fired. The reasons then say which checks passed.

Two or more Unavailable signals cap the badge at Medium. Every fired rule and every Unavailable signal adds one reason. Reasons are about the article or the revision, never about editors, and a word list check enforces this. The card badge is the worst badge among the evidence revisions, with at most 6 reasons.

### Fallbacks

- `scoreEvidence` never rejects. On any error it returns `Medium`, "Reliability could not be checked: <cause>", and `"reliability"` in `stubbed`.
- When Lift Wing gave no score for any revision on the card, `"revert-risk"` is added to `stubbed`.
- Each Wikimedia request has a 5 s timeout. Only successful responses are cached.
- `NOTECHECK_LIFTWING=off` turns Lift Wing off (cause "disabled").

### Lift Wing status

Working, live, not stubbed. Live smoke on 17 October 2026: Treaty of Versailles, revision 1378834026, came out `High` (no banners, 3 inline tags, revert risk 0.25, 96% of paragraphs cited). With `--liftwing off` it was still `High`, with the reason "Revert-risk score could not be checked: disabled" and `stubbed: ["revert-risk"]`.

### Pipeline integration

In `src/orchestrator/pipeline.ts`, `STUB_RELIABILITY` and its placeholder reason are gone. `checkOne` now calls `scoreEvidence(evidence)` and merges the returned `stubbed` list into the card. Nothing else in the file changed. This is Jonathan's folder, so it needs his approval in a PR. The typecheck passes, but the pipeline smoke has not been run end to end (see below).

## Reliability evaluation (dev split)

Data: English Wikipedia recent changes, fetched 2026-10-17T18:58:40Z. Two pools of 2000 edits each: reverted (tagged `mw-reverted`) and stable (7 to 30 days old, no revert tags). Seed 201, pool sha256 `31b90061ee90…`. Dev is 20 reverted and 20 stable (sha256 `0dbe65fd4da5…`). Test is 50 and 50 (sha256 `e07b2f5a6455…`). One revision per article. No user names or IPs are stored.

Caveat on the data: the feed comes newest first, so the stable pool filled up with edits just past the 7-day mark (about 7 days old in practice), and the reverted pool is from the last few hours.

Results on 40 dev revisions, 0 errors, Lift Wing answered for all 40. Citation coverage was Unavailable on 3 rows ("no prose paragraphs"). "Low" is the positive prediction and "was reverted" the positive label.

| System | Precision [95% range] | Recall [95% range] | F1 [95% range] | Flag rate | TP/FP/FN/TN |
|---|---|---|---|---|---|
| `flag-nothing` | 0.000 | 0.000 | 0.000 | 0.0% | 0/0/20/20 |
| `revert-risk-only` (0.7) | 0.923 [0.750, 1.000] | 0.600 [0.357, 0.813] | 0.727 [0.500, 0.875] | 32.5% | 12/1/8/19 |
| `scorer` (0.7) | 0.923 [0.750, 1.000] | 0.600 [0.357, 0.813] | 0.727 [0.500, 0.875] | 32.5% | 12/1/8/19 |
| `scorer`, tuned to 0.6 (in-sample) | 0.875 | 0.700 | 0.778 | 40.0% | 14/2/6/18 |

The scorer and revert-risk-only gave the same predictions. The tuner swept `revertRiskLow` from 0.30 to 0.95 on the saved signals, and 0.6 had the best F1. `DEFAULT_THRESHOLDS.revertRiskLow` was changed from 0.7 to 0.6.

The proposal target is precision and recall of at least 0.7. At 0.6 both reach 0.7 on dev, but these are the numbers the threshold was picked on, so they are not a held-out result. At 0.7, recall (0.600) misses. With 40 revisions all differences are inside the ranges, so this is weak evidence. The test split decides.

Reports: `eval/results/20261017-185921_reliability-flag-nothing_dev.md`, `20261017-185933_reliability-revert-risk-only_dev.md`, `20261017-190041_reliability-scorer_dev.md`, and the tuning table `tune-reliability-20261017-190041_reliability-scorer_dev.md`.

### Failure patterns

- **One false positive.** Marlene Belfort (revert risk 0.83) was flagged Low and not reverted.
- **Eight missed reverts** at 0.7. Five had revert risk under 0.4 and only the recent-edit rule fired. No article-level signal can catch an edit like that, because the article itself looks fine. The other three had moderate risk (0.43 to 0.67).
- **The article-level rules add nothing to the Low flag on dev.** Buni and WXMI had more-citations, cleanup or low-citations signals, but those rules only give Medium. The one unreferenced banner (a Low rule) was on Miles Gloriosus (play), which Lift Wing had already flagged (0.91). So in practice the scorer's Low flag is Lift Wing.
- **recent-edit fires on all 40.** The evaluation scores each edit as of its own save time, so every revision is "under 24 hours old". This is expected and only gives Medium, so it does not affect the Low flag.

## What was checked, and what was not

Checked:

- `npx tsc -p eval --noEmit` passes with no errors.
- The metric code was run on a seven-claim example worked out by hand. Macro-F1 0.6, accuracy 4 of 7, false-flag 1 of 3 and miss 1 of 2 all matched. Binary precision and recall matched on a four-row example.
- The `constant` system gave the expected floor (accuracy 34%, macro-F1 0.169) on the balanced set.
- The test-split guard refuses to run without `--final`.
- The `pipeline` and `minicheck` systems fail cleanly with a clear message when their parts are missing.
- A real no-RAG run on all 50 claims completed with 0 invalid outputs.
- Reliability tests: 80 of 80 pass across 11 files (7 in `src/reliability/`, 4 in `eval/harness/`). They include 16 fast-check properties at 100 runs each (rule table, monotonicity, no editor terms in reasons, no data from after As_Of, sampler balance and disjointness, and others). With `NOTECHECK_LIFTWING=off`, 72 pass and 8 are skipped.
- Retrieval tests still pass (28 of 28).
- `npx tsc --noEmit` only fails at the existing `src/mcp/smoke.ts:35` (Medapati's folder). `src/contract/claimCard.ts` is unchanged.
- The live reliability smoke (Treaty of Versailles) gave `High`, with Lift Wing on and off.
- The dev reliability round ran on all 40 revisions with 0 errors. The tuner reproduces every saved badge at the saved thresholds before sweeping.

Not checked:

- **`minicheck` has never run.** `bespoke-minicheck` is not installed, so the Yes/No prompt format, the answer parsing and the retrieval wiring are untested against the real model. The prompt follows Ollama's documented `Document:` / `Claim:` format.
- **`pipeline` has never run.** Jonathan's orchestrator now exists, but it exports `runFactCheckPipeline` from `src/orchestrator/pipeline.ts`. The adapter in `eval/harness/systems/pipeline.ts` still looks for `factCheck` in `src/orchestrator/index.ts`, so `--system pipeline` still stops with its "not ready" message.
- **Real badges on pipeline cards have not been seen end to end.** The orchestrator smoke stopped at claim extraction, because its default model `qwen3.5:4b` is not pulled on this machine (`qwen3.5:9b` is). The scorer itself was checked through its own smoke and the dev round.
- **`tuneMinicheck.ts` has never run.** It needs a saved minicheck dev run.
- **The 300-claim FEVER test set has never been run.** That is intentional.
- **The 100-revision reliability test set has never been run.** Also intentional, deferred until the final round.
- **No unit tests for the verdict harness.** The metric check above was a one-off command, not a saved test. The reliability code does have tests.
- **Results come from one run.** Temperature is 0 and the seed is fixed, but run-to-run variation was not measured. The very first call took 91 s because the model had to load. A warm-up call was added afterwards, so the 2.6 s median is a warm figure.
- **The FEVER sample was not hand-checked.** Labels come from FEVER as published.
- **The revision labels were not hand-checked.** `mw-reverted` misses reverts done by hand, and a stable edit can still be reverted later.
- **What Lift Wing uses inside its model was not checked.** NoteCheck only uses the revision-level probability and never shows or stores editor details.

## Run it

```
npm ci
npx tsx eval/scripts/prepareFever.ts
npx tsx eval/harness/run.ts --system constant:Supported
npx tsx eval/harness/run.ts --system no-rag
npx tsx eval/harness/run.ts --system minicheck         # after: ollama pull bespoke-minicheck
npx tsx eval/harness/run.ts --system pipeline          # after src/orchestrator/index.ts exports factCheck
npx tsx eval/harness/compare.ts eval/results/<a>.json eval/results/<b>.json
npx tsx eval/harness/tuneMinicheck.ts eval/results/<minicheck dev run>.json
npx tsc -p eval --noEmit
```

Ollama must be running with `qwen3.5:9b` (and `nomic-embed-text` for retrieval). Details are in `eval/README.md`.

Reliability (needs network access to Wikimedia, no Ollama):

```
npx tsx src/reliability/smoke.ts                       # live check on Treaty of Versailles
npx tsx src/reliability/smoke.ts --liftwing off
npx tsx eval/scripts/prepareRevisions.ts               # only to rebuild the datasets; the feed is live, so it gives new files
npx tsx eval/harness/reliabilityRun.ts --system flag-nothing
npx tsx eval/harness/reliabilityRun.ts --system revert-risk-only
npx tsx eval/harness/reliabilityRun.ts --system scorer
npx tsx eval/harness/tuneReliability.ts eval/results/<scorer dev run>.json
npx tsx eval/harness/reliabilityRun.ts --system <name> --split test --final   # once per system, at the end (default revertRiskLow is 0.6)
npx tsx --test src/reliability/tags.test.ts src/reliability/citations.test.ts src/reliability/history.test.ts src/reliability/combine.test.ts src/reliability/aggregate.test.ts src/reliability/signals.test.ts src/reliability/index.test.ts
npx tsx --test eval/harness/reliabilityDataset.test.ts eval/harness/revisionSampler.test.ts eval/harness/tuneReliability.test.ts eval/harness/reliabilityEval.test.ts
```

## Done

- Evaluation harness: loader, metrics, bootstrap ranges, paired comparison, reports, test-split guard
- FEVER dev (50) and test (300) samples, balanced and seeded
- Baselines: `constant`, `no-rag`
- `minicheck` baseline and its threshold tuner (written, not yet run)
- `pipeline` adapter (written, not yet run)
- First evaluation round on 50 FEVER claims, with failures documented
- Reliability scorer in `src/reliability/`: all four signals (maintenance tags, recent edits, Lift Wing revert risk, citation coverage), the rule table, card-level badge, fallbacks, tests
- Lift Wing call working live
- Pipeline change that replaces the placeholder badge (waiting on Jonathan's PR approval)
- Reliability datasets: 40 dev and 100 test revisions, balanced and seeded
- Reliability evaluation tooling: `flag-nothing`, `revert-risk-only` and `scorer` systems, run script, report, tuner
- Dev reliability round, threshold tuned (0.7 to 0.6), failures documented
- `eval/README.md`, two AI use log rows, `docs/STEVEN-STATUS.md`

## Not done yet

- **Reliability test run:** each of `flag-nothing`, `revert-risk-only` and `scorer` once with `--split test --final` (default `revertRiskLow` 0.6, or `--risk-low 0.6`). Deferred on purpose. Then record whether precision and recall reach 0.7.
- **Real badges end to end:** run the orchestrator smoke once `qwen3.5:4b` is pulled (or the default model is settled) and check the cards.
- **Design question:** should article-level rules be able to give Low? Right now only POV, disputed and unreferenced banners do. On dev the other article rules never changed a Low flag.
- **MiniCheck baseline run:** pull the model, run on dev, tune the threshold, then run on test once.
- **Pipeline run:** the adapter and Jonathan's export need to agree (`factCheck` in `index.ts`, or point the adapter at `runFactCheckPipeline`).
- **50 claims from our own notes** (`source: "notes"`), which is also the best check on FEVER contamination.
- **Spot check of Claude-generated claims** after Aadhavan's `tools/claim-generator` exists.
- **Evidence-quality rating:** two raters, 50 sampled verdicts, with agreement reported.
- **Judge check:** nothing stops a Qwen judge from marking Qwen yet, because there is no judge. Wire it in when one is added.
- **Final test run:** each verdict system once on the test split with `--final`, then the write-up.

## Needs from teammates

| Who | What | Why |
|---|---|---|
| Jonathan | Approve the PR for the reliability step in `src/orchestrator/pipeline.ts` | It is his folder. The diff only removes `STUB_RELIABILITY` and calls `scoreEvidence`. |
| Jonathan | Confirm the default model for the pipeline (`qwen3.5:4b` or `9b`) | The orchestrator smoke could not run here with 4b missing |
| Jonathan | Export `factCheck(req: FactCheckRequest): Promise<FactCheckResponse>` from `src/orchestrator/index.ts`, or agree that the adapter calls `runFactCheckPipeline` | Lets `--system pipeline` run |
| Jonathan | Share the verifier prompt from `src/llm/` | The no-RAG baseline should use the same prompt minus the evidence, so retrieval is the only difference. It currently uses its own prompt (`no-rag-v1`). |
| Group | Agree to `fast-check` 4.10.2 as a dev dependency | It changes the shared `package.json` and `package-lock.json` |
| Group | Add the `src/reliability` and `eval/harness` tests to `npm test`, and fix the glob so it works on Windows | `npm test` only covers `src/retrieval` today |
| Aadhavan | Agree on how `src/retrieval/testdata/claims.json` relates to `eval/datasets/` | His note asks to avoid two test sets. Retrieval claims have no verdict label yet. |
| Aadhavan | `tools/claim-generator` output in the dataset format (see `eval/README.md`) | Adds generated false claims, balanced against true ones |
| Medapati | Fix `src/mcp/smoke.ts:35` | It fails the root `npm run typecheck` (`t.description` is possibly undefined). It does not affect `eval/` or `src/reliability/`. |

## Known issues in other folders (not touched)

- `npm run typecheck` fails at `src/mcp/smoke.ts:35`, so it does not match the "0 errors" line in `MEDAPATI.md`. Only that one error showed up.
- `npm test` fails on Windows with "Could not find ...\*.test.ts", because the glob in the shared `package.json` is not expanded by the shell. Tests are run here by listing the files.

## Before committing

1. Work on a branch (this work is on `steven-eval`). Do not push to `main`.
2. Run the harness and the reliability tests once on your own machine and read the code. It was written by an AI.
3. Put the `src/orchestrator/pipeline.ts` change in its own commit and PR for Jonathan to approve.
4. Tell the group about `fast-check` in `package.json` and `package-lock.json` before merging.
5. `eval/results/` is gitignored (`.gitignore` line 235), so the dev run files (FEVER and reliability) will not be committed as things stand. Decide whether to un-ignore them. They are small and they are the record of the checkpoint round.
6. `.gitignore` also has an uncommitted change that ignores `.kiro/`, so the reliability spec will not be committed either. Decide whether the spec should be in git.
7. `eval/datasets/fever-*.jsonl` and `reliability-*.jsonl` are committed on purpose, so everyone scores the same items. The recent-changes feed is live, so the reliability files cannot be regenerated exactly.
8. The proposal PDF at the repo root (`project-proposal.pdf`) is gitignored and was not added by this work.
9. Adding npm scripts for the evaluator means editing the shared `package.json`. Tell the group first.
