/**
 * Baseline: the app's Wikipedia retrieval (src/retrieval plus the query-rewrite retries from
 * src/orchestrator/pipeline.ts) with Bespoke-MiniCheck as the verifier instead of the app's
 * chat-model verifier. See ../appRetrieval.ts for what is and is not copied from the app.
 *
 * MiniCheck is a grounded fact-checking model. Given a document and a claim it answers
 * only "Yes" (the document supports the claim) or "No". It has no third label, so each
 * search attempt maps to:
 *
 *   no passages found                    -> Not Enough Info
 *   Yes                                  -> Supported
 *   No, and the best passage scored >= t -> Refuted          (good evidence, still not supported)
 *   No, and the best passage scored <  t -> Not Enough Info  (we probably found the wrong text)
 *
 * t is the --nei-threshold. Like the app, the answer is the first attempt that is not
 * Not Enough Info, or the first attempt if all of them are.
 *
 * Offline tuning: which attempts the app would run depends on t. So this system keeps
 * searching after every "No" (any score) and stops at the first "Yes", up to --retries
 * extra searches. That records every attempt the app could need at any threshold, and
 * appVerdict() replays the app's loop on them. eval/harness/tuneMinicheck.ts re-scores a
 * saved run this way without calling any model. Because of the extra searches, the run's
 * latency is an upper bound; extra.app_ms is the time the app's loop would have taken.
 *
 * --retries 0 gives the old single-search baseline.
 *
 * Needs: ollama pull bespoke-minicheck, nomic-embed-text (unless --retrieval-mode keyword)
 * and the rewrite model (qwen3.5:9b by default, unless --retries 0).
 */

import type { Evidence } from "../../../src/contract/claimCard";
import type { Mode } from "../../../src/retrieval/retrieve";
import { enableCache } from "../../../src/retrieval/wikipedia";
import { searchLikeApp } from "../appRetrieval";
import { chat, checkModel, modelFamily } from "../ollama";
import type { EvalItem, Verdict } from "../types";
import { clip, type System } from "./types";

export interface MiniCheckOptions {
  model?: string;
  retrievalMode?: Mode;
  top?: number;
  neiThreshold?: number;
  /** Extra searches after the first, as the app's maxRetries. Default 3. */
  retries?: number;
  /** Chat model that rewrites the search query. Default qwen3.5:9b, the plugin default. */
  rewriteModel?: string;
}

/** One search as saved in a run file's `extra.attempts`. */
export interface MiniCheckAttempt {
  query: string;
  yes: boolean | null;
  best_score: number;
  n_evidence: number;
  ms: number;
}

/** Pure mapping, shared with the threshold tuner. */
export function minicheckVerdict(yes: boolean | null, bestScore: number, threshold: number): Verdict | null {
  if (yes === null) return null;
  if (yes) return "Supported";
  return bestScore >= threshold ? "Refuted" : "Not Enough Info";
}

export function attemptVerdict(a: Pick<MiniCheckAttempt, "yes" | "best_score" | "n_evidence">, threshold: number): Verdict | null {
  if (a.n_evidence === 0) return "Not Enough Info";
  return minicheckVerdict(a.yes, a.best_score, threshold);
}

/**
 * Replay the app's loop: the first attempt that is not Not Enough Info wins, otherwise the
 * first attempt (searched with the claim itself). Returns the index of the chosen attempt,
 * or -1 when there are no attempts.
 */
export function appAttemptIndex(attempts: MiniCheckAttempt[], threshold: number): number {
  if (attempts.length === 0) return -1;
  const i = attempts.findIndex((a) => attemptVerdict(a, threshold) !== "Not Enough Info");
  return i === -1 ? 0 : i;
}

export function appVerdict(attempts: MiniCheckAttempt[], threshold: number): Verdict | null {
  const i = appAttemptIndex(attempts, threshold);
  return i === -1 ? "Not Enough Info" : attemptVerdict(attempts[i], threshold);
}

