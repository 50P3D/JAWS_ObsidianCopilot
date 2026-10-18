/**
 * Reliability scorer entry point (stage 3 of the pipeline, Requirements 6, 7.3 and 8.2).
 *
 *   scoreEvidence(evidence) -> { reliability?, stubbed }
 *
 * 1. Empty evidence gives `{ stubbed: [] }` (no badge).
 * 2. Evidence is deduplicated by `revision_id`, and each distinct revision is scored once, in
 *    parallel: `fetchSignals` (signals.ts) then `combineSignals` (combine.ts).
 * 3. The revision scores are combined into one card-level `Reliability` with `aggregateScores`
 *    (aggregate.ts). `"revert-risk"` goes into `stubbed` when Lift Wing gave no score for any revision.
 * 4. Any unexpected error is caught. The card then gets a Medium badge, the reason
 *    "Reliability could not be checked: <cause>" and `stubbed: ["reliability"]`. It never rejects,
 *    so a reliability problem can never lose the verdicts.
 *
 * The returned values fit the existing `Reliability` and `ClaimCard.stubbed` types, so
 * `src/contract/claimCard.ts` is unchanged.
 */

import type { Evidence, Reliability } from "../contract/claimCard";
import { aggregateScores, type PageScore } from "./aggregate";
import { combineSignals, sanitiseCause } from "./combine";
import { DEFAULT_THRESHOLDS } from "./config";
import { fetchSignals, type RevisionRef, type SignalOptions } from "./signals";
import { isUnavailable, type RevisionScore, type Thresholds } from "./types";

export interface ScoreOptions extends SignalOptions {
  /** Badge thresholds. Defaults to DEFAULT_THRESHOLDS. */
  thresholds?: Thresholds;
}

export interface ScoreResult {
  /** Card-level badge and reasons. Absent when there was no evidence to score. */
  reliability?: Reliability;
  /** Parts that did not really run: "reliability" (scorer failed) or "revert-risk" (no Lift Wing score). */
  stubbed: string[];
}

/** Marker for a card whose reliability could not be scored at all. */
export const STUB_RELIABILITY_MARKER = "reliability";
/** Marker for a card where Lift Wing gave no revert-risk score for any evidence revision. */
export const STUB_REVERT_RISK_MARKER = "revert-risk";

/** Markers owned by the scorer. `mergeStubbed` replaces them instead of keeping old copies. */
const SCORER_MARKERS: ReadonlySet<string> = new Set([STUB_RELIABILITY_MARKER, STUB_REVERT_RISK_MARKER]);

/** Fetches the signals of one revision and turns them into a badge with reasons. */
export async function scoreRevision(rev: RevisionRef, opts: ScoreOptions = {}): Promise<RevisionScore> {
  const signals = await fetchSignals(rev, opts);
  return combineSignals(signals, opts.thresholds ?? DEFAULT_THRESHOLDS, { revisionId: rev.revision_id });
}

/** Scores the evidence of one card. Never rejects. */
export async function scoreEvidence(evidence: Evidence[], opts: ScoreOptions = {}): Promise<ScoreResult> {
  try {
    if (!evidence || evidence.length === 0) return { stubbed: [] };

    const revisions = distinctRevisions(evidence);
    const scores: PageScore[] = await Promise.all(
      revisions.map(async (rev) => ({ page_title: rev.page_title, score: await scoreRevision(rev, opts) })),
    );

    const stubbed: string[] = [];
    if (scores.every(({ score }) => isUnavailable(score.signals.revertRisk))) {
      stubbed.push(STUB_REVERT_RISK_MARKER);
    }
    return { reliability: aggregateScores(scores), stubbed };
  } catch (err) {
    return {
      reliability: { badge: "Medium", reasons: [`Reliability could not be checked: ${sanitiseCause(errorMessage(err))}`] },
      stubbed: [STUB_RELIABILITY_MARKER],
    };
  }
}

/**
 * The card's new `stubbed` list: the existing markers without any old scorer markers
 * ("reliability", "revert-risk"), then the scorer's markers, without duplicates.
 * Returns undefined when the result is empty, so the card has no `stubbed` field.
 */
export function mergeStubbed(existing: string[] | undefined, fromScorer: string[]): string[] | undefined {
  const merged: string[] = [];
  for (const marker of existing ?? []) {
    if (!SCORER_MARKERS.has(marker) && !merged.includes(marker)) merged.push(marker);
  }
  for (const marker of fromScorer) {
    if (!merged.includes(marker)) merged.push(marker);
  }
  return merged.length > 0 ? merged : undefined;
}

/**
 * One RevisionRef per distinct `revision_id`, in first-seen order. The first item's title is kept;
 * the timestamp is taken from the first item that has one, which saves a lookup request.
 */
function distinctRevisions(evidence: Evidence[]): RevisionRef[] {
  const byId = new Map<number, RevisionRef>();
  for (const ev of evidence) {
    const seen = byId.get(ev.revision_id);
    if (!seen) {
      byId.set(ev.revision_id, {
        revision_id: ev.revision_id,
        page_title: ev.page_title,
        ...(ev.revision_timestamp ? { revision_timestamp: ev.revision_timestamp } : {}),
      });
    } else if (!seen.revision_timestamp && ev.revision_timestamp) {
      seen.revision_timestamp = ev.revision_timestamp;
    }
  }
  return [...byId.values()];
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

// ---------------------------------------------------------------------------------------------
// Public API re-exports

export type {
  BannerKind,
  CitationSignal,
  EditActivitySignal,
  MaintenanceSignal,
  RevertRiskSignal,
  RevisionScore,
  Signals,
  Thresholds,
  Unavailable,
} from "./types";
export { isUnavailable, unavailable } from "./types";
export type { RevisionRef, SignalOptions } from "./signals";
export { fetchSignals, parseLiftWing } from "./signals";
export type { FetchLike, HttpOptions } from "./http";
export { clearCache } from "./http";
export type { CombineOptions, RuleHit } from "./combine";
export { BADGE_RANK, RULE_IDS, combineSignals, evaluateRules } from "./combine";
export type { PageScore } from "./aggregate";
export { aggregateScores } from "./aggregate";
export { DEFAULT_THRESHOLDS, MAX_REASONS } from "./config";
