/**
 * The "claim card": the shared form that every part of NoteCheck reads or fills in.
 *
 * Each claim travels through the pipeline as one card. Every stage adds its own part:
 *
 *   1. Claim extraction (Jonathan)  -> claim_id, original_text, claim
 *   2. Retrieval (Aadhavan)         -> evidence
 *   3. Reliability (Nathanael)      -> reliability
 *   4. Verification (Jonathan)      -> verdict, explanation, suggested_fix
 *
 * Fields marked optional (?) are empty until the stage that owns them has run.
 *
 * RULE: changing this file affects everyone. Change it only through a pull request
 * that all four members approve.
 */

/** The three FEVER labels. */
export type Verdict = "Supported" | "Refuted" | "Not Enough Info";

/** How much to trust a Wikipedia article revision. */
export type ReliabilityBadge = "High" | "Medium" | "Low";

/** One passage of Wikipedia text used as evidence. Filled in by retrieval. */
export interface Evidence {
  /** The passage text itself. */
  passage: string;
  /** Title of the Wikipedia article, for example "Treaty of Versailles". */
  page_title: string;
  /** The exact version of the article the passage came from. Never leave this out. */
  revision_id: number;
  /** When that revision was saved, as an ISO date string. Useful for "as of" checks. */
  revision_timestamp?: string;
  /** Link to that exact revision, so the user can open it. */
  url: string;
  /** Section heading the passage sits under, if known. */
  section?: string;
  /** How well retrieval thinks the passage matches the claim (0 to 1, higher is better). */
  retrieval_score?: number;

  // The fields below let the source viewer highlight the right sentence.
  // They are optional so nobody is blocked if they are not ready.

  /** Character positions of the key sentence inside `passage`. */
  highlight?: { start: number; end: number };
  /** A little text before the passage, for context in the viewer. */
  context_before?: string;
  /** A little text after the passage, for context in the viewer. */
  context_after?: string;
}

/** How trustworthy the evidence is. Filled in by the reliability scorer. */
export interface Reliability {
  badge: ReliabilityBadge;
  /** Plain reasons, for example "article has a POV tag" or "recent unreviewed edit". */
  reasons: string[];
}

/** One checkable claim, with everything the pipeline has learned about it. */
export interface ClaimCard {
  /** Unique within one fact-check run, for example "c1". */
  claim_id: string;
  /** The sentence as it appeared in the note. */
  original_text: string;
  /** The claim rewritten so it makes sense alone ("he" becomes the person's name). */
  claim: string;
  /** Where the sentence sits in the note, as character positions. Lets the plugin point back to it. */
  source_span?: { start: number; end: number };

  /** From retrieval. Best passages first. Empty if nothing relevant was found. */
  evidence?: Evidence[];
  /** From the reliability scorer. Describes the article and revision, never the editors. */
  reliability?: Reliability;

  /** From verification. */
  verdict?: Verdict;
  /** One or two plain sentences explaining the verdict. */
  explanation?: string;
  /** A corrected wording when the verdict is Refuted. Otherwise empty. */
  suggested_fix?: string;

  /** Names of stages that were faked for this card, for example ["reliability"]. For the checkpoint document. */
  stubbed?: string[];
  /** Which model produced the verdict, for example "qwen3.5:9b". Lets us report results per model size. */
  model_used?: string;
}

/** What goes into the fact_check tool (and the plugin command). */
export interface FactCheckRequest {
  /** The text the user selected. */
  text: string;
  /** Title and headings of the note, used to rewrite claims so they stand alone. */
  note_title?: string;
  headings?: string[];
}

/** What comes out of the fact_check tool. */
export interface FactCheckResponse {
  cards: ClaimCard[];
}
