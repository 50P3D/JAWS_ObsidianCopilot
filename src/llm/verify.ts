/**
 * Verification: a claim card with evidence in, the same card with a verdict out.
 * The model may only use the evidence passages, never its own memory,
 * so every verdict can be checked against a cited Wikipedia revision.
 */

import type { ClaimCard, Verdict } from "../contract/claimCard";
import { chatJson, DEFAULT_MODEL, type LlmOptions } from "./ollama";

// Missing is not false: on the FEVER dev set the old prompt ("prefer Supported or Refuted based
// on the closest match") made qwen3.5:9b call 14 of 16 unverifiable claims Refuted, often while
// writing that the passages "never mention" the fact. See eval/README.md.
const SYSTEM = `You check one claim against evidence passages from Wikipedia or the student's course materials.

Rules:
- Use only the passages. Ignore anything you know from elsewhere.
- Judge the claim exactly as written, including words like "not", "never", "only", "all" and "exactly". If the claim says "X was not born in 1961" and a passage says X was born in 1961, the claim is Refuted. If a passage says X was born in 1958, the claim is Supported.
- Supported: a passage says the claim is true. Different wording is fine.
- Refuted: a passage says something that cannot be true at the same time as the claim, for example a different date, place or number, or a different person in the same role.
- Not Enough Info: the passages do not say whether the claim is true. A passage about the right subject that never mentions the specific fact is Not Enough Info, not Refuted. A fact being missing from the passages does not make the claim false.
- explanation: write this first. One or two plain sentences: what the passages say about the claim, and for Refuted the passage text that conflicts with it. If no passage text conflicts with the claim, the verdict cannot be Refuted.
- suggested_fix: only when Refuted, the claim rewritten to match the passage. Otherwise an empty string.`;

// explanation comes before verdict, so the model states what the passages say before it decides
const SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    verdict: { type: "string", enum: ["Supported", "Refuted", "Not Enough Info"] },
    suggested_fix: { type: "string" },
  },
  required: ["explanation", "verdict", "suggested_fix"],
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