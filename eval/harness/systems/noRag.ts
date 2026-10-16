/**
 * Baseline: the same local model, with no Wikipedia evidence. It answers from what it
 * remembers. The proposal's success target is the pipeline beating this by 10 macro-F1 points.
 *
 * Fair comparison: once Jonathan's verifier prompt exists in src/llm/, this baseline should
 * use that prompt with the evidence block removed, so the only difference is retrieval.
 * Until then it uses NO_RAG_PROMPT below. Bump PROMPT_VERSION whenever the prompt changes,
 * because it is recorded in every run file.
 *
 * Caveat: FEVER (2017) is very likely in the model's training data, so this baseline may
 * look better than it would on fresh claims. See eval/README.md.
 */

import { findLabelInText, normaliseLabel } from "../labels";
import { chat, checkModel, modelFamily } from "../ollama";
import type { EvalItem } from "../types";
import { clip, type System } from "./types";

export const PROMPT_VERSION = "no-rag-v1";

export const NO_RAG_PROMPT = `You are a careful fact-checker. You will be given one claim and no other evidence.
Using only your own knowledge, label the claim:
- "Supported" if you are confident the claim is true.
- "Refuted" if you are confident the claim is false.
- "Not Enough Info" if you cannot tell whether it is true or false.
Do not guess. Reply with JSON only: {"verdict": "...", "explanation": "one short sentence"}`;

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["Supported", "Refuted", "Not Enough Info"] },
    explanation: { type: "string" },
  },
  required: ["verdict", "explanation"],
};

export interface NoRagOptions {
  model?: string;
  think?: boolean;
}

export function noRagSystem(opts: NoRagOptions = {}): System {
  const model = opts.model ?? "qwen3.5:9b";
  const think = opts.think ?? false;
  return {
    info: {
      name: "no-rag",
      model,
      family: modelFamily(model),
      config: { prompt_version: PROMPT_VERSION, think, temperature: 0, seed: 201 },
    },
    async setup() {
      const problem = await checkModel(model);
      if (problem) return problem;
      // Load the model before the timed loop, so the first claim's latency is not a cold start.
      await chat({ model, think, messages: [{ role: "user", content: "Reply with OK." }], numPredict: 2, timeoutMs: 300_000 });
      return null;
    },
    async check(item: EvalItem) {
      const res = await chat({
        model,
        think,
        format: SCHEMA,
        messages: [
          { role: "system", content: NO_RAG_PROMPT },
          { role: "user", content: `Claim: ${item.claim}` },
        ],
      });
      let verdict = null;
      let explanation: string | undefined;
      try {
        const parsed = JSON.parse(res.content);
        verdict = normaliseLabel(parsed.verdict);
        explanation = typeof parsed.explanation === "string" ? parsed.explanation : undefined;
      } catch {
        verdict = findLabelInText(res.content);
      }
      return { verdict, explanation, raw: clip(res.content) };
    },
  };
}
