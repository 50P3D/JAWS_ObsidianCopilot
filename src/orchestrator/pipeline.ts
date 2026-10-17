/**
 * Orchestrator: runs the NoteCheck stages in order for one fact-check request.
 *
 *   1. extract claims      (src/llm/extract.ts)
 *   2. retrieve evidence   (src/retrieval/retrieve.ts)
 *   3. score reliability   (stubbed until src/reliability/ is ready)
 *   4. verify              (src/llm/verify.ts)
 *
 * When a claim comes back Not Enough Info, the search is rewritten and tried again,
 * up to maxRetries more times.
 */

import type { ClaimCard, FactCheckRequest, FactCheckResponse, Reliability } from "../contract/claimCard";
import { extractClaims } from "../llm/extract";
import { chatJson, type LlmOptions } from "../llm/ollama";
import { verifyClaim } from "../llm/verify";
import { retrieveEvidence } from "../retrieval/retrieve";

export interface PipelineOptions {
  ollamaUrl?: string;
  model?: string;
  /** Wikimedia contact string. Not used yet: retrieval reads NOTECHECK_CONTACT from its own config. */
  userAgent?: string;
  /** Extra search attempts when a claim is Not Enough Info. The README plan says 2. */
  maxRetries?: number;
  /** Progress messages, for the smoke script or a loading message in the plugin. */
  log?: (msg: string) => void;
}

/** Placeholder until the reliability scorer is merged. Cards say so in `stubbed`. */
const STUB_RELIABILITY: Reliability = {
  badge: "Medium",
  reasons: ["Placeholder: reliability scorer not connected yet"],
};

const REWRITE_SYSTEM = `You write Wikipedia search queries. Given a claim and the queries already tried, write one new short query (2 to 6 words) that is more likely to find the Wikipedia article that confirms or denies the claim. Use the main article's likely title where you can.`;

const REWRITE_SCHEMA = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };

async function rewriteQuery(claim: string, tried: string[], llm: LlmOptions): Promise<string> {
  const user = `Claim: ${claim}\nAlready tried:\n${tried.map((q) => `- ${q}`).join("\n")}`;
  const out = await chatJson<{ query: string }>(REWRITE_SYSTEM, user, REWRITE_SCHEMA, llm);
  return out.query?.trim() ?? "";
}

/** Retrieve, score and verify one claim, retrying the search while the verdict is Not Enough Info. */
async function checkOne(card: ClaimCard, llm: LlmOptions, maxRetries: number, log: (m: string) => void): Promise<ClaimCard> {
  const tried: string[] = [];
  let first: ClaimCard | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const query = attempt === 0 ? card.claim : await rewriteQuery(card.claim, tried, llm);
    if (!query || tried.includes(query)) break; // nothing new to try
    tried.push(query);
    log(`${card.claim_id}: searching "${query}"`);

    const evidence = await retrieveEvidence(query);
    const checked = await verifyClaim(
      { ...card, evidence, reliability: STUB_RELIABILITY, stubbed: ["reliability"] },
      llm,
    );
    first ??= checked;
    if (checked.verdict !== "Not Enough Info") return checked;
  }

  // every attempt was Not Enough Info: keep the first, whose evidence was searched with the claim itself
  return first ?? { ...card, verdict: "Not Enough Info", explanation: "No search could be run for this claim." };
}

export async function runFactCheckPipeline(request: FactCheckRequest, opts: PipelineOptions = {}): Promise<FactCheckResponse> {
  const llm: LlmOptions = { ollamaUrl: opts.ollamaUrl, model: opts.model };
  const maxRetries = opts.maxRetries ?? 2;
  const log = opts.log ?? (() => {});

  const claims = await extractClaims(request, llm);
  log(`extracted ${claims.length} claim(s)`);

  const cards: ClaimCard[] = [];
  // one claim at a time, so the local model is not asked to do several things at once
  for (const claim of claims) {
    try {
      cards.push(await checkOne(claim, llm, maxRetries, log));
    } catch (err) {
      // one failed claim (for example Wikipedia not answering) should not lose the others
      const msg = err instanceof Error ? err.message : String(err);
      cards.push({ ...claim, verdict: "Not Enough Info", explanation: `Could not check this claim: ${msg}` });
    }
  }
  return { cards };
}
