/**
 * Verification: a claim card with evidence in, the same card with a verdict out.
 * The model may only use the evidence passages, never its own memory,
 * so every verdict can be checked against a cited Wikipedia revision.
 */

import type { ClaimCard, Verdict } from "../contract/claimCard";
import { chatJson, DEFAULT_MODEL, type LlmOptions } from "./ollama";

const SYSTEM = `You check one claim against evidence passages from Wikipedia.

Rules:
- Use only the passages. Ignore anything you know from elsewhere.
- Supported: a passage clearly says the claim is true. Different wording is fine.
- Refuted: a passage clearly contradicts the claim, for example a different date, place or number.
- Not Enough Info: the passages do not settle it either way. When unsure, choose this.
- explanation: one or two plain sentences pointing to what the passage says.
- suggested_fix: only when Refuted, the claim rewritten to match the passage. Otherwise an empty string.`;

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["Supported", "Refuted", "Not Enough Info"] },
    explanation: { type: "string" },
    suggested_fix: { type: "string" },
  },
  required: ["verdict", "explanation", "suggested_fix"],
};

interface VerifyResult {
  verdict: Verdict;
  explanation: string;
  suggested_fix: string;
}

export async function verifyClaim(card: ClaimCard, opts: LlmOptions = {}): Promise<ClaimCard> {
  const evidence = card.evidence ?? [];
  const model = opts.model ?? DEFAULT_MODEL;

  // no evidence means nothing to judge, so skip the model call
  if (evidence.length === 0) {
    return { ...card, verdict: "Not Enough Info", explanation: "No relevant Wikipedia passage was found.", model_used: model };
  }

  const passages = evidence
    .map((e, i) => `[${i + 1}] ${e.page_title}${e.section ? ` (${e.section})` : ""}:\n${e.passage}`)
    .join("\n\n");
  const user = `Claim: ${card.claim}\n\nPassages:\n${passages}`;

  const out = await chatJson<VerifyResult>(SYSTEM, user, SCHEMA, opts);
  const fix = out.suggested_fix?.trim();

  // Return the original card with the verdict, explanation, suggested fix (if any), and model used
  return {
    ...card,
    verdict: out.verdict,
    explanation: out.explanation,
    suggested_fix: out.verdict === "Refuted" && fix ? fix : undefined,
    model_used: model,
  };
}