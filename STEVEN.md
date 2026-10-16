# NATHANAEL.md: Nathanael's progress log

Area: **evaluation harness and baselines** (`eval/`). The reliability scorer (`src/reliability/`) is also Nathanael's and has **not been started**.
Branch: not created yet. All work below is uncommitted on `main`.
Last updated: 17 October 2026.

## AI disclaimer

The code, datasets and documentation in `eval/` were written by **Kiro** (an AI coding assistant built from AWS leveragin models such as Anthropic/Claude), working inside Nathanael's repo. No other AI provider was used.

Nathanael directed the work and asked for the evaluator first, with a plan based on the repo and the proposal PDF. Kiro read the repo and the proposal, wrote the files, ran the commands and reported the results. This covers:

- everything under `eval/` (harness, scripts, README, the two dataset files, the saved run results)
- one row added to `docs/ai-use-log.md`
- this file

Nathanael has not yet reviewed the code line by line or run it on his own machine. Do that before committing. (Testing and review will be done by next commits)

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

## What was checked, and what was not

Checked:

- `npx tsc -p eval --noEmit` passes with no errors.
- The metric code was run on a seven-claim example worked out by hand. Macro-F1 0.6, accuracy 4 of 7, false-flag 1 of 3 and miss 1 of 2 all matched. Binary precision and recall matched on a four-row example.
- The `constant` system gave the expected floor (accuracy 34%, macro-F1 0.169) on the balanced set.
- The test-split guard refuses to run without `--final`.
- The `pipeline` and `minicheck` systems fail cleanly with a clear message when their parts are missing.
- A real no-RAG run on all 50 claims completed with 0 invalid outputs.

Not checked:

- **`minicheck` has never run.** `bespoke-minicheck` is not installed, so the Yes/No prompt format, the answer parsing and the retrieval wiring are untested against the real model. The prompt follows Ollama's documented `Document:` / `Claim:` format.
- **`pipeline` has never run.** There is no `src/orchestrator/` yet.
- **`tuneMinicheck.ts` has never run.** It needs a saved minicheck dev run.
- **The 300-claim test set has never been run.** That is intentional.
- **No unit tests were written for the harness.** The metric check above was a one-off command, not a saved test. The user did not ask for tests, so none were added.
- **Results come from one run.** Temperature is 0 and the seed is fixed, but run-to-run variation was not measured. The very first call took 91 s because the model had to load. A warm-up call was added afterwards, so the 2.6 s median is a warm figure.
- **The FEVER sample was not hand-checked.** Labels come from FEVER as published.

## Run it

```
npm ci
npx tsx eval/scripts/prepareFever.ts
npx tsx eval/harness/run.ts --system constant:Supported
npx tsx eval/harness/run.ts --system no-rag
npx tsx eval/harness/run.ts --system minicheck         # after: ollama pull bespoke-minicheck
npx tsx eval/harness/run.ts --system pipeline          # after src/orchestrator/ exports factCheck
npx tsx eval/harness/compare.ts eval/results/<a>.json eval/results/<b>.json
npx tsx eval/harness/tuneMinicheck.ts eval/results/<minicheck dev run>.json
npx tsc -p eval --noEmit
```

Ollama must be running with `qwen3.5:9b` (and `nomic-embed-text` for retrieval). Details are in `eval/README.md`.

## Done

- Evaluation harness: loader, metrics, bootstrap ranges, paired comparison, reports, test-split guard
- FEVER dev (50) and test (300) samples, balanced and seeded
- Baselines: `constant`, `no-rag`
- `minicheck` baseline and its threshold tuner (written, not yet run)
- `pipeline` adapter (written, waiting on the orchestrator)
- First evaluation round on 50 FEVER claims, with failures documented
- `eval/README.md` and an AI use log row

## Not done yet

- **Reliability scorer** (`src/reliability/`): maintenance tags, recent unreviewed edits, Lift Wing revert risk, citation coverage. Nothing is written. The checkpoint asks for tags and recent-edit signals working, and the Lift Wing call working or documented as stubbed.
- **Reliability evaluation:** 50 reverted and 50 stable revisions, with a "flag nothing" baseline. `binaryMetrics` is ready but nothing feeds it.
- **MiniCheck baseline run:** pull the model, run on dev, tune the threshold, then run on test once.
- **Pipeline run:** needs Jonathan's orchestrator.
- **50 claims from our own notes** (`source: "notes"`), which is also the best check on FEVER contamination.
- **Spot check of Claude-generated claims** after Aadhavan's `tools/claim-generator` exists.
- **Evidence-quality rating:** two raters, 50 sampled verdicts, with agreement reported.
- **Judge check:** nothing stops a Qwen judge from marking Qwen yet, because there is no judge. Wire it in when one is added.
- **Final test run:** each system once on the test split with `--final`, then the write-up.

## Needs from teammates

| Who | What | Why |
|---|---|---|
| Jonathan | Export `factCheck(req: FactCheckRequest): Promise<FactCheckResponse>` from `src/orchestrator/index.ts` | Lets `--system pipeline` run |
| Jonathan | Share the verifier prompt from `src/llm/` | The no-RAG baseline should use the same prompt minus the evidence, so retrieval is the only difference. It currently uses its own prompt (`no-rag-v1`). |
| Aadhavan | Agree on how `src/retrieval/testdata/claims.json` relates to `eval/datasets/` | His note asks to avoid two test sets. Retrieval claims have no verdict label yet. |
| Aadhavan | `tools/claim-generator` output in the dataset format (see `eval/README.md`) | Adds generated false claims, balanced against true ones |
| Medapati | Nothing blocking | `src/mcp/smoke.ts:35` fails the root `npm run typecheck` (`t.description` is possibly undefined). It does not affect `eval/`. |

## Known issues in other folders (not touched)

- `npm run typecheck` fails at `src/mcp/smoke.ts:35`, so it does not match the "0 errors" line in `MEDAPATI.md`. Only that one error showed up.
- `npm test` fails on Windows with "Could not find ...\*.test.ts", because the glob in the shared `package.json` is not expanded by the shell. The retrieval tests were therefore not re-run here.

## Before committing

1. Create a branch, for example `nathanael/eval-harness`. Do not push to `main`.
2. Run the harness once on your own machine and read the code. It was written by an AI.
3. Decide whether `eval/results/*.json` should be committed. They are small (about 50 rows each) and document the checkpoint round. Raw FEVER is gitignored.
4. `eval/datasets/fever-dev.jsonl` and `fever-test.jsonl` are committed on purpose, so everyone scores the same claims.
5. `Group 8 Project Proposal.pdf` is untracked at the repo root and was not added by this work. Decide whether it belongs in git.
6. Adding npm scripts for the evaluator means editing the shared `package.json`. Tell the group first.
