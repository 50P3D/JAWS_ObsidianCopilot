/**
 * Signal fetcher for one evidence revision (Requirements 1, 2 and 3).
 *
 * Three independent requests run in parallel with Promise.allSettled, so a failure only marks its
 * own signal(s) as Unavailable:
 *
 * 1. `action=parse&oldid=<rev>` gives the categories, templates and wikitext of that exact revision,
 *    which feed the Maintenance_Signal (tags.ts) and the Citation_Signal (citations.ts).
 * 2. `action=query&prop=revisions|flagged` over the 30 days up to As_Of feeds the
 *    Edit_Activity_Signal (history.ts). Only `rvprop=ids|timestamp|tags` is requested, never user fields.
 * 3. Lift Wing `revertrisk-language-agnostic` gives the Revert_Risk_Signal.
 *
 * Response shapes (formatversion=2, checked live):
 *   parse: { parse: { revid, categories: [{ category, hidden }], templates: [{ ns, title }], wikitext: string } }
 *   parse error: { error: { code: "nosuchrevid", info } }
 *   query: { query: { pages: [{ title, missing?, revisions: [{ revid, timestamp, tags }],
 *                               flagged?: { stable_revid, level, pending_since? } }] } }
 */

import { citationCoverage } from "./citations";
import { HISTORY_WINDOW_DAYS, LIFTWING_ENABLED, LIFTWING_URL, WIKI_API } from "./config";
import { summariseHistory, type HistoryRevision } from "./history";
import { getJson, postJson, type HttpOptions } from "./http";
import { classifyMaintenance } from "./tags";
import {
  isUnavailable,
  unavailable,
  type CitationSignal,
  type EditActivitySignal,
  type MaintenanceSignal,
  type RevertRiskSignal,
  type Signals,
  type Unavailable,
} from "./types";

/** The parts of an Evidence item the fetcher needs. */
export interface RevisionRef {
  revision_id: number;
  page_title: string;
  /** ISO 8601. Looked up with one extra request when missing. */
  revision_timestamp?: string;
}

export interface SignalOptions extends HttpOptions {
  /** Compute every signal as of this time. Defaults to now. */
  asOf?: Date;
  /** false skips Lift Wing (Revert_Risk_Signal is then Unavailable: "disabled"). */
  liftWing?: boolean;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Checks a Lift Wing response. The revert risk is `output.probabilities.true`, which must be a
 * finite number in [0, 1]. Pure.
 */
export function parseLiftWing(json: unknown): RevertRiskSignal | Unavailable {
  const p = (json as { output?: { probabilities?: { true?: unknown } } } | null | undefined)?.output?.probabilities
    ?.true;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
    return unavailable("no revert-risk probability in response");
  }
  return { probability: p };
}

