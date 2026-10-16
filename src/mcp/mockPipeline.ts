/**
 * Mock fact-checking pipeline for early development and demos.
 *
 * Returns three hardcoded claim cards — one for each verdict type —
 * copied straight from the example JSONs in `src/contract/examples/`.
 *
 * This file exists so the MCP server can return realistic-looking output
 * before the real orchestrator pipeline (`src/orchestrator/`) is ready.
 * Once the orchestrator lands, every call site that uses `mockFactCheck`
 * should switch to the real pipeline function.
 */

import type { ClaimCard, FactCheckResponse } from "../contract/claimCard.js";

// ---------------------------------------------------------------------------
// Example cards, transcribed from src/contract/examples/*.json
// ---------------------------------------------------------------------------

/** Refuted card — the Treaty of Versailles date is wrong. */
const refutedCard: ClaimCard = {
  claim_id: "c1",
  original_text: "The Treaty of Versailles was signed in 1920.",
  claim: "The Treaty of Versailles was signed in 1920.",
  source_span: { start: 0, end: 44 },
  evidence: [
    {
      passage:
        "The treaty was signed on 28 June 1919, exactly five years after the assassination of Archduke Franz Ferdinand.",
      page_title: "Treaty of Versailles",
      revision_id: 111111111,
      revision_timestamp: "2026-09-30T08:15:00Z",
      url: "https://en.wikipedia.org/w/index.php?title=Treaty_of_Versailles&oldid=111111111",
      section: "Signing",
      retrieval_score: 0.91,
      highlight: { start: 0, end: 36 },
    },
  ],
  reliability: {
    badge: "High",
    reasons: ["stable article", "well cited", "no maintenance tags"],
  },
  verdict: "Refuted",
  explanation:
    "The passage gives the signing date as 28 June 1919, not 1920.",
  suggested_fix: "The Treaty of Versailles was signed in 1919.",
  model_used: "qwen3.5:9b",
};

/** Supported card — Pluto reclassification is confirmed. */
const supportedCard: ClaimCard = {
  claim_id: "c2",
  original_text: "Pluto was reclassified as a dwarf planet in 2006.",
  claim: "Pluto was reclassified as a dwarf planet in 2006.",
  source_span: { start: 45, end: 94 },
  evidence: [
    {
      passage:
        "In 2006, the International Astronomical Union formally defined the term planet and reclassified Pluto as a dwarf planet.",
      page_title: "Pluto",
      revision_id: 222222222,
      revision_timestamp: "2026-10-05T12:40:00Z",
      url: "https://en.wikipedia.org/w/index.php?title=Pluto&oldid=222222222",
      section: "Classification",
      retrieval_score: 0.88,
      highlight: { start: 0, end: 119 },
    },
  ],
  reliability: {
    badge: "Medium",
    reasons: ["recent edit not yet reviewed", "high edit volume"],
  },
  verdict: "Supported",
  explanation:
    "The passage says the International Astronomical Union reclassified Pluto as a dwarf planet in 2006.",
};

/** Not-Enough-Info card — favourite colour is not on Wikipedia. */
const notEnoughInfoCard: ClaimCard = {
  claim_id: "c3",
  original_text: "Marie Curie's favourite colour was green.",
  claim: "Marie Curie's favourite colour was green.",
  source_span: { start: 95, end: 136 },
  evidence: [
    {
      passage:
        "Marie Curie was a Polish and naturalised-French physicist and chemist who conducted pioneering research on radioactivity.",
      page_title: "Marie Curie",
      revision_id: 333333333,
      revision_timestamp: "2026-10-01T03:20:00Z",
      url: "https://en.wikipedia.org/w/index.php?title=Marie_Curie&oldid=333333333",
      retrieval_score: 0.34,
    },
  ],
  reliability: {
    badge: "High",
    reasons: ["stable article", "well cited"],
  },
  verdict: "Not Enough Info",
  explanation:
    "The retrieved passages do not mention her favourite colour, so the claim can be neither confirmed nor refuted.",
  stubbed: ["reliability"],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pretend to fact-check the given `text` and return three example claim cards.
 *
 * The input text is **ignored** — the same three cards are always returned.
 * This is intentional: the mock exists solely so the MCP server can return
 * well-shaped data while the real orchestrator is still under construction.
 *
 * @param _text - The note text (unused in the mock).
 * @returns A `FactCheckResponse` containing one card per verdict type.
 */
export async function mockFactCheck(_text: string): Promise<FactCheckResponse> {
  // Simulate a small delay so callers experience the async shape they'll
  // get from the real pipeline. Keeps timing-related bugs from hiding.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    cards: [refutedCard, supportedCard, notEnoughInfoCard],
  };
}
