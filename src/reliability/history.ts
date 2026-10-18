/**
 * Edit activity signal (Requirement 2). Pure: no network, no clock.
 *
 * The fetch layer asks for `rvprop=ids|timestamp|tags` only, limited to the history window
 * (`rvstart=<asOf>`, `rvend=<asOf - HISTORY_WINDOW_DAYS>`), so no user fields ever reach this
 * module. This function still drops every revision saved after As_Of before counting anything,
 * so later information cannot leak in. It never reads the `mw-reverted` tag, which marks an
 * edit that was undone later and would therefore leak the future.
 */

import type { EditActivitySignal } from "./types";

/** One entry of the article history, as returned by `prop=revisions&rvprop=ids|timestamp|tags`. */
export interface HistoryRevision {
  revid: number;
  /** ISO 8601 timestamp, for example "2024-05-01T12:00:00Z". */
  timestamp: string;
  tags: string[];
}

/** Tags that mark an edit as a revert of earlier edits. `mw-reverted` is deliberately absent. */
const REVERT_TAGS: ReadonlySet<string> = new Set(["mw-rollback", "mw-undo", "mw-manual-revert"]);

const MS_PER_HOUR = 3_600_000;

export function summariseHistory(input: {
  revisionId: number;
  revisionTimestamp: string;
  asOf: Date;
  /** Newest first, as the API returns them. The order is not relied on. */
  revisions: HistoryRevision[];
  /** From `prop=flagged`. null or undefined when the article is not under pending changes. */
  pendingSince?: string | null;
}): EditActivitySignal {
  const asOfMs = input.asOf.getTime();

  // Keep only revisions saved at or before As_Of. A timestamp that cannot be parsed cannot be
  // shown to be at or before As_Of, so it is dropped too.
  const visible: { revid: number; ms: number; tags: string[] }[] = [];
  for (const rev of input.revisions) {
    const ms = Date.parse(rev.timestamp);
    if (Number.isFinite(ms) && ms <= asOfMs) {
      visible.push({ revid: rev.revid, ms, tags: rev.tags });
    }
  }

  // Hours from the revision timestamp to As_Of, never negative.
  const revMs = Date.parse(input.revisionTimestamp);
  const ageHours = Number.isFinite(revMs) ? Math.max(0, (asOfMs - revMs) / MS_PER_HOUR) : 0;

  // Newest visible revision: latest timestamp, ties broken by the higher revid (ids only grow).
  let newest: { revid: number; ms: number } | undefined;
  for (const rev of visible) {
    if (!newest || rev.ms > newest.ms || (rev.ms === newest.ms && rev.revid > newest.revid)) {
      newest = rev;
    }
  }
  // With no edits in the window, nothing has replaced the revision, so it is still the latest.
  const isLatest = newest === undefined ? true : newest.revid === input.revisionId;

  const editsInWindow = visible.length;
  const revertsInWindow = visible.filter((rev) => rev.tags.some((tag) => REVERT_TAGS.has(tag))).length;

  let pendingReview: boolean | null = null;
  if (input.pendingSince !== undefined && input.pendingSince !== null) {
    const pendingMs = Date.parse(input.pendingSince);
    pendingReview = Number.isFinite(pendingMs) && pendingMs <= asOfMs;
  }

  return { ageHours, isLatest, editsInWindow, revertsInWindow, pendingReview };
}
