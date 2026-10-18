/**
 * Badge rules for one revision (pure, deterministic).
 *
 * An ordered rule table turns the Signals of one revision into a High / Medium / Low badge with
 * plain-language reasons:
 *   - Low if any Low rule fires,
 *   - otherwise Medium if any Medium rule fires or `unavailableCap` or more signals are Unavailable,
 *   - otherwise High.
 *
 * Monotone by construction: every rule is a threshold test that can only switch from "not fired" to
 * "fired" when its signal gets worse, and the badge is the minimum over the fired levels.
 *
 * Reasons describe articles and revisions, never editors. Template wording is checked against a word
 * list (`assertNoEditorTerms`). Unavailable causes are arbitrary error strings, so they are sanitised
 * (query strings removed, editor terms redacted, cut to 120 characters) before they go into a reason.
 */

import type { ReliabilityBadge } from "../contract/claimCard";
import { DEFAULT_THRESHOLDS, HISTORY_WINDOW_DAYS } from "./config";
import {
  isUnavailable,
  type BannerKind,
  type RevisionScore,
  type Signals,
  type Thresholds,
  type Unavailable,
} from "./types";

/** Lower rank means less trustworthy. The card badge is the minimum rank. */
export const BADGE_RANK: Record<ReliabilityBadge, number> = { Low: 0, Medium: 1, High: 2 };

export interface RuleHit {
  /** Stable rule id, used for per-rule firing counts in the evaluation report. */
  id: string;
  level: "Low" | "Medium";
  reason: string;
}

export interface CombineOptions {
  /** Copied to `RevisionScore.revision_id`. Defaults to 0; `scoreRevision` sets the real id. */
  revisionId?: number;
  /** Throw instead of dropping a reason that contains an editor term. Also on when NODE_ENV=test. */
  strictTerms?: boolean;
}

/** Longest Unavailable cause kept in a reason. */
export const MAX_CAUSE_LENGTH = 120;

// ---------------------------------------------------------------------------------------------
// Editor terms
// ---------------------------------------------------------------------------------------------

/**
 * Matches user, username, editor, account and IP address (case-insensitive). Stems match as
 * substrings, so plurals and compounds ("users", "editors", "username") are caught as well.
 */
const EDITOR_TERMS_SOURCE = String.raw`username|user|editor|account|ip[^a-z0-9]*address`;
const EDITOR_TERMS = new RegExp(EDITOR_TERMS_SOURCE, "i");
const EDITOR_TERMS_GLOBAL = new RegExp(EDITOR_TERMS_SOURCE, "gi");

/** Placeholder for a redacted editor term. Contains no letters, so it cannot form a new term. */
const REDACTED = "[…]";

export function hasEditorTerm(text: string): boolean {
  return EDITOR_TERMS.test(text) || EDITOR_TERMS.test(text.toLowerCase());
}

/**
 * Returns the reasons that are free of editor terms. A reason with an editor term is a wording
 * mistake in this file: it is dropped with a warning, or throws in strict mode (option or
 * NODE_ENV=test) so tests catch it.
 */
export function assertNoEditorTerms(reasons: string[], opts: { strict?: boolean } = {}): string[] {
  const strict = opts.strict === true || process.env.NODE_ENV === "test";
  const kept: string[] = [];
  for (const reason of reasons) {
    if (!hasEditorTerm(reason)) {
      kept.push(reason);
      continue;
    }
    const message = `Reliability reason mentions an editor term and was dropped: ${JSON.stringify(reason)}`;
    if (strict) throw new Error(message);
    console.warn(message);
  }
  return kept;
}

/**
 * Makes an Unavailable cause safe and readable for a reason: query strings removed, whitespace
 * collapsed, editor terms redacted, cut to MAX_CAUSE_LENGTH characters.
 */
