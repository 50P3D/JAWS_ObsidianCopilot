# Jonathan's Checkpoint Status

**Member:** Jonathan Ho
**Components owned:** `src/llm/` (claim extraction, verification, model benchmarks) and `src/orchestrator/` (pipeline with retry)
**Last updated:** 17 October 2026
**Checkpoint date:** 18 October 2026

---

## 1. What was delivered

| File | Purpose | Status |
|---|---|---|
| `src/llm/ollama.ts` | One helper for every LLM call. Sends a prompt to Ollama and forces the reply into a JSON schema. | Working |
| `src/llm/extract.ts` | Stages 1 to 3: cleans the note (frontmatter, code, maths), splits it into atomic claims, drops uncheckable ones, rewrites each claim to stand alone. | Working |
| `src/llm/verify.ts` | Stage 6: labels each claim Supported, Refuted or Not Enough Info using only the retrieved passages, and suggests a fix when Refuted. | Working |
| `src/orchestrator/pipeline.ts` | Exports `runFactCheckPipeline(request, options)`. Runs extract, retrieval, reliability (stubbed) and verify for each claim. Rewrites the search and retries up to 2 times on Not Enough Info. | Working |
| `src/llm/extract.test.ts` | 8 unit tests for preprocessing (no LLM needed). | Passing |
| `src/llm/smokeExtract.ts`, `smokeVerify.ts`, `src/orchestrator/smoke.ts` | Smoke scripts that run real cases against the local model. | Working |

**AI technique in use:** RAG over Wikipedia (retrieved passages ground every verdict) and structured JSON output (Ollama schema-constrained decoding) for both LLM stages.

**Integration:** the function name and options match the TODO already in `src/plugin/main.ts`, so the plugin and the MCP `fact_check` tool can switch from mock cards to the real pipeline.

### Stubbed

| Part | Why | What the cards show |
|---|---|---|
| Reliability score | `src/reliability/` is not merged yet | Placeholder badge `Medium` with the reason "Placeholder: reliability scorer not connected yet", and `stubbed: ["reliability"]` |
| Wikimedia User-Agent from plugin settings | Retrieval reads `NOTECHECK_CONTACT` from its own config | The `userAgent` option is accepted but not used yet |

---

## 2. Test results (round 1)

### Claim extraction, 6 hand-written cases

| Case | qwen3.5:4b | qwen3.5:9b |
|---|---|---|
| Maths in the note | Partial fail: filled in the deleted formula from memory | Partial fail: kept a broken claim "The Pythagorean theorem states that ." |
| Code block in the note | Pass | Pass |
| Frontmatter and wikilinks | Pass | Pass |
| Pronoun resolved from the note title ("He" to Winston Churchill) | Pass | Pass |
| Wrong fact kept as written (Versailles 1920 not corrected) | Pass | Pass |
| Nothing checkable (opinion, reminder, question) | Pass (empty list) | Pass (empty list) |

9b split "Pythagoras, a Greek philosopher" into a separate claim, which is more atomic. Otherwise the two models gave the same results, so 4b is used during development for speed.

**Fix applied after this round:** code and maths are now replaced with `[code]` and `[formula]` placeholders instead of being deleted, and the prompt tells the model to skip claims that only concern a placeholder.

After the fix, 9b gives "The Pythagorean theorem states that [formula].": it no longer invents the formula, but still keeps a claim that is only about a placeholder. 4b has not been re-run after the fix.

### Verification

5 cases: the 3 shared example cards (Supported, Refuted, Not Enough Info), paraphrased evidence (Supported) and off-topic evidence (Not Enough Info). **5/5 correct on both qwen3.5:4b and 9b.** In the off-topic case the claim is true (Marie Curie won two Nobel Prizes) but the passage is about Pierre Curie, so both models correctly answered from the evidence rather than from memory.

### End-to-end pipeline, qwen3.5:9b

Input: "The Treaty of Versailles was signed in 1920. Albert Einstein was born in Ulm. The Eiffel Tower is in Berlin."

| Claim | Verdict | Correct? | Notes |
|---|---|---|---|
| Treaty of Versailles signed in 1920 | Refuted | Yes | Cited 28 June 1919 from a pinned revision. **No suggested fix was returned**, even though the explanation names 1919. |
| Albert Einstein born in Ulm | Supported | Yes | |
| Eiffel Tower is in Berlin | Refuted | Yes | Cited Champ de Mars, Paris |

Total time: 85.6 s for 3 claims on 9b. The 4b time has not been measured yet. No retries were needed.

### Failures found and fixed

1. **Empty model answers.** qwen3.5 is a thinking model. With JSON output forced, its answer came back empty. Fixed by sending `think: false`, which also made calls faster. An empty answer now raises a clear error.
2. **Prices deleted as maths.** "$5 and the pen cost $10" was treated as inline LaTeX and removed. Fixed with a stricter pattern, covered by a unit test.
3. **Holes left by deleted maths** (see the extraction table). Fixed with placeholders.

### Known open issues

- Claims that are only about a `[formula]` placeholder are still kept by 9b.
- Refuted verdicts sometimes come back without a suggested fix.
- Evidence can list the same article more than once (different passages). This is a display question for the plugin.
- 9b takes about 30 s per claim on this machine.

---

## 3. Progress against the proposal

| Proposal item | State |
|---|---|
| Claim extraction as structured JSON | Done |
| Decontextualisation | Done (in the same LLM call as extraction) |
| Verification with FEVER labels | Done |
| Orchestrator with retry on Not Enough Info | Done |
| Benchmark qwen3.5:9b against 4b early | Started: extraction compared on 6 cases. A larger FEVER comparison comes with the evaluation harness. |

### Changes since the proposal

- Extraction and decontextualisation are one LLM call instead of two, to halve the number of calls on a slow local model.
- `think: false` is required for qwen3.5 with structured output (see Failures, item 1).
