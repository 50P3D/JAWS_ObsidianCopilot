/**
 * Wikipedia retrieval the way the app does it, for baselines that bring their own verifier.
 *
 * Mirrors the Wikipedia loop in checkOne (src/orchestrator/pipeline.ts):
 *
 *   attempt 0:     retrieveEvidence(claim)
 *   attempt 1..N:  the chat model rewrites the search query (rewriteQuery, the app's prompt),
 *                  then retrieveEvidence(rewritten query)
 *
 * The app retries while the verdict is Not Enough Info and stops when a query is empty or
 * was already tried. Here the caller decides when to keep going (`keepGoing`), so a baseline
 * can search further than the app would and work out the app's answer afterwards (see
 * minicheck.ts, which does this so the NEI threshold can still be tuned offline).
 *
 * Not copied from the app: claim extraction (FEVER claims are already single, standalone
 * claims) and reliability scoring (badges do not change the verdict). The `pipeline` system
 * runs the whole app, including both.
 */

import type { Evidence } from "../../src/contract/claimCard";
import type { LlmOptions } from "../../src/llm/ollama";
import { rewriteQuery } from "../../src/orchestrator/pipeline";
import { retrieveEvidence, type RetrieveOptions } from "../../src/retrieval/retrieve";

export interface SearchAttempt<T> {
  query: string;
  evidence: Evidence[];
  result: T;
  /** Rewrite plus retrieval plus verification for this attempt. */
  ms: number;
}

export interface AppSearchOptions {
  /** Extra searches after the first. The app uses 3 (PipelineOptions.maxRetries default). */
  maxRetries: number;
  /** Chat model that rewrites the query. The app uses the plugin's model setting. */
  llm: LlmOptions;
  /** Passed to retrieveEvidence. The app passes nothing, so empty means "as in the app". */
  retrieve?: Omit<RetrieveOptions, "log">;
}

export async function searchLikeApp<T>(
  claim: string,
  verify: (evidence: Evidence[]) => Promise<T>,
  keepGoing: (result: T, evidence: Evidence[]) => boolean,
  opts: AppSearchOptions,
): Promise<SearchAttempt<T>[]> {
  const tried: string[] = [];
  const attempts: SearchAttempt<T>[] = [];
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const t0 = performance.now();
    const query = attempt === 0 ? claim : await rewriteQuery(claim, tried, opts.llm);
    if (!query || tried.includes(query)) break; // nothing new to try, as in the app
    tried.push(query);
    const evidence = await retrieveEvidence(query, opts.retrieve ?? {});
    const result = await verify(evidence);
    attempts.push({ query, evidence, result, ms: Math.round(performance.now() - t0) });
    if (!keepGoing(result, evidence)) break;
  }
  return attempts;
}
