/**
 * Baseline: our retrieval (src/retrieval) + Bespoke-MiniCheck as the verifier.
 *
 * MiniCheck is a grounded fact-checking model. Given a document and a claim it answers
 * only "Yes" (the document supports the claim) or "No". It has no third label, so we map:
 *
 *   Yes                                  -> Supported
 *   No, and the best passage scored >= t -> Refuted          (good evidence, still not supported)
 *   No, and the best passage scored <  t -> Not Enough Info  (we probably found the wrong text)
 *
 * t is the --nei-threshold. Tune it on the dev split with eval/harness/tuneMinicheck.ts,
 * which re-scores a saved run without calling any model. The raw Yes/No and the best
 * retrieval score are kept in each prediction's `extra` for that reason.
 *
 * Needs: ollama pull bespoke-minicheck   (and nomic-embed-text unless --retrieval-mode keyword)
 */

import { retrieveEvidence, type Mode } from "../../../src/retrieval/retrieve";
import { enableCache } from "../../../src/retrieval/wikipedia";
import { chat, checkModel } from "../ollama";
import type { EvalItem, Verdict } from "../types";
import { clip, type System } from "./types";

export interface MiniCheckOptions {
  model?: string;
  retrievalMode?: Mode;
  top?: number;
  neiThreshold?: number;
}

/** Pure mapping, shared with the threshold tuner. */
export function minicheckVerdict(yes: boolean | null, bestScore: number, threshold: number): Verdict | null {
  if (yes === null) return null;
  if (yes) return "Supported";
  return bestScore >= threshold ? "Refuted" : "Not Enough Info";
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

  return {
    info: {
      name: "minicheck",
      model,
      family: "bespoke-minicheck",
      config: { retrieval_mode: retrievalMode, top, nei_threshold: neiThreshold, temperature: 0 },
    },
    async setup() {
      enableCache();
      const problem = await checkModel(model);
      if (problem) return problem;
      if (retrievalMode !== "keyword") {
        const embedProblem = await checkModel("nomic-embed-text");
        if (embedProblem) return embedProblem;
      }
      // Load the model before the timed loop, so the first claim's latency is not a cold start.
      await chat({ model, messages: [{ role: "user", content: "Document: The sky is blue.\nClaim: The sky is blue." }], numPredict: 2, timeoutMs: 300_000 });
      return null;
    },
    async check(item: EvalItem) {
      const evidence = await retrieveEvidence(item.claim, { mode: retrievalMode, top });
      const bestScore = evidence.reduce((m, e) => Math.max(m, e.retrieval_score ?? 0), 0);
      if (evidence.length === 0) {
        return { verdict: "Not Enough Info", evidence, raw: "(no evidence retrieved)", extra: { yes: false, best_score: 0 } };
      }
      const document = evidence.map((e) => `${e.page_title}: ${e.passage}`).join("\n\n");
      const res = await chat({
        model,
        messages: [{ role: "user", content: `Document: ${document}\nClaim: ${item.claim}` }],
        numPredict: 5,
      });
      const yes = parseYesNo(res.content);
      return {
        verdict: minicheckVerdict(yes, bestScore, neiThreshold),
        evidence,
        raw: clip(res.content),
        extra: { yes, best_score: bestScore },
      };
    },
  };
}
