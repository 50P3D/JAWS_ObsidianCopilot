/**
 * Settings for the reliability scorer. Change them with environment variables, not by editing this file.
 * This file does not import src/retrieval/config.ts, so the two folders stay independent.
 */

import type { Thresholds } from "./types";

export const WIKI_API = "https://en.wikipedia.org/w/api.php";

export const LIFTWING_URL =
  "https://api.wikimedia.org/service/lw/inference/v1/models/revertrisk-language-agnostic:predict";

/** Wikimedia asks every client to say who it is. Same variable and format as retrieval. */
const CONTACT = process.env.NOTECHECK_CONTACT ?? "https://github.com/50P3D/JAWS_ObsidianCopilot";
export const USER_AGENT = `NoteCheck/0.1 (SE201 student project; ${CONTACT})`;

/** Set NOTECHECK_LIFTWING=off to skip Lift Wing (the revert-risk signal is then Unavailable: "disabled"). */
export const LIFTWING_ENABLED = (process.env.NOTECHECK_LIFTWING ?? "on") !== "off";

/** Abort any single Wikimedia request after this long. Can be overridden per call. */
export const REQUEST_TIMEOUT_MS = 5000;

/** How far back the edit history is read, from As_Of. */
export const HISTORY_WINDOW_DAYS = 30;

/** Most reasons shown on one card. */
export const MAX_REASONS = 6;

export const DEFAULT_THRESHOLDS: Thresholds = {
  // Tuned on the dev split (40 revisions): best F1 0.778 at 0.60 (P 0.875, R 0.700), was 0.7 (F1 0.727).
  // See eval/results/tune-reliability-20261017-190041_reliability-scorer_dev.md. Small n, expect some overfit.
  revertRiskLow: 0.6,
  revertRiskMedium: 0.4,
  recentEditHours: 24,
  revertsInWindow: 3,
  inlineIssues: 10,
  citationCoverage: 0.5,
  unavailableCap: 2, // this many Unavailable signals or more means High is not allowed
};
