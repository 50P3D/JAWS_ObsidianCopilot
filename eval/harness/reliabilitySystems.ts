/**
 * Systems for the reliability evaluation (Requirements 10.1 and 10.2).
 *
 *   flag-nothing       always High, never flags Low (the Flag_Nothing_Baseline)
 *   revert-risk-only   Low exactly when the Lift Wing revert risk is >= revertRiskLow
 *   scorer             the real Reliability_Scorer (scoreRevision in src/reliability/)
 *
 * Every system scores one revision as of its own save time (`asOf = new Date(item.timestamp)`), so
 * no information from after the edit can leak in. Systems only see the revision id, page title and
 * timestamp: the input type leaves out the gold `reverted` label, so a system cannot read it.
 *
 * Choices for `revert-risk-only`:
 * - It calls `fetchSignals`, the same fetcher the scorer uses, and saves the full Signals. The
 *   run files of `revert-risk-only` and `scorer` are then directly comparable (same Unavailable
 *   counts, same per-rule report). Only the revert risk decides the badge.
 * - Measured risk below the threshold gives "High". An Unavailable risk is not flagged and gives
 *   "Medium", with a "could not be checked" reason, because the baseline cannot vouch for it.
 *   With Lift Wing off the baseline therefore never flags Low.
 */

import type { ReliabilityBadge } from "../../src/contract/claimCard";
import { LIFTWING_ENABLED, DEFAULT_THRESHOLDS } from "../../src/reliability/config";
import { evaluateRules, sanitiseCause } from "../../src/reliability/combine";
import type { FetchLike } from "../../src/reliability/http";
import { fetchSignals, type RevisionRef, type SignalOptions } from "../../src/reliability/signals";
import { scoreRevision } from "../../src/reliability/index";
import { isUnavailable, type Signals, type Thresholds } from "../../src/reliability/types";
import type { ReliabilitySystemName, RevisionItem } from "./reliabilityDataset";

export const RELIABILITY_SYSTEM_NAMES: ReliabilitySystemName[] = ["flag-nothing", "revert-risk-only", "scorer"];

/** What a system may see of a dataset row. The gold `reverted` label is left out on purpose. */
export type RevisionInput = Pick<RevisionItem, "id" | "rev_id" | "page_title" | "timestamp">;

export interface ReliabilitySystemOutput {
  badge: ReliabilityBadge;
  /** The Low flag scored by the evaluation: `badge === "Low"`. */
  low: boolean;
  reasons: string[];
  /** Ids of the fired rules (from src/reliability/combine.ts RULE_IDS). */
  rules: string[];
  /** The fetched signals. Absent for flag-nothing, which fetches nothing. */
  signals?: Signals;
}

/** Recorded as `system` in the run file. */
export interface ReliabilitySystemInfo {
  name: ReliabilitySystemName;
  /** Effective thresholds. Absent for flag-nothing, which uses none. */
  thresholds?: Thresholds;
  /** Whether Lift Wing was actually called (option and NOTECHECK_LIFTWING both on). */
  liftwing: boolean;
}

export interface ReliabilitySystem {
  info: ReliabilitySystemInfo;
  check(item: RevisionInput): Promise<ReliabilitySystemOutput>;
}

