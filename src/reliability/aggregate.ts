/**
 * Card-level reliability (pure, deterministic).
 *
 * Turns the Revision_Scores of all evidence revisions on one card into one `Reliability` value:
 *   - The badge is the lowest badge by `BADGE_RANK` (Low < Medium < High).
 *   - Scores are sorted by rank, then page title, then revision id, then reasons. The output only
 *     depends on badge, title and reasons, so two entries that tie on all four give the same output in
 *     either order. The result is therefore the same for any input order.
 *   - When more than one distinct page title is present, every reason is prefixed with
 *     "<page_title>: ", so the user can tell which article is weak. The lowest-badge article comes first.
 *   - Reasons are deduplicated (first occurrence kept) and capped at MAX_REASONS. There is always at
 *     least one reason.
 *
 * Editor terms: reasons from `combineSignals` are already free of editor terms, but a page title can
 * contain one (for example "User interface" or "Account (bookkeeping)"). Such a title is redacted with
 * `sanitiseCause` before it is used as a prefix (see `titleLabel`). As a final safety net, any reason
 * that still contains an editor term (for example "ip" at the end of a title joining "address" at the
 * start of a reason) is dropped quietly instead of thrown, so a card never fails because of a title.
 */

import type { Reliability, ReliabilityBadge } from "../contract/claimCard";
import { BADGE_RANK, hasEditorTerm, sanitiseCause } from "./combine";
import { MAX_REASONS } from "./config";
import type { RevisionScore } from "./types";

export interface PageScore {
  page_title: string;
  score: RevisionScore;
}

/** Reason used when no reason survives (empty input, or every reason was dropped). */
export const FALLBACK_REASON = "No reliability details are available for this evidence";

/** Badge used when there is nothing to aggregate. Matches the scorer's "could not be checked" fallback. */
const EMPTY_BADGE: ReliabilityBadge = "Medium";

/**
 * The prefix label for a page title. A clean title is used as is. A title with an editor term is
 * redacted (the term is replaced with "[…]"). An empty title becomes "Untitled article".
 */
export function titleLabel(title: string): string {
  const trimmed = String(title ?? "").trim();
  if (trimmed === "") return "Untitled article";
  return hasEditorTerm(trimmed) ? sanitiseCause(trimmed) : trimmed;
}

/** Code-unit comparison, so the order does not depend on the runtime locale. */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const cmpNum = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

function compareScores(a: PageScore, b: PageScore): number {
  return (
    cmpNum(BADGE_RANK[a.score.badge], BADGE_RANK[b.score.badge]) ||
    cmpStr(a.page_title, b.page_title) ||
    cmpNum(a.score.revision_id, b.score.revision_id) ||
    cmpStr(JSON.stringify(a.score.reasons), JSON.stringify(b.score.reasons))
  );
}

export function aggregateScores(scores: PageScore[]): Reliability {
  if (scores.length === 0) return { badge: EMPTY_BADGE, reasons: [FALLBACK_REASON] };

  const sorted = [...scores].sort(compareScores);
  const badge = sorted[0].score.badge; // lowest rank comes first
  const prefix = new Set(sorted.map((s) => s.page_title)).size > 1;

  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const { page_title, score } of sorted) {
    const label = prefix ? `${titleLabel(page_title)}: ` : "";
    for (const reason of score.reasons) {
      const text = `${label}${reason}`;
      if (seen.has(text)) continue;
      seen.add(text);
      if (hasEditorTerm(text)) continue; // safety net, see the header comment
      reasons.push(text);
      if (reasons.length >= MAX_REASONS) return { badge, reasons };
    }
  }
  return { badge, reasons: reasons.length > 0 ? reasons : [FALLBACK_REASON] };
}
