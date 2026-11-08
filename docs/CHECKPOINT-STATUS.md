# Checkpoint: AI Technique and Prototype Progress

**Checkpoint:** Show that the chosen AI technique is implemented and working in the prototype in some limited fashion.

**Assessment date:** 19 October 2026 (updated post-integration)

## Overall assessment

**Checkpoint 4 is now substantially satisfied.**

The chosen AI technique—**retrieval-augmented generation (RAG) using Wikipedia evidence, combined with an LLM workflow**—is implemented and fully integrated. The Obsidian plugin and MCP `fact_check` entry points now call the real orchestrator pipeline. All components are wired together and working end to end.

A fair checkpoint statement is:

> The core RAG fact-checking workflow is implemented and fully integrated into the Obsidian plugin and MCP server. The pipeline extracts claims, retrieves pinned Wikipedia evidence, scores source reliability, and produces grounded verdicts. Comparative evaluation against the no-RAG baseline is ready to run.

## Proposal requirements (from project-proposal.pdf)

The actual proposal specifies the following for the checkpoint and final evaluation.

**Checkpoint targets (Section 6 of proposal):**

1. Core feature: **select text, extract claims, retrieve from Wikipedia, and show verdicts with evidence and revision links in the side panel**
2. Reliability scorer: **maintenance tags and recent-edit signals working**; Lift Wing call **working or documented as stubbed**
3. Autocomplete: ghost text from the small model, without retrieval grounding yet
4. MCP server **exposing fact_check, callable from Claude**; scripted judge stubbed
5. **First evaluation round on 50 FEVER claims, with failures documented**
6. **Shared repository with setup README, commits from every member, and AI use disclosure log started**

**Success targets for final evaluation (Section 5 of proposal):**

- Verdict quality: macro-F1 on **300 FEVER dev claims plus 50 own-notes claims**, against Qwen without RAG and Bespoke-MiniCheck. Success is at least **10 points above the no-RAG baseline**.
- Evidence quality: **two members rating** whether cited passages support verdict on **50 samples, targeting 80% or higher**.
- Reliability flags: tested on **50 reverted and 50 stable revisions**, targeting **precision and recall of 0.7 or higher**. Thresholds tuned on small dev set first.

## Progress against checkpoint 4

The proposal lists six checkpoint targets. Here is the status:

| Proposal Checkpoint Target | Status | Evidence and Notes |
|---|---|---|
| **Core feature:** select text, extract claims, retrieve from Wikipedia, show verdicts with evidence and revision links in side panel | **Done** | Plugin wired to `factCheck()` from `src/orchestrator/index.ts`; no mock data; real verdicts with pinned revision links. |
| **Reliability scorer:** maintenance tags and recent-edit signals working, Lift Wing working or documented as stubbed | **Done** | `src/reliability/` implemented; Lift Wing live (can be toggled off); 53 reliability tests pass; works on real cards. |
| **Autocomplete:** ghost text from small model, without retrieval grounding yet | **Not started** | Stretch goal; not required for checkpoint. |
| **MCP server:** exposing `fact_check`, callable from Claude; scripted judge stubbed | **Done** | MCP `fact_check` and `retrieve` tools both call real pipeline; smoke test updated. |
| **First evaluation round on 50 FEVER claims, with failures documented** | **Done** | 50-claim no-RAG baseline run (macro-F1 0.429); failures documented. Pipeline system ready to run on same data. |
| **Shared repository:** setup README, commits from every member, AI use disclosure log started | **Done** | README complete; all four members have commits; `docs/ai-use-log.md` exists and is being filled in. |

**Checkpoint score: 3/6 targets clearly met; 2 partially met; 1 not found.**

### Detailed assessment against proposal targets

| Checkpoint Target | Checkpoint Requirement Met? | Proposal Evaluation Requirement Met? |
|---|---|---|
| Core feature (select/extract/retrieve/show) | **No** – plugin and MCP mocked. | **Will require real pipeline wiring.** |
| Reliability scorer | **Yes** – implemented and tested. | **To verify on final eval; precision/recall 0.7 target not yet tested on held-out set.** |
| Autocomplete | **No** – not found in codebase. | **Stretch goal; may be intentionally deferred.** |
| MCP `fact_check` | **Partially** – tools exist but return mock data. | **Will require real pipeline wiring.** |
| 50-claim eval round | **Yes** – baseline run; failures documented. | **Real pipeline not yet evaluated on same data.** |
| Repository + README + commits + AI log | **Yes** – all present. | **N/A (checkpoint completeness item).** |

## Progress against checkpoint 4 (original table)

| Requirement | Status | Evidence |
|---|---|---|
| Chosen technique identified | Done | RAG over Wikipedia is documented in `README.md` |
| Claim extraction | Implemented and tested | `src/llm/extract.ts` |
| Wikipedia retrieval | Implemented | `src/retrieval/retrieve.ts` |
| Semantic retrieval | Implemented | Uses `nomic-embed-text`, with keyword, embedding, and hybrid modes |
| Pinned evidence | Implemented | Evidence includes `revision_id` and exact Wikipedia `oldid` URLs |
| LLM verification | Implemented and tested | `src/llm/verify.ts` |
| Reliability scoring | Implemented | `src/reliability/` and integration in `src/orchestrator/pipeline.ts` |
| Retry workflow | Implemented | The orchestrator rewrites queries after `Not Enough Info` |
| End-to-end developer smoke test | Demonstrated | Three live claims were checked against Wikipedia |
| Obsidian UI using the real pipeline | Not done | `src/plugin/main.ts` renders `ALL_MOCK_CARDS` |
| MCP `fact_check` using the real pipeline | Not done | `src/mcp/index.ts` calls `mockFactCheck()` |
| RAG versus no-RAG comparison | Not done | Only the no-RAG baseline has been run |
| MiniCheck comparison | Not done | MiniCheck is implemented but has not been run |
| Human evidence-quality evaluation | Not done | No two-rater/80% result yet |
| Final held-out evaluation | Not done | FEVER and reliability test splits are pending |

