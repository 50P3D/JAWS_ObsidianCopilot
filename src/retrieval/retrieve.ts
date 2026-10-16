/**
 * Retrieval: claim in, ranked Wikipedia evidence out.
 *
 * Steps:
 *   1. Build short search queries from the claim (named things first).
 *   2. Search Wikipedia and fetch the top articles with their revision ids.
 *   3. Cut each article into passages.
 *   4. Pick the best candidates by keyword match (cheap).
 *   5. Re-rank the candidates by meaning using embeddings (unless mode is "keyword").
 *   6. Adjust scores by article title, so the main article beats lookalikes.
 *   7. Return the top passages in the shape the contract expects.
 *
 * Modes, so we can compare them in the evaluation:
 *   keyword    word matching only
 *   embedding  meaning only, over the keyword candidates
 *   hybrid     a weighted mix of both (default)
 */

import type { Evidence } from "../contract/claimCard";
import { HYBRID_EMBEDDING_WEIGHT, HYBRID_KEYWORD_WEIGHT } from "./config";
import { chunkArticle, splitSentences, type Chunk } from "./chunk";
import { contextAfter, contextBefore } from "./context";
import { embedDocuments, embedQuery } from "./embed";
import { buildQueries, extractEntities } from "./query";
import { cosine, keywordScore } from "./score";
import { titleAdjustment } from "./title";
import { fetchPage, isDisambiguation, searchPages, type SearchHit, type WikiPage } from "./wikipedia";

export type Mode = "keyword" | "embedding" | "hybrid";

export interface RetrieveOptions {
  mode?: Mode;
  /** How many Wikipedia articles to read. */
  pages?: number;
  /** How many passages to return. */
  top?: number;
  /** How many keyword candidates to send to the embedding step. */
  candidates?: number;
  /**
   * Drop passages scoring below this share of the best score (0 to 1). Default 0 means keep all.
   * Idea for later: pick the value from the test set instead of guessing.
   */
  minRatio?: number;
  /** Called with a short message and the milliseconds a step took. */
  log?: (step: string, ms: number) => void;
}

interface Candidate {
  page: WikiPage;
  chunk: Chunk;
  keyword: number;
  score: number;
}

const CONTEXT_CHARS = 200;

async function timed<T>(log: RetrieveOptions["log"], step: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  log?.(step, Math.round(performance.now() - t0));
  return out;
}

export async function retrieveEvidence(claim: string, opts: RetrieveOptions = {}): Promise<Evidence[]> {
  const mode = opts.mode ?? "hybrid";
  const pageLimit = opts.pages ?? 3;
  const top = opts.top ?? 3;
  const candidateLimit = opts.candidates ?? 60;
  const minRatio = opts.minRatio ?? 0;
  const log = opts.log;

  // 1 and 2: search, then fetch articles
  const queries = buildQueries(claim);
  const entities = extractEntities(claim);
  const hitLists = await timed(log, `search (${queries.length} queries)`, () =>
    Promise.all(queries.map((q) => searchPages(q, 3))),
  );

  const seen = new Set<number>();
  const hits: SearchHit[] = [];
  for (const list of hitLists) {
    for (const h of list) {
      if (!seen.has(h.pageid)) {
        seen.add(h.pageid);
        hits.push(h);
      }
    }
  }

  const fetched = await timed(log, "fetch articles", () =>
    Promise.all(hits.slice(0, pageLimit).map((h) => fetchPage(h.title))),
  );
  const pages = fetched.filter((p): p is WikiPage => p !== null && !isDisambiguation(p));

  // 3 and 4: chunk, then keyword pre-filter
  const all: Candidate[] = [];
  for (const page of pages) {
    for (const chunk of chunkArticle(page.text)) {
      const keyword = keywordScore(claim, chunk.text);
      all.push({ page, chunk, keyword, score: keyword });
    }
  }
  all.sort((a, b) => b.keyword - a.keyword);
  const candidates = all.slice(0, candidateLimit);
  if (candidates.length === 0) return [];

  // 5: re-rank by meaning
  if (mode !== "keyword") {
    const [queryVec, docVecs] = await timed(log, `embed (${candidates.length} passages)`, async () =>
      Promise.all([embedQuery(claim), embedDocuments(candidates.map((c) => c.chunk.text))]),
    );
    candidates.forEach((c, i) => {
      const sim = cosine(queryVec, docVecs[i]);
      c.score =
        mode === "embedding" ? sim : HYBRID_EMBEDDING_WEIGHT * sim + HYBRID_KEYWORD_WEIGHT * c.keyword;
    });
  }

  // 6: favour the article whose title matches what the claim is about
  for (const c of candidates) c.score += titleAdjustment(c.page.title, entities, claim);
  candidates.sort((a, b) => b.score - a.score);

  // 7: build evidence
  const best = candidates[0].score;
  return candidates
    .slice(0, top)
    .filter((c) => minRatio <= 0 || c.score >= best * minRatio)
    .map((c) => toEvidence(claim, c));
}

function toEvidence(claim: string, c: Candidate): Evidence {
  const { page, chunk } = c;
  const passage = chunk.text;

  // highlight the sentence that best matches the claim
  let best = { start: 0, end: passage.length };
  let bestScore = -1;
  for (const s of splitSentences(passage)) {
    const sc = keywordScore(claim, passage.slice(s.start, s.end));
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }

  const beforeStart = Math.max(0, chunk.start - CONTEXT_CHARS);
  const afterEnd = chunk.end + CONTEXT_CHARS;
  const before = contextBefore(page.text.slice(beforeStart, chunk.start), beforeStart > 0);
  const after = contextAfter(page.text.slice(chunk.end, afterEnd), afterEnd < page.text.length);

  return {
    passage,
    page_title: page.title,
    revision_id: page.revision_id,
    revision_timestamp: page.revision_timestamp,
    url: page.url,
    section: chunk.section,
    // the contract says 0 to 1, so keep the adjusted score inside that range
    retrieval_score: Math.round(Math.min(1, Math.max(0, c.score)) * 1000) / 1000,
    highlight: best,
    context_before: before || undefined,
    context_after: after || undefined,
  };
}
