# JONATHAN.md: Jonathan Ho's progress log

Branch: `jon`. Area: LLM stages (`src/llm/`) and the orchestrator (`src/orchestrator/`).
Last updated: 17 October 2026.

## AI disclaimer

The code, tests and documentation in this branch were drafted with **Claude** (Anthropic), in a Claude chat project with access to this repository folder. No other AI provider was used.

Jonathan directed the work, typed or reviewed each file, ran every test on his own machine, saved the results in `src/llm/benchmarks/` and decided which fixes to keep. In more detail:

- `src/llm/ollama.ts`: Claude drafted it and Jonathan typed it in. Claude then found two bugs (wrong API path, wrong model name) and added `think: false` after Jonathan's test returned an empty answer.
- `src/llm/extract.ts` and `src/llm/verify.ts`: drafted by Claude. Claude later changed preprocessing in `extract.ts` to use placeholders after Jonathan's test runs showed the problem.
- `src/llm/extract.test.ts`, `src/orchestrator/pipeline.ts` and `src/orchestrator/smoke.ts`: written into the folder by Claude.
- The smoke test cases were written by Claude. The results and notes in `src/llm/benchmarks/` are Jonathan's own runs.

This is also recorded in `docs/ai-use-log.md`.

## What the code does

The job: take the text a user selects in a note and return one claim card per checkable fact, with a verdict.

1. **Clean the note** (`extract.ts`, plain code). Remove frontmatter. Replace code with `[code]` and maths with `[formula]`, so sentences are not left with holes. Keep the text of wikilinks. Leave prices like "$5" alone.
2. **Extract claims** (`extract.ts`, one LLM call). Split the text into one fact per claim, drop opinions, reminders and questions, and rewrite each claim so it makes sense alone ("He" becomes "Winston Churchill", using the note title and headings). The model must not correct or add facts.
3. **Retrieve evidence** (Aadhavan's `src/retrieval/`). Search Wikipedia for the claim and return ranked passages from pinned revisions.
4. **Reliability** (stubbed). Every card gets a placeholder `Medium` badge and `stubbed: ["reliability"]` until Nathanael's scorer is merged.
5. **Verify** (`verify.ts`, one LLM call). Label the claim Supported, Refuted or Not Enough Info **using only the passages**, never the model's own memory, and suggest a fix when Refuted.
6. **Retry** (`pipeline.ts`). On Not Enough Info, the model writes a new short search query and the claim is searched and verified again, up to 2 more times.

Every LLM call goes through `ollama.ts`, which forces the reply into a JSON schema, uses temperature 0 and turns off qwen3.5's thinking mode.

`runFactCheckPipeline(request, options)` is the entry point. Its name and options match the TODO in `src/plugin/main.ts`.

## Results so far

All runs are on Jonathan's machine with Ollama. Raw output is in `src/llm/benchmarks/`.

### Extraction: 6 hand-written cases

| Case | qwen3.5:4b | qwen3.5:9b |
|---|---|---|
| Maths in the note | Fail: filled in the deleted formula from its own memory | Fail: kept a broken claim "The Pythagorean theorem states that ." |
| Code block | Pass | Pass |
| Frontmatter and wikilinks | Pass | Pass |
| "He" resolved from the note title | Pass | Pass |
| Wrong fact kept as written (1920) | Pass | Pass |
| Nothing checkable | Pass (empty) | Pass (empty) |

After the placeholder fix, 9b gives "The Pythagorean theorem states that [formula]." It no longer invents the formula, but it still keeps a claim that is only about a placeholder, even though the prompt says to skip those. 4b has not been re-run after the fix.

### Verification: 5 cases with given evidence

| Case | Expected | 4b | 9b |
|---|---|---|---|
| Shared example: Pluto reclassified in 2006 | Supported | Pass | Pass |
| Shared example: Versailles signed in 1920 | Refuted | Pass | Pass |
| Shared example: Marie Curie's favourite colour | Not Enough Info | Pass | Pass |
| Paraphrased evidence (water boils at 100 °C) | Supported | Pass | Pass |
| Off-topic evidence (Marie Curie's Nobel Prizes, passage about Pierre Curie) | Not Enough Info | Pass | Pass |

5/5 on both models. The off-topic case matters most: a model answering from memory would say Supported.

### End to end: 3 claims, live Wikipedia, qwen3.5:9b

| Claim | Verdict | Correct |
|---|---|---|
| The Treaty of Versailles was signed in 1920. | Refuted (cites 28 June 1919) | Yes, but no suggested fix was returned |
| Albert Einstein was born in Ulm. | Supported | Yes |
| The Eiffel Tower is in Berlin. | Refuted (cites Champ de Mars, Paris) | Yes |

Total time: 85.6 s for 3 claims, about 30 s per claim. No retries were needed.

How to read this:

- The pipeline works end to end, and every verdict links to a pinned Wikipedia revision.
- Both models are equally good on these small sets, so 4b is used while developing because it is faster.
- These sets are tiny and the cases were written by Claude, so the numbers show the stages work, not how accurate they are.

### Failures found and fixed

1. **Empty answers.** qwen3.5 thinks before answering by default, and with JSON output forced the answer came back empty. Fixed with `think: false`. An empty answer now gives a clear error.
2. **Prices removed as maths.** "$5 and the pen cost $10" was treated as inline LaTeX. Fixed with a stricter pattern and a unit test.
3. **Holes left by removed maths.** Both models misbehaved when the formula was deleted. Fixed with `[formula]` and `[code]` placeholders (partly: see above).

## Run it

From the repo root, with Ollama running and `qwen3.5:4b` pulled:

```
npm install
npx tsx --test src/llm/extract.test.ts
npx tsx src/llm/smokeExtract.ts
npx tsx src/llm/smokeVerify.ts
npx tsx src/orchestrator/smoke.ts
```

To use the larger model in PowerShell: `$env:OLLAMA_MODEL="qwen3.5:9b"`. The end-to-end smoke test also needs internet access for Wikipedia.

## Done

- Ollama JSON helper
- Preprocessing, claim extraction and decontextualisation
- Verification with FEVER labels and suggested fixes
- Orchestrator with retry on Not Enough Info, matching the plugin's expected call
- Unit tests for preprocessing, smoke tests for each stage, first 4b vs 9b comparison

## Not done yet

- Claims that are only about a `[formula]` or `[code]` placeholder are still kept
- Refuted verdicts sometimes have no suggested fix
- Speed: about 30 s per claim on 9b; 4b end-to-end time not measured yet
- Reliability is stubbed until `src/reliability/` is merged
- The plugin's Wikimedia User-Agent setting is not passed to retrieval yet
- A larger benchmark on FEVER claims with Nathanael's evaluation harness
- Medapati to swap the mock data in `src/plugin/main.ts` and `src/mcp/index.ts` for `runFactCheckPipeline`