export function parseYesNo(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (/^yes\b/.test(t)) return true;
  if (/^no\b/.test(t)) return false;
  return null;
}

export function minicheckSystem(opts: MiniCheckOptions = {}): System {
  const model = opts.model ?? "bespoke-minicheck";
  const retrievalMode = opts.retrievalMode ?? "hybrid";
  const top = opts.top ?? 3;
  const neiThreshold = opts.neiThreshold ?? 0.5;
  const retries = opts.retries ?? 3;
  const rewriteModel = opts.rewriteModel ?? "qwen3.5:9b";

  const askMiniCheck = async (claim: string, evidence: Evidence[]) => {
    const bestScore = evidence.reduce((m, e) => Math.max(m, e.retrieval_score ?? 0), 0);
    if (evidence.length === 0) return { yes: false as boolean | null, bestScore: 0, raw: "(no evidence retrieved)" };
    const document = evidence.map((e) => `${e.page_title}: ${e.passage}`).join("\n\n");
    const res = await chat({
      model,
      messages: [{ role: "user", content: `Document: ${document}\nClaim: ${claim}` }],
      numPredict: 5,
    });
    return { yes: parseYesNo(res.content), bestScore, raw: res.content };
  };

  return {
    info: {
      name: "minicheck",
      model,
      family: "bespoke-minicheck",
      config: {
        retrieval: "app (src/retrieval + query-rewrite retries)",
        retrieval_mode: retrievalMode,
        top,
        nei_threshold: neiThreshold,
        retries,
        ...(retries > 0 ? { rewrite_model: rewriteModel, rewrite_family: modelFamily(rewriteModel) } : {}),
        retry_rule: "search again after every No, stop at the first Yes; verdict replays the app loop",
        temperature: 0,
      },
    },
    async setup() {
      enableCache();
      const problem = await checkModel(model);
      if (problem) return problem;
      if (retrievalMode !== "keyword") {
        const embedProblem = await checkModel("nomic-embed-text");
        if (embedProblem) return embedProblem;
      }
      if (retries > 0) {
        const rewriteProblem = await checkModel(rewriteModel);
        if (rewriteProblem) return `${rewriteProblem} (used to rewrite searches; --retries 0 skips it)`;
      }
      // Load the model before the timed loop, so the first claim's latency is not a cold start.
      await chat({ model, messages: [{ role: "user", content: "Document: The sky is blue.\nClaim: The sky is blue." }], numPredict: 2, timeoutMs: 300_000 });
      return null;
    },
    async check(item: EvalItem) {
      const searches = await searchLikeApp(
        item.claim,
        (evidence) => askMiniCheck(item.claim, evidence),
        // keep going after any No (or no passages), so every threshold can be replayed offline
        (r, evidence) => evidence.length === 0 || r.yes === false,
        { maxRetries: retries, llm: { model: rewriteModel }, retrieve: { mode: retrievalMode, top } },
      );

      const attempts: MiniCheckAttempt[] = searches.map((s) => ({
        query: s.query,
        yes: s.evidence.length === 0 ? false : s.result.yes,
        best_score: s.result.bestScore,
        n_evidence: s.evidence.length,
        ms: s.ms,
      }));
      const chosen = appAttemptIndex(attempts, neiThreshold);
      const used = chosen === -1 ? undefined : searches[chosen];
      const appMs = attempts.slice(0, chosen + 1).reduce((n, a) => n + a.ms, 0);

      return {
        verdict: appVerdict(attempts, neiThreshold),
        evidence: used?.evidence ?? [],
        raw: used ? clip(used.result.raw) : "(no search could be run)",
        extra: {
          // first attempt kept under the old names, so older tooling still reads it
          yes: attempts[0]?.yes ?? false,
          best_score: attempts[0]?.best_score ?? 0,
          attempts,
          chosen_attempt: chosen,
          app_ms: appMs,
        },
      };
    },
  };
}