export function sanitiseCause(cause: string): string {
  let text = String(cause ?? "")
    .replace(/\?\S*/g, (q) => (q.includes("=") ? "" : q)) // "?action=parse&oldid=1" etc.
    .replace(/\s+/g, " ")
    .trim();
  // Redact until stable. The placeholder has no letters, but it can join "ip" and "address" into a
  // new match (for example "ipuseraddress"), so repeat a few passes.
  for (let i = 0; i < 5 && EDITOR_TERMS.test(text); i++) text = text.replace(EDITOR_TERMS_GLOBAL, REDACTED);
  if (text.length > MAX_CAUSE_LENGTH) text = `${text.slice(0, MAX_CAUSE_LENGTH - 1)}…`;
  // Safety net for odd Unicode where lower-casing creates a term the regex did not see.
  if (hasEditorTerm(text)) return "details withheld";
  return text || "unknown cause";
}

// ---------------------------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------------------------

const fmtProb = (p: number) => p.toFixed(2);
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

const BANNER_RULES: { id: string; level: "Low" | "Medium"; kind: BannerKind; reason: string }[] = [
  { id: "banner-pov", level: "Low", kind: "pov", reason: "Article is tagged as possibly not neutral (POV)" },
  { id: "banner-disputed", level: "Low", kind: "disputed", reason: "Article has a disputed factual accuracy tag" },
  { id: "banner-unreferenced", level: "Low", kind: "unreferenced", reason: "Article is tagged as citing no sources" },
  { id: "banner-more-citations", level: "Medium", kind: "more_citations", reason: "Article is tagged as needing more citations" },
  { id: "banner-cleanup", level: "Medium", kind: "cleanup", reason: "Article is tagged for cleanup" },
  {
    id: "banner-current-event",
    level: "Medium",
    kind: "current_event",
    reason: "Article covers a current event and may change quickly",
  },
];

/** Stable rule ids in table order (Low rules first, then Medium rules). */
export const RULE_IDS = [
  "revert-risk-high",
  "banner-pov",
  "banner-disputed",
  "banner-unreferenced",
  "banner-more-citations",
  "banner-cleanup",
  "banner-current-event",
  "inline-issues",
  "revert-risk-medium",
  "recent-edit",
  "pending-review",
  "revert-volatility",
  "low-citations",
] as const;

