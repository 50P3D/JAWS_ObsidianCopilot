/**
 * The system under test: the real NoteCheck pipeline (Jonathan's orchestrator).
 *
 * The harness expects this export:
 *
 *   // src/orchestrator/index.ts
 *   export async function factCheck(req: FactCheckRequest, opts?: PipelineOptions): Promise<FactCheckResponse>
 *
 * Types come from src/contract/claimCard.ts, so nothing new needs agreeing.
 * The module is loaded at run time, so the eval code type-checks before it lands.
 *
 * One test claim can come back as several cards if extraction splits it. We combine them
 * the way a reader would: any Refuted card makes the claim Refuted, all Supported makes it
 * Supported, anything else is Not Enough Info.
 */

import type { ClaimCard, FactCheckRequest, FactCheckResponse } from "../../../src/contract/claimCard";
import type { PipelineOptions } from "../../../src/orchestrator/index";
import { modelFamily } from "../ollama";
import type { EvalItem, Verdict } from "../types";
import type { System } from "./types";

const ORCHESTRATOR = "../../../src/orchestrator/index";

type FactCheck = (req: FactCheckRequest, opts?: PipelineOptions) => Promise<FactCheckResponse>;

export function combineCards(cards: ClaimCard[]): Verdict | null {
  const verdicts = cards.map((c) => c.verdict).filter((v): v is Verdict => !!v);
  if (verdicts.length === 0) return null;
  if (verdicts.includes("Refuted")) return "Refuted";
  if (verdicts.every((v) => v === "Supported")) return "Supported";
  return "Not Enough Info";
}

/**
 * Bump when the app's verifier prompt, extraction fallback or query building changes, so run
 * files say which version produced them.
 *   1: first pipeline round (verifier preferred Supported/Refuted on partial matches)
 *   2: missing-is-not-false verifier, negation rule, explanation before verdict,
 *      extraction fallback, subject and bracket-title search queries
 */
export const PIPELINE_VERSION = 2;

export function pipelineSystem(opts: { model?: string; think?: boolean } = {}): System {
  let factCheck: FactCheck | null = null;
  const model = opts.model ?? "qwen3.5:9b";
  const think = opts.think ?? false;

  return {
    info: {
      name: "pipeline",
      model,
      family: modelFamily(model),
      config: { orchestrator: "src/orchestrator/index.ts", pipeline_version: PIPELINE_VERSION, verifier_think: think, fallback_to_text: true },
    },
    async setup() {
      try {
        const mod: any = await import(ORCHESTRATOR);
        if (typeof mod.factCheck !== "function") {
          return "src/orchestrator/index.ts loaded but has no exported factCheck(req) function.";
        }
        factCheck = mod.factCheck;
        return null;
      } catch {
        return (
          "The pipeline is not ready: src/orchestrator/index.ts with an exported factCheck(req) was not found. " +
          "Run a baseline (no-rag, minicheck, constant:Supported) until the orchestrator lands."
        );
      }
    },
    async check(item: EvalItem) {
      if (!factCheck) throw new Error("pipeline.setup() was not run");
      // fallbackToText as in the plugin's selection command: each test claim is one selected sentence
      const res = await factCheck({ text: item.claim }, { model, fallbackToText: true, verifierThink: think });
      const cards = res.cards ?? [];
      const models = [...new Set(cards.map((c) => c.model_used).filter(Boolean))];
      const stubbed = [...new Set(cards.flatMap((c) => c.stubbed ?? []))];
      return {
        verdict: combineCards(cards),
        explanation: cards.map((c) => c.explanation).filter(Boolean).join(" | ") || undefined,
        evidence: cards.flatMap((c) => c.evidence ?? []),
        extra: { cards: cards.length, models_used: models, stubbed },
      };
    },
  };
}
