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
import { extractClaims, preprocess } from "../llm/extract";
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
  /** Maximum claims checked at once. Keep at 1 for a single local Ollama model. */
  parallelClaims?: number;
  /** Retrieval tuning for latency-sensitive clients. */
  retrieval?: { pages?: number; candidates?: number; mode?: "keyword" | "embedding" | "hybrid" };
  /** Additional subject labels, such as the course folder containing the note. */
  topicContext?: string[];
  /** Use keyword-only course search for responsive live checking. */
  fast?: boolean;
  /** Do not call Wikipedia when local course evidence is inconclusive. */
  localOnly?: boolean;
  /** Skip extraction when the caller already supplied one complete claim per line. */
  directClaims?: boolean;
  /** Progress messages, for the smoke script or a loading message in the plugin. */
  log?: (msg: string) => void;
  /** Abort signal for cancellation (e.g., live check debounce). */
  signal?: AbortSignal;
  /** The user's course materials, searched before Wikipedia. See src/course/. */
  course?: CourseSource;
  /**
   * When extraction finds no claims in a single short sentence, check that sentence as it is.
   * For callers where the user asked about exactly this text (the selection command, the
   * evaluation). Off by default, because the live checker sends whole paragraphs, where
   * "no checkable claims" is often the right answer.
   */
  fallbackToText?: boolean;
  /** Let the model reason before each verdict (qwen3.x thinking mode). Slower. Off by default. */
  verifierThink?: boolean;
}

/** Longest text the fallback will check as one claim. */
const FALLBACK_MAX_CHARS = 300;

/**
 * The text as a single claim card, or null when it is not one short sentence.
 * Used when extraction returns nothing, as it did for "Dakota Fanning models." on the dev set.
 */
export function wholeTextClaim(text: string): ClaimCard | null {
  const claim = preprocess(text).replace(/\s+/g, " ").trim();
  if (!claim || claim.length > FALLBACK_MAX_CHARS) return null;
  // more than one sentence means extraction had real text to work with and found nothing checkable
  if (/[.!?]\s+\S/.test(claim)) return null;
  if (/\?\s*$/.test(claim) || claim.includes("[code]") || claim.includes("[formula]")) return null;
  const original = text.trim();
  const start = text.indexOf(original);
  return { claim_id: "c1", original_text: original, claim, source_span: { start, end: start + original.length } };
}

export interface CourseSource {
  /** Course passages for a claim, best first. Empty when the course does not cover it. */
  search: (claim: string, context?: CourseQueryContext) => Promise<Evidence[]>;
  /** Never fall back to Wikipedia. */
  only?: boolean;
}

export interface CourseQueryContext {
  noteTitle?: string;
  headings?: string[];
  topics?: string[];
  fast?: boolean;
}

const REWRITE_SYSTEM = `You write Wikipedia search queries. Given a claim and the queries already tried, write one new short query (2 to 6 words) that is more likely to find the Wikipedia article that confirms or denies the claim. Use the main article's likely title where you can.`;

const REWRITE_SCHEMA = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };

/** Exported so the evaluation harness (eval/harness/appRetrieval.ts) searches exactly as the app does. */
export async function rewriteQuery(claim: string, tried: string[], llm: LlmOptions): Promise<string> {
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
  retrieval: PipelineOptions["retrieval"] = {},
  context?: CourseQueryContext,
  localOnly = false,
  verifyLlm: LlmOptions = llm,
): Promise<ClaimCard> {
  const tried: string[] = [];
  let wikipediaResult: ClaimCard | undefined;
  const topic = [
    ...(context?.topics ?? []),
    context?.noteTitle,
    ...(context?.headings ?? []),
  ].filter(Boolean).join(" > ");

  if (course) {
    const evidence = await course.search(card.claim, context);
    log(`${card.claim_id}: ${evidence.length} course passage(s)`);
    if (evidence.length > 0) {
      // course passages are the user's own material, so there is no Wikipedia reliability badge to score
      const checked = await verifyClaim({ ...card, evidence }, verifyLlm, { topic });
      if (checked.verdict !== "Not Enough Info" || course.only || localOnly) return checked;
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

    const evidence = await retrieveEvidence(query, {
      pages: retrieval.pages,
      candidates: retrieval.candidates,
      mode: retrieval.mode,
    });
    const rel = await scoreEvidence(evidence);
    const checked = await verifyClaim(
      { ...card, evidence, reliability: rel.reliability, stubbed: mergeStubbed(card.stubbed, rel.stubbed) },
      verifyLlm,
      { topic },
    );
    wikipediaResult = checked;
    if (checked.verdict !== "Not Enough Info") return checked;
  }

  // Do not return an inconclusive course passage after Wikipedia has been tried.
  return wikipediaResult ?? { ...card, verdict: "Not Enough Info", explanation: "No search could be run for this claim." };
}

export async function runFactCheckPipeline(request: FactCheckRequest, opts: PipelineOptions = {}): Promise<FactCheckResponse> {
  // Apply runtime config so plugin settings reach retrieval and reliability
  configureRetrieval({ ollamaUrl: opts.ollamaUrl, userAgent: opts.userAgent });
  configureReliability({ userAgent: opts.userAgent });

  const llm: LlmOptions = { ollamaUrl: opts.ollamaUrl, model: opts.model };
  // Thinking applies only to verdicts. Extraction and query rewrites stay fast.
  const verifyLlm: LlmOptions = opts.verifierThink ? { ...llm, think: true } : llm;
  const maxRetries = opts.maxRetries ?? 1;
  const pipelineRetrieval = opts.retrieval ?? { pages: 2, candidates: 24, mode: "hybrid" as const };
  const log = opts.log ?? (() => {});

  let claims = opts.directClaims
    ? request.text.split(/\r?\n/).map((text, i) => ({
        claim_id: `c${i + 1}`,
        original_text: text,
        claim: text,
      }))
    : await extractClaims(request, llm, {
        courseClaims: opts.course !== undefined,
        topicContext: opts.topicContext,
      });
  if (claims.length === 0 && opts.fallbackToText) {
    const whole = wholeTextClaim(request.text);
    if (whole) {
      claims = [whole];
      log("extraction found no claims, checking the text as one claim");
    }
  }
  log(`extracted ${claims.length} claim(s)`);

  const cards = new Array<ClaimCard>(claims.length);
  const context: CourseQueryContext = {
    noteTitle: request.note_title,
    headings: request.headings,
    topics: opts.topicContext,
    fast: opts.fast,
  };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= claims.length) return;
      const claim = claims[index];
      try {
        cards[index] = await checkOne(
          claim,
          llm,
          maxRetries,
          log,
          opts.signal,
          opts.course,
          pipelineRetrieval,
          context,
          opts.localOnly,
          verifyLlm,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "Aborted") throw err;
        cards[index] = { ...claim, verdict: "Not Enough Info", explanation: `Could not check this claim: ${msg}` };
      }
    }
  };
  const parallelClaims = Math.max(1, Math.min(opts.parallelClaims ?? 1, claims.length));
  await Promise.all(Array.from({ length: parallelClaims }, () => worker()));
  return { cards };
}
