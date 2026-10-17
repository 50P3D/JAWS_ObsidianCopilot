/**
 * Turn the many ways a label can be written into one of the three contract verdicts.
 *
 * FEVER writes SUPPORTS / REFUTES / NOT ENOUGH INFO. Models write all sorts:
 * "supported", "True", "NEI", "Not enough information". Anything we cannot map
 * confidently becomes null and is scored as wrong, never guessed.
 */

import type { Verdict } from "./types";

const ALIASES: Record<string, Verdict> = {
  supported: "Supported",
  supports: "Supported",
  support: "Supported",
  true: "Supported",
  refuted: "Refuted",
  refutes: "Refuted",
  refute: "Refuted",
  false: "Refuted",
  "not enough info": "Not Enough Info",
  "not enough information": "Not Enough Info",
  "not enough evidence": "Not Enough Info",
  nei: "Not Enough Info",
  unverifiable: "Not Enough Info",
  "cannot be determined": "Not Enough Info",
  unknown: "Not Enough Info",
};

/** Exact (case and punctuation insensitive) mapping. */
export function normaliseLabel(raw: unknown): Verdict | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .toLowerCase()
    .replace(/[_\-]/g, " ")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return ALIASES[key] ?? null;
}

/**
 * Last resort for free text: accept it only if exactly one of the three labels
 * appears. "Supported or Refuted" is ambiguous and returns null.
 */
export function findLabelInText(text: string): Verdict | null {
  const t = text.toLowerCase();
  const found = new Set<Verdict>();
  if (/\bnot enough info(rmation)?\b|\bnei\b/.test(t)) found.add("Not Enough Info");
  if (/\bsupported\b|\bsupports\b/.test(t)) found.add("Supported");
  if (/\brefuted\b|\brefutes\b/.test(t)) found.add("Refuted");
  return found.size === 1 ? [...found][0] : null;
}
