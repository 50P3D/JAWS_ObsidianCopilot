# eval: evaluation harness and baselines

Owner: Nathanael. Scores fact-check verdicts against labelled claims, compares the pipeline with baselines and keeps the test set honest.

## Quick start

From the repo root, with Ollama running:

```
npx tsx eval/scripts/prepareFever.ts                      # download FEVER dev, write balanced dev/test samples
npx tsx eval/harness/run.ts --system constant:Supported   # floor, no model needed (checks the harness)
npx tsx eval/harness/run.ts --system no-rag               # qwen3.5:9b with no evidence
npx tsx eval/harness/run.ts --system minicheck            # our retrieval + Bespoke-MiniCheck
npx tsx eval/harness/run.ts --system pipeline             # the real pipeline (stubbed until src/orchestrator/ lands)
npx tsx eval/harness/compare.ts eval/results/<a>.json eval/results/<b>.json
npx tsc -p eval --noEmit                                  # typecheck the harness
```

Each run writes `eval/results/<run_id>.json` (every prediction) and `<run_id>.md` (metrics, confusion matrix, every failure, caveats).

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

## Systems

| Name | What it is | Why |
|---|---|---|
| `constant:<label>` | Always one label | Floor. On balanced data, macro-F1 is about 0.17 |
| `no-rag` | `qwen3.5:9b`, claim only, JSON output, temperature 0, thinking off | Proposal baseline. The pipeline must beat it by 10 macro-F1 points |
| `minicheck` | `src/retrieval` top 3 passages + `bespoke-minicheck` | Proposal baseline. MiniCheck only answers Yes or No, so No becomes Refuted if the best passage scores at least `--nei-threshold`, otherwise NEI |
| `pipeline` | `factCheck(req)` from `src/orchestrator/index.ts` | System under test. Multiple cards per claim combine as any Refuted, then Refuted; all Supported, then Supported; anything else, NEI |

`minicheck` needs `ollama pull bespoke-minicheck` (a 7B model, several GB). `pipeline` needs Jonathan to export this from `src/orchestrator/index.ts`:

```ts
export async function factCheck(req: FactCheckRequest): Promise<FactCheckResponse>
```

For a fair no-RAG comparison, `no-rag` should use the verifier's prompt with the evidence removed, once that prompt exists in `src/llm/`. Change `NO_RAG_PROMPT` and bump `PROMPT_VERSION` in `harness/systems/noRag.ts`.

## Metrics

- **Macro-F1** over the labels present in the gold data (headline, as in the proposal). Unparseable outputs count as wrong.
- **Per-label precision, recall and F1**, plus a confusion matrix.
- **False-flag rate**: share of true (Supported) claims called Refuted. **Miss rate**: share of false (Refuted) claims not called Refuted. The instructor asked for both.
- **95% intervals** from 2000 seeded bootstrap resamples. `compare.ts` uses a paired bootstrap, so both systems are scored on the same resampled claims.
- Reports also show a **Supported and Refuted only** section, because FEVER's NEI label is unreliable (see below).
- `binaryMetrics` (precision and recall of Low badges against reverted revisions) is ready for the reliability evaluation.

## Rules that keep the numbers honest

- **Tune on dev, test once.** `--split test` refuses to run without `--final`, and every test run is appended to `results/TEST_RUNS.md`. More than one row per system means we peeked.
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
- **Negation.** "Tim Roth was not born on May 14th, 1961" is true in FEVER. The model gave the right fact and the wrong label.

Not run yet: `minicheck` (model not pulled), `pipeline` (orchestrator not built).

## Plan

| Phase | Work | State |
|---|---|---|
| 1 | Verdict harness, FEVER dev/test, `no-rag` and `constant` baselines, first round on 50 claims | Done |
| 1 | `minicheck` baseline | Built, not run (needs `bespoke-minicheck`) |
| 1 | `pipeline` adapter | Built, stubbed until `src/orchestrator/` exports `factCheck` |
| 2 | 50 claims from our own notes (`source: "notes"`) | Todo, needs the team's notes |
| 2 | Spot check of Claude-generated claims (`source: "generated"`, `human_checked`) | Todo, after Aadhavan's `tools/claim-generator` |
| 2 | Evidence-quality sheet for two raters, 50 sampled verdicts, with agreement (Cohen's kappa) | Todo |
| 3 | Reliability scorer in `src/reliability/`, evaluated on 50 reverted and 50 stable revisions against "flag nothing" | Todo |
| 4 | Final: tune on dev, run each system once on test with `--final`, write up | Todo |

## Dataset format

One JSON object per line. Lines starting with `//` are comments.

```json
{"id": "notes-001", "claim": "...", "label": "Supported", "source": "notes", "split": "dev"}
```

`label` is `Supported`, `Refuted` or `Not Enough Info`. `source` is `fever`, `notes` or `generated`. `split` is `dev` or `test`. Optional fields: `evidence_pages`, `original_fact`, `rationale`, `human_checked`, `note`.

FEVER (Thorne et al., 2018) is licensed CC BY-SA 3.0.