export interface ReliabilitySystemOptions {
  /** Overrides on top of DEFAULT_THRESHOLDS, for example `{ revertRiskLow: 0.8 }` from --risk-low. */
  thresholds?: Partial<Thresholds>;
  /** false skips Lift Wing (`--liftwing off`). Defaults to on, unless NOTECHECK_LIFTWING=off. */
  liftWing?: boolean;
  /** Injected fetch, for tests. */
  fetch?: FetchLike;
  /** Per-request timeout in ms. Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

export function createReliabilitySystem(name: string, opts: ReliabilitySystemOptions = {}): ReliabilitySystem {
  switch (name) {
    case "flag-nothing":
      return flagNothingSystem();
    case "revert-risk-only":
      return revertRiskOnlySystem(opts);
    case "scorer":
      return scorerSystem(opts);
    default:
      throw new Error(`Unknown reliability system "${name}". Choose one of: ${RELIABILITY_SYSTEM_NAMES.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Systems

/** Always High, never Low. Precision, recall and flag rate are all 0. */
export function flagNothingSystem(): ReliabilitySystem {
  return {
    info: { name: "flag-nothing", liftwing: false },
    async check() {
      return { badge: "High", low: false, reasons: ["Baseline: no revision is ever flagged"], rules: [] };
    },
  };
}

/** Low exactly when the revert risk is at or above `revertRiskLow`. Unavailable risk is not flagged. */
export function revertRiskOnlySystem(opts: ReliabilitySystemOptions = {}): ReliabilitySystem {
  const thresholds = resolveThresholds(opts.thresholds);
  return {
    info: { name: "revert-risk-only", thresholds, liftwing: liftWingOn(opts) },
    async check(item) {
      const signals = await fetchSignals(revisionRef(item), signalOptions(item, opts));
      const risk = signals.revertRisk;
      if (isUnavailable(risk)) {
        return {
          badge: "Medium",
          low: false,
          reasons: [`Revert-risk score could not be checked: ${sanitiseCause(risk.cause)}`],
          rules: [],
          signals,
        };
      }
      // Reuse the scorer's own rule so the id and wording match the scorer runs exactly.
      const hit = evaluateRules(signals, thresholds).find((h) => h.id === "revert-risk-high");
      if (hit) return { badge: "Low", low: true, reasons: [hit.reason], rules: [hit.id], signals };
      return {
        badge: "High",
        low: false,
        reasons: [`Predicted revert risk ${risk.probability.toFixed(2)} is below ${thresholds.revertRiskLow}`],
        rules: [],
        signals,
      };
    },
  };
}

/** The real scorer: `scoreRevision` with the evaluation thresholds. */
export function scorerSystem(opts: ReliabilitySystemOptions = {}): ReliabilitySystem {
  const thresholds = resolveThresholds(opts.thresholds);
  return {
    info: { name: "scorer", thresholds, liftwing: liftWingOn(opts) },
    async check(item) {
      const score = await scoreRevision(revisionRef(item), { ...signalOptions(item, opts), thresholds });
      return {
        badge: score.badge,
        low: score.badge === "Low",
        reasons: score.reasons,
        rules: score.rules,
        signals: score.signals,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers

/** DEFAULT_THRESHOLDS with the overrides applied. Each override must be a finite number. */
export function resolveThresholds(overrides: Partial<Thresholds> = {}): Thresholds {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS };
  for (const [key, value] of Object.entries(overrides) as [keyof Thresholds, number | undefined][]) {
    if (value === undefined) continue;
    if (!(key in DEFAULT_THRESHOLDS)) throw new Error(`Unknown threshold "${key}"`);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Threshold "${key}" must be a finite number, got ${JSON.stringify(value)}`);
    }
    t[key] = value;
  }
  return t;
}

function liftWingOn(opts: ReliabilitySystemOptions): boolean {
  return opts.liftWing !== false && LIFTWING_ENABLED;
}

/** The revision as the fetcher sees it. The dataset timestamp saves one lookup request. */
function revisionRef(item: RevisionInput): RevisionRef {
  return { revision_id: item.rev_id, page_title: item.page_title, revision_timestamp: item.timestamp };
}

/** As_Of is the revision's own save time (Requirement 10.2). */
function signalOptions(item: RevisionInput, opts: ReliabilitySystemOptions): SignalOptions {
  const asOf = new Date(item.timestamp);
  if (Number.isNaN(asOf.getTime())) throw new Error(`${item.id}: invalid timestamp ${JSON.stringify(item.timestamp)}`);
  return { asOf, liftWing: opts.liftWing, fetch: opts.fetch, timeoutMs: opts.timeoutMs };
}
