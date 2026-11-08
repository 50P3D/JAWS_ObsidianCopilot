/**
 * Orchestrator: runs the NoteCheck stages in order for one fact-check request.
 *
 *   1. extract claims      (src/llm/extract.ts)
 *   2. retrieve evidence   (src/retrieval/retrieve.ts)
 *   3. score reliability   (src/reliability/)
 *   4. verify              (src/llm/verify.ts)
 *
 * When a claim comes back Not Enough Info, the search is rewritten and tried again,
 * up to maxRetries more times.
 *
 * With a course index (opts.course), each claim is first checked against the user's course
 * materials. Wikipedia is only searched when the course has no close passage or its passages
 * give Not Enough Info, unless opts.course.only is set.
 */

import type { ClaimCard, Evidence, FactCheckRequest, FactCheckResponse } from "../contract/claimCard";
import { extractClaims } from "../llm/extract";
import { chatJson, type LlmOptions } from "../llm/ollama";
import { verifyClaim } from "../llm/verify";
import { mergeStubbed, scoreEvidence } from "../reliability";
import { retrieveEvidence } from "../retrieval/retrieve";
import { configureRetrieval } from "../retrieval/config";
import { configureReliability } from "../reliability/config";

export interface PipelineOptions {
  ollamaUrl?: string;
  model?: string;
  /** Wikimedia contact string. Passed to retrieval and reliability. */
  userAgent?: string;
  /** Extra search attempts when a claim is Not Enough Info. The README plan says 2. */
  maxRetries?: number;
  /** Progress messages, for the smoke script or a loading message in the plugin. */
  log?: (msg: string) => void;
  /** Abort signal for cancellation (e.g., live check debounce). */
  signal?: AbortSignal;
  /** The user's course materials, searched before Wikipedia. See src/course/. */
  course?: CourseSource;
}

export interface CourseSource {
  /** Course passages for a claim, best first. Empty when the course does not cover it. */
  search: (claim: string) => Promise<Evidence[]>;
  /** Never fall back to Wikipedia. */
  only?: boolean;
}

const REWRITE_SYSTEM = `You write Wikipedia search queries. Given a claim and the queries already tried, write one new short query (2 to 6 words) that is more likely to find the Wikipedia article that confirms or denies the claim. Use the main article's likely title where you can.`;

const REWRITE_SCHEMA = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };

async function rewriteQuery(claim: string, tried: string[], llm: LlmOptions): Promise<string> {
  const user = `Claim: ${claim}\nAlready tried:\n${tried.map((q) => `- ${q}`).join("\n")}`;
  const out = await chatJson<{ query: string }>(REWRITE_SYSTEM, user, REWRITE_SCHEMA, llm);
  return out.query?.trim() ?? "";
}

/** Retrieve, score and verify one claim, retrying the search while the verdict is Not Enough Info. */
async function checkOne(
  card: ClaimCard,
  llm: LlmOptions,
  maxRetries: number,
  log: (m: string) => void,
  signal?: AbortSignal,
  course?: CourseSource,
): Promise<ClaimCard> {
  const tried: string[] = [];
  let first: ClaimCard | undefined;

  if (course) {
    const evidence = await course.search(card.claim);
    log(`${card.claim_id}: ${evidence.length} course passage(s)`);
    if (evidence.length > 0) {
      // course passages are the user's own material, so there is no Wikipedia reliability badge to score
      const checked = await verifyClaim({ ...card, evidence }, llm);
      if (checked.verdict !== "Not Enough Info" || course.only) return checked;
      first = checked;
    } else if (course.only) {
      return { ...card, evidence: [], verdict: "Not Enough Info", explanation: "Your course materials do not cover this claim." };
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for abort
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const query = attempt === 0 ? card.claim : await rewriteQuery(card.claim, tried, llm);
    if (!query || tried.includes(query)) break; // nothing new to try
    tried.push(query);
    log(`${card.claim_id}: searching "${query}"`);

    const evidence = await retrieveEvidence(query);
    const rel = await scoreEvidence(evidence);
    const checked = await verifyClaim(
      { ...card, evidence, reliability: rel.reliability, stubbed: mergeStubbed(card.stubbed, rel.stubbed) },
      llm,
    );
    first ??= checked;
    if (checked.verdict !== "Not Enough Info") return checked;
  }

  // every attempt was Not Enough Info: keep the first, whose evidence was searched with the claim itself
  return first ?? { ...card, verdict: "Not Enough Info", explanation: "No search could be run for this claim." };
}

export async function runFactCheckPipeline(request: FactCheckRequest, opts: PipelineOptions = {}): Promise<FactCheckResponse> {
  // Apply runtime config so plugin settings reach retrieval and reliability
  configureRetrieval({ ollamaUrl: opts.ollamaUrl, userAgent: opts.userAgent });
  configureReliability({ userAgent: opts.userAgent });

  const llm: LlmOptions = { ollamaUrl: opts.ollamaUrl, model: opts.model };
  const maxRetries = opts.maxRetries ?? 3; // Increased from 2 to 3 for better coverage
  const log = opts.log ?? (() => {});

  const claims = await extractClaims(request, llm, { courseClaims: opts.course !== undefined });
  log(`extracted ${claims.length} claim(s)`);

  const cards: ClaimCard[] = [];
  // one claim at a time, so the local model is not asked to do several things at once
  for (const claim of claims) {
    try {
      cards.push(await checkOne(claim, llm, maxRetries, log, opts.signal, opts.course));
    } catch (err) {
      // one failed claim (for example Wikipedia not answering) should not lose the others
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "Aborted") throw err; // Re-throw abort to cancel entire pipeline
      cards.push({ ...claim, verdict: "Not Enough Info", explanation: `Could not check this claim: ${msg}` });
    }
  }
  return { cards };
}