/** Fetches all four signals for one revision. Never rejects. */
export async function fetchSignals(rev: RevisionRef, opts: SignalOptions = {}): Promise<Signals> {
  const asOf = opts.asOf ?? new Date();
  const http: HttpOptions = { fetch: opts.fetch, timeoutMs: opts.timeoutMs };
  const liftWingOn = opts.liftWing !== false && LIFTWING_ENABLED;

  const [content, history, risk] = await Promise.allSettled([
    fetchContentSignals(rev.revision_id, http),
    fetchEditActivity(rev, asOf, http),
    liftWingOn ? fetchRevertRisk(rev.revision_id, http) : Promise.resolve(unavailable("disabled")),
  ]);

  let maintenance: MaintenanceSignal | Unavailable;
  let citations: CitationSignal | Unavailable;
  if (content.status === "fulfilled") {
    ({ maintenance, citations } = content.value);
  } else {
    maintenance = citations = unavailable(causeOf(content.reason));
  }

  return {
    maintenance,
    editActivity: history.status === "fulfilled" ? history.value : unavailable(causeOf(history.reason)),
    revertRisk: risk.status === "fulfilled" ? risk.value : unavailable(causeOf(risk.reason)),
    citations,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Revision content: maintenance banners, inline tags, citation coverage

async function fetchContentSignals(
  revisionId: number,
  http: HttpOptions,
): Promise<{ maintenance: MaintenanceSignal | Unavailable; citations: CitationSignal | Unavailable }> {
  const url = apiUrl({
    action: "parse",
    oldid: String(revisionId),
    prop: "categories|templates|wikitext",
  });
  const json = await getJson(url, http);

  const apiError = apiErrorCode(json);
  if (apiError) {
    const u = unavailable(apiError);
    return { maintenance: u, citations: u };
  }

  const parse = json?.parse;
  if (!parse || typeof parse !== "object") {
    const u = unavailable("unexpected parse response");
    return { maintenance: u, citations: u };
  }

  const categories = asArray(parse.categories)
    .map((c) => (typeof c === "string" ? c : c?.category ?? c?.["*"]))
    .filter((c): c is string => typeof c === "string");
  const templates = asArray(parse.templates)
    .map((t) => (typeof t === "string" ? t : t?.title ?? t?.["*"]))
    .filter((t): t is string => typeof t === "string");
  // formatversion=2 gives a string; formatversion=1 would give { "*": string }.
  const rawWikitext = typeof parse.wikitext === "string" ? parse.wikitext : parse.wikitext?.["*"];
  const wikitext = typeof rawWikitext === "string" ? rawWikitext : undefined;

  return {
    maintenance: classifyMaintenance(categories, templates, wikitext ?? ""),
    citations: wikitext === undefined ? unavailable("no wikitext in parse response") : citationCoverage(wikitext),
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Edit activity: age, recent edits, reverts, pending changes

async function fetchEditActivity(rev: RevisionRef, asOf: Date, http: HttpOptions): Promise<EditActivitySignal> {
  const revisionTimestamp = rev.revision_timestamp ?? (await lookupTimestamp(rev.revision_id, http));

  // Round As_Of up to the minute so the cache key is stable within a minute. Revisions saved
  // after As_Of (at most 59 s) are dropped again by summariseHistory.
  const startMs = Math.ceil(asOf.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  const endMs = startMs - HISTORY_WINDOW_DAYS * MS_PER_DAY;

  // rvdir defaults to "older": rvstart is the newer end of the window. At most 500 edits are read,
  // which is far above the revert-volatility threshold.
  const url = apiUrl({
    action: "query",
    prop: "revisions|flagged",
    titles: rev.page_title,
    rvprop: "ids|timestamp|tags",
    rvlimit: "500",
    rvstart: mwTimestamp(startMs),
    rvend: mwTimestamp(endMs),
  });
  const json = await getJson(url, http);

  const apiError = apiErrorCode(json);
  if (apiError) throw new Error(apiError);

  const page = asArray(json?.query?.pages)[0];
  if (!page || typeof page !== "object") throw new Error("unexpected history response");
  if (page.missing || page.invalid) throw new Error("page not found");

  const revisions: HistoryRevision[] = asArray(page.revisions)
    .filter((r) => typeof r?.revid === "number" && typeof r?.timestamp === "string")
    .map((r) => ({
      revid: r.revid,
      timestamp: r.timestamp,
      tags: asArray(r.tags).filter((t): t is string => typeof t === "string"),
    }));

  // `flagged` is only present when the article is under pending changes. `pending_since` is
  // only present when edits are awaiting review.
  const flagged = page.flagged && typeof page.flagged === "object" ? page.flagged : undefined;
  const pendingSince: string | null =
    flagged && typeof flagged.pending_since === "string" ? flagged.pending_since : null;

  const signal = summariseHistory({
    revisionId: rev.revision_id,
    revisionTimestamp,
    asOf,
    revisions,
    pendingSince,
  });
  // Under pending changes with nothing awaiting review: the check ran and found nothing.
  if (flagged && pendingSince === null) signal.pendingReview = false;
  return signal;
}

async function lookupTimestamp(revisionId: number, http: HttpOptions): Promise<string> {
  const url = apiUrl({ action: "query", prop: "revisions", revids: String(revisionId), rvprop: "timestamp" });
  const json = await getJson(url, http);
  const apiError = apiErrorCode(json);
  if (apiError) throw new Error(apiError);
  const ts = asArray(json?.query?.pages)[0]?.revisions?.[0]?.timestamp;
  if (typeof ts !== "string") throw new Error("revision timestamp not found");
  return ts;
}

// ---------------------------------------------------------------------------------------------
// 3. Lift Wing revert risk

async function fetchRevertRisk(revisionId: number, http: HttpOptions): Promise<RevertRiskSignal | Unavailable> {
  const json = await postJson(LIFTWING_URL, { rev_id: revisionId, lang: "en" }, http);
  return parseLiftWing(json);
}

// ---------------------------------------------------------------------------------------------
// Helpers

function apiUrl(params: Record<string, string>): URL {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries({ ...params, format: "json", formatversion: "2" })) {
    url.searchParams.set(k, v);
  }
  return url;
}

/** ISO 8601 without milliseconds, as MediaWiki expects ("2026-10-17T18:05:00Z"). */
function mwTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function apiErrorCode(json: any): string | undefined {
  const err = json?.error;
  if (!err) return undefined;
  return typeof err.code === "string" && err.code ? err.code : "API error";
}

function asArray(x: unknown): any[] {
  return Array.isArray(x) ? x : [];
}

function causeOf(err: unknown): string {
  if (isUnavailable(err)) return err.cause;
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