/** The rules that hold for these signals, in table order (Low rules first, then Medium rules). */
export function evaluateRules(signals: Signals, t: Thresholds): RuleHit[] {
  const hits: RuleHit[] = [];
  const m = isUnavailable(signals.maintenance) ? null : signals.maintenance;
  const e = isUnavailable(signals.editActivity) ? null : signals.editActivity;
  const r = isUnavailable(signals.revertRisk) ? null : signals.revertRisk;
  const c = isUnavailable(signals.citations) ? null : signals.citations;

  // Low rules
  if (r && r.probability >= t.revertRiskLow) {
    hits.push({
      id: "revert-risk-high",
      level: "Low",
      reason: `This revision has a high predicted chance of being reverted (${fmtProb(r.probability)})`,
    });
  }
  for (const rule of BANNER_RULES) {
    if (rule.level === "Low" && m?.banners.includes(rule.kind)) {
      hits.push({ id: rule.id, level: rule.level, reason: rule.reason });
    }
  }

  // Medium rules
  for (const rule of BANNER_RULES) {
    if (rule.level === "Medium" && m?.banners.includes(rule.kind)) {
      hits.push({ id: rule.id, level: rule.level, reason: rule.reason });
    }
  }
  if (m && m.inlineIssues >= t.inlineIssues) {
    hits.push({
      id: "inline-issues",
      level: "Medium",
      reason: `Article has ${m.inlineIssues} 'citation needed' or similar inline tags`,
    });
  }
  if (r && r.probability >= t.revertRiskMedium && r.probability < t.revertRiskLow) {
    hits.push({
      id: "revert-risk-medium",
      level: "Medium",
      reason: `This revision has a moderate predicted chance of being reverted (${fmtProb(r.probability)})`,
    });
  }
  if (e && e.isLatest && e.ageHours < t.recentEditHours) {
    hits.push({
      id: "recent-edit",
      level: "Medium",
      reason: `The latest edit is under ${fmtNum(t.recentEditHours)} hours old and may not have been reviewed yet`,
    });
  }
  if (e && e.pendingReview === true) {
    hits.push({ id: "pending-review", level: "Medium", reason: "Article has edits awaiting review" });
  }
  if (e && e.revertsInWindow >= t.revertsInWindow) {
    hits.push({
      id: "revert-volatility",
      level: "Medium",
      reason: `Article had ${e.revertsInWindow} reverted edits in the ${HISTORY_WINDOW_DAYS} days before this revision`,
    });
  }
  if (c && c.coverage < t.citationCoverage) {
    hits.push({ id: "low-citations", level: "Medium", reason: `Only ${fmtPct(c.coverage)} of paragraphs cite a source` });
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Combination
// ---------------------------------------------------------------------------------------------

/** Signal names used in "could not be checked" reasons, in Signals order. */
const SIGNAL_LABELS: { key: keyof Signals; label: string }[] = [
  { key: "maintenance", label: "Maintenance tags" },
  { key: "editActivity", label: "Edit history" },
  { key: "revertRisk", label: "Revert-risk score" },
  { key: "citations", label: "Citation coverage" },
];

/** The passing-checks summary for a High badge, built from the signals that were measured. */
function passingSummary(signals: Signals): string {
  const parts: string[] = [];
  if (!isUnavailable(signals.maintenance)) {
    const n = signals.maintenance.inlineIssues;
    parts.push(n === 0 ? "no maintenance banners or inline issue tags" : `no maintenance banners; only ${n} inline issue tags`);
  }
  if (!isUnavailable(signals.revertRisk)) {
    parts.push(`low predicted revert risk (${fmtProb(signals.revertRisk.probability)})`);
  }
  if (!isUnavailable(signals.editActivity)) {
    parts.push(`no recent unreviewed edits or frequent reverts in the ${HISTORY_WINDOW_DAYS} days before this revision`);
  }
  if (!isUnavailable(signals.citations)) {
    parts.push(`${fmtPct(signals.citations.coverage)} of paragraphs cite a source`);
  }
  if (parts.length === 0) return "No warning signs were found in the checks that could run";
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Turns the signals of one revision into a badge and reasons.
 *
 * The design signature is `combineSignals(signals, t?)`; `RevisionScore` also needs a `revision_id`,
 * so it comes from the optional third argument (`{ revisionId }`, default 0). `scoreRevision` in
 * index.ts sets it.
 */
export function combineSignals(
  signals: Signals,
  t: Thresholds = DEFAULT_THRESHOLDS,
  opts: CombineOptions = {},
): RevisionScore {
  const hits = evaluateRules(signals, t);
  const missing = SIGNAL_LABELS.filter(({ key }) => isUnavailable(signals[key]));

  let badge: ReliabilityBadge;
  if (hits.some((h) => h.level === "Low")) badge = "Low";
  else if (hits.length > 0 || missing.length >= t.unavailableCap) badge = "Medium";
  else badge = "High";

  // Order: fired rules (table order, so Low before Medium), then one per Unavailable signal, then
  // the passing summary for High. Causes are sanitised first, so only a wording mistake in the
  // templates above can trip the editor-term check (and throw in strict mode).
  const draft = [
    ...hits.map((h) => h.reason),
    ...missing.map(
      ({ key, label }) => `${label} could not be checked: ${sanitiseCause((signals[key] as Unavailable).cause)}`,
    ),
    ...(badge === "High" ? [passingSummary(signals)] : []),
  ];
  let reasons = assertNoEditorTerms(draft, { strict: opts.strictTerms });
  if (reasons.length === 0) reasons = ["Reliability reasons could not be shown"];

  return {
    revision_id: opts.revisionId ?? 0,
    badge,
    reasons,
    rules: hits.map((h) => h.id),
    signals,
  };
}