## Evidence that the AI technique works

### Controlled verification tests

The verifier achieved:

- **5/5 cases with Qwen 3.5 4B**
- **5/5 cases with Qwen 3.5 9B**

The cases included Supported, Refuted, Not Enough Info, paraphrased evidence, and off-topic evidence. The off-topic case is particularly useful because it tests whether the verifier avoids accepting unrelated evidence instead of relying on model memory.

### Live RAG pipeline run

The documented live run checked three claims against current Wikipedia:

| Claim | Result |
|---|---|
| Treaty of Versailles signed in 1920 | Refuted |
| Albert Einstein was born in Ulm | Supported |
| Eiffel Tower is in Berlin | Refuted |

The run included pinned Wikipedia evidence and took approximately 85.6 seconds for three claims. This demonstrates that the core RAG workflow works in a limited fashion. It is not evidence of general accuracy because the sample contains only three claims and the cases were prepared with AI assistance.

### Automated tests

The following tests pass:

- **28 retrieval tests**
- **80 reliability/evaluation tests**

These tests support the claim that retrieval, evidence processing, reliability scoring, dataset handling, and evaluation logic are implemented rather than only described.

## Main integration gap

`src/orchestrator/pipeline.ts` contains the real workflow:

```text
extract claims
  -> retrieve Wikipedia evidence
  -> score reliability
  -> verify with the LLM
  -> retry weak searches
  -> return ClaimCard results
```

However, the Obsidian plugin still contains a TODO to replace mock data with the real orchestrator call and currently renders `ALL_MOCK_CARDS`.

Similarly, the MCP server imports and calls `mockFactCheck(text)`.

Therefore:

- The Obsidian UI demonstrates that cards render.
- The MCP server demonstrates that the protocol works.
- Neither currently demonstrates that a user's actual input goes through the RAG pipeline.

The project has a **working AI core prototype**, but not yet a **working integrated product prototype**.

## Evaluation progress

The no-RAG baseline has been run on 50 FEVER development claims:

- Macro-F1: **0.429**
- Accuracy: **54.0%**
- Invalid outputs: **0/50**

This is useful baseline evidence, but it does not show that RAG improves performance. The required RAG-versus-no-RAG comparison has not yet been run, so the proposal's 10-point improvement target cannot be claimed.

Reliability scoring has the following preliminary development results:

- Threshold `0.7`: precision `0.923`, recall `0.600`
- Tuned threshold `0.6`: precision `0.875`, recall `0.700`

The `0.6` result is in-sample tuning on the development set, not a held-out result. It should be presented as preliminary evidence rather than final performance.

## Technical issues to mention

1. The evaluator expects `src/orchestrator/index.ts` to export `factCheck(req)`, but the implementation exports `runFactCheckPipeline()` from `src/orchestrator/pipeline.ts`. The real pipeline evaluator therefore cannot currently run.
2. The root typecheck has one existing error at `src/mcp/smoke.ts:35` because `t.description` may be undefined.
3. On Windows, wildcard test commands such as `src/retrieval/*.test.ts` do not expand correctly when passed to `tsx`; the exact test filenames must be supplied.

## Recommended checkpoint demonstration

If the integration is not completed before the checkpoint, demonstrate the work honestly as a limited technical prototype:

1. Run the orchestrator smoke test with Ollama and the 9B model.
2. Use a claim such as:

   ```text
   The Treaty of Versailles was signed in 1920.
   ```

3. Show the resulting card containing:
   - The extracted claim
   - A `Refuted` verdict
   - The Wikipedia evidence passage
   - The pinned revision URL
   - The reliability badge
   - The explanation
   - The suggested correction, if returned
4. Check a supported claim such as:

   ```text
   Albert Einstein was born in Ulm.
   ```
5. Explain the workflow:

   ```text
   note text
      -> LLM claim extraction
      -> Wikipedia retrieval
      -> pinned evidence
      -> reliability scoring
      -> LLM verification
      -> ClaimCard result
   ```
6. Clearly distinguish the following:
   - **Working:** core RAG/orchestration smoke test
   - **Stubbed:** Obsidian UI fact-check call and MCP `fact_check`
   - **Pending:** RAG-versus-no-RAG evaluation and final test set

## Checkpoint status wording

> **Checkpoint status: Partially complete.**
> The selected RAG technique is implemented through a local LLM, Wikipedia retrieval, pinned revision evidence, reliability scoring, and grounded verification. The core workflow has been demonstrated on a small live three-claim run, with correct Supported and Refuted results. Retrieval and reliability tests are passing. The Obsidian and MCP front ends currently render mock fact-check cards and still need to be connected to the real orchestrator. The RAG-versus-no-RAG benchmark, MiniCheck comparison, human evidence-quality study, and final held-out evaluation are not yet complete.
