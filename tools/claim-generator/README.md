# tools/claim-generator

Makes the `source: "generated"` part of the evaluation set: true Wikipedia facts rewritten by Claude as believable false claims. It answers two points from the proposal feedback: FEVER may be contaminated (models have seen it), and we need test data with plenty of false claims.

## Files

| File | What it is |
|---|---|
| `seeds.jsonl` | 50 true facts, each with the Wikipedia page that states it |
| `generate.ts` | Asks Claude to rewrite each seed as one false claim, writes `eval/datasets/generated.jsonl` |
| `../../eval/datasets/generated.jsonl` | The output: 50 claims, all `Refuted`, 20 dev and 30 test |

Each output line looks like this:

```json
{"id":"gen-027","claim":"Singapore became an independent country in 1963.","label":"Refuted","source":"generated","split":"dev","evidence_pages":["Singapore"],"original_fact":"Singapore became an independent country in 1965.","rationale":"1963 is when Singapore joined Malaysia; it separated and became independent on 9 August 1965.","human_checked":false,"note":"mutation: date"}
```

## How the claims are made

- One detail changes per claim: a date (17), a place (15), a person or thing (10), a number (4) or an attribute (4). Everything else stays true, so the verifier has to find the specific error.
- The wrong value is a believable one (Kilimanjaro in Kenya, Napoleon dying on Elba, Einstein's Nobel for relativity), not an absurd one.
- Every claim is false according to the page in `evidence_pages`, so the gold label is `Refuted`, not `Not Enough Info`.
- Claude writes the data and Qwen is the system under test, so no model marks its own family's work.

## Run it

Score the pipeline on the generated claims (dev only while tuning):

```
npx tsx eval/harness/run.ts --system pipeline --dataset eval/datasets/generated.jsonl
npx tsx eval/harness/run.ts --system no-rag   --dataset eval/datasets/generated.jsonl
```

Every gold label is `Refuted`, so read **miss rate** (false claims not called Refuted) and Refuted recall, not macro-F1.

Regenerate or extend (needs `npm i -D @anthropic-ai/sdk` and `ANTHROPIC_API_KEY`):

```
npx tsx tools/claim-generator/generate.ts                   # overwrites eval/datasets/generated.jsonl
npx tsx tools/claim-generator/generate.ts --with-originals  # 100 items: each false claim plus its true original as Supported
```

`--with-originals` gives a balanced set, so the report can also show the false-flag rate (true claims called Refuted).

## Before the numbers count

The starter file was written by Claude from general knowledge. Spot-check it (the eval plan's phase 2): open each `evidence_pages` article, confirm `original_fact` is true and `claim` is false, then set `human_checked` to `true`. Fix or drop any item that fails, and record the count checked in the report.
