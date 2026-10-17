/**
 * Shared types for the reliability scorer (stage 5 of the pipeline).
 *
 * Every signal describes an article or a revision, never an editor. No type here has a field
 * for a user name, user id, IP address or user group.
 */

import type { ReliabilityBadge } from "../contract/claimCard";

/** A signal that could not be measured, with a short cause (for example "timeout after 5000 ms"). */
export interface Unavailable {
  unavailable: true;
  cause: string;
}

export const unavailable = (cause: string): Unavailable => ({ unavailable: true, cause });

export const isUnavailable = (x: unknown): x is Unavailable =>
  typeof x === "object" && x !== null && (x as Unavailable).unavailable === true;

/** The kinds of article-level maintenance banner the scorer recognises. */
export type BannerKind = "pov" | "disputed" | "unreferenced" | "more_citations" | "cleanup" | "current_event";

export interface MaintenanceSignal {
  /** Distinct banner kinds, in BANNER_RULES order. */
  banners: BannerKind[];
  /** Count of inline issue tags ("citation needed" and similar), >= 0. */
  inlineIssues: number;
}

export interface EditActivitySignal {
  /** Hours from the revision timestamp to As_Of, >= 0. */
  ageHours: number;
  /** Whether this revision is the newest one at As_Of. */
  isLatest: boolean;
  /** Edits in the history window up to As_Of, >= 0. */
  editsInWindow: number;
  /** Edits in the window tagged as reverts. 0 <= revertsInWindow <= editsInWindow. */
  revertsInWindow: number;
  /** null when the article is not under pending changes. */
  pendingReview: boolean | null;
}

/** Lift Wing revertrisk-language-agnostic probability of the "true" (reverted) outcome, 0..1. */
export interface RevertRiskSignal {
  probability: number;
}

export interface CitationSignal {
  /** cited / prose, 0..1. */
  coverage: number;
  /** Number of prose paragraphs. */
  prose: number;
  /** Number of prose paragraphs with at least one citation. */
  cited: number;
  /** Number of `<ref` openings in the wikitext. */
  refCount: number;
}

export interface Signals {
  maintenance: MaintenanceSignal | Unavailable;
  editActivity: EditActivitySignal | Unavailable;
  revertRisk: RevertRiskSignal | Unavailable;
  citations: CitationSignal | Unavailable;
}

/** Named limits used by the badge rules. Tuned on the dev split only. */
export interface Thresholds {
  revertRiskLow: number;
  revertRiskMedium: number;
  recentEditHours: number;
  revertsInWindow: number;
  inlineIssues: number;
  citationCoverage: number;
  /** This many Unavailable signals or more means High is not allowed. */
  unavailableCap: number;
}

export interface RevisionScore {
  revision_id: number;
  badge: ReliabilityBadge;
  /** Plain-language reasons, length >= 1. */
  reasons: string[];
  /** Ids of the fired rules, for the evaluation report. */
  rules: string[];
  signals: Signals;
}
