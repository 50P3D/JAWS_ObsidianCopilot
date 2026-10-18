/**
 * Revision dataset for the reliability evaluation, and the run file shapes shared by the
 * reliability runner, report and tuner.
 *
 * Dataset files are JSONL: one RevisionItem per line. Blank lines and lines starting with "//"
 * are ignored so a file can carry a header comment (seed, query, fetch time, pool sha256).
 *
 * A row holds revision ids, page titles, timestamps, labels and splits only. User names and IP
 * addresses are never stored: serialising and parsing both keep the fixed keys and drop the rest.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReliabilityBadge } from "../../src/contract/claimCard";
import type { Signals, Thresholds } from "../../src/reliability/types";
import type { Split } from "./types";

const SPLITS: Split[] = ["dev", "test"];

/** One labelled revision (one JSON object per line). */
export interface RevisionItem {
  /** Stable id, for example "rev-1380758127". Used to pair predictions across runs. */
  id: string;
  rev_id: number;
  page_title: string;
  /** ISO 8601 save time of the revision. Used as As_Of in the evaluation. */
  timestamp: string;
  /** Gold label: true when the edit was later tagged mw-reverted. */
  reverted: boolean;
  split: Split;
}

/** The only keys written to or read from a dataset row, in output order. */
export const REVISION_KEYS = ["id", "rev_id", "page_title", "timestamp", "reverted", "split"] as const;

export interface LoadedRevisionDataset {
  path: string;
  sha256: string;
  items: RevisionItem[];
}

export type ReliabilitySystemName = "flag-nothing" | "revert-risk-only" | "scorer";

/** One scored row in a reliability run file. */
export interface ReliabilityPrediction {
  id: string;
  rev_id: number;
  page_title: string;
  gold_reverted: boolean;
  /** null when scoring failed (see error). */
  badge: ReliabilityBadge | null;
  /** Low flag. false for rows with an error, so they count as not flagged. */
  predicted_low: boolean;
  reasons: string[];
  /** Ids of the fired rules. */
  rules: string[];
  signals?: Signals;
  ms: number;
  error?: string;
}

/** Every setting of a reliability run, as resolved by reliabilityRun.ts (Requirement 10.6). */
export interface ReliabilityRunSettings {
  /** The command line arguments, as given. */
  argv: string[];
  system: ReliabilitySystemName;
  /** Dataset path relative to the repo root. */
  dataset: string;
  split: Split;
  final: boolean;
  /** --limit, or null for every row. */
  limit: number | null;
  /** --liftwing as given ("on" or "off"), or null when not set. */
  liftwing_flag: "on" | "off" | null;
  /** NOTECHECK_LIFTWING at run time, or null when unset. */
  liftwing_env: string | null;
  /** --risk-low, or null when the default threshold was used. */
  risk_low: number | null;
  /** Output folder relative to the repo root. */
  out: string;
}

export interface ReliabilityRunFile {
  run_id: string;
  started_at: string;
  finished_at: string;
  git_commit: string | null;
  system: { name: ReliabilitySystemName; thresholds?: Thresholds; liftwing: boolean };
  dataset: { path: string; sha256: string; split: Split; count: number };
  /** Resolved run settings. Optional so hand-built run files (tests, tuner) stay valid. */
  settings?: ReliabilityRunSettings;
  predictions: ReliabilityPrediction[];
}

/** Copy only the fixed keys, so extra pool fields (for example a user name) are never kept. */
function pick(item: RevisionItem): RevisionItem {
  return {
    id: item.id,
    rev_id: item.rev_id,
    page_title: item.page_title,
    timestamp: item.timestamp,
    reverted: item.reverted,
    split: item.split,
  };
}

/**
 * Render items as JSONL with a header comment. Header lines that do not already start with
 * "//" get the prefix added. The result ends with a newline.
 */
export function serialiseRevisionItems(items: RevisionItem[], header = ""): string {
  const headerLines = header
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => (l.trimStart().startsWith("//") ? l : `// ${l}`));
  const rows = items.map((item) => JSON.stringify(pick(item)));
  return [...headerLines, ...rows].join("\n") + "\n";
}

export function parseRevisionDataset(text: string, path = "<memory>"): RevisionItem[] {
  const items: RevisionItem[] = [];
  const ids = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return;
    const where = `${path}:${i + 1}`;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      throw new Error(`${where}: expected a JSON object`);
    }
    if (typeof obj.id !== "string" || !obj.id) throw new Error(`${where}: missing "id"`);
    if (ids.has(obj.id)) throw new Error(`${where}: duplicate id "${obj.id}"`);
    if (typeof obj.rev_id !== "number" || !Number.isInteger(obj.rev_id) || obj.rev_id <= 0) {
      throw new Error(`${where}: "rev_id" must be a positive integer, got ${JSON.stringify(obj.rev_id)}`);
    }
    if (typeof obj.page_title !== "string" || !obj.page_title.trim()) {
      throw new Error(`${where}: missing "page_title"`);
    }
    if (typeof obj.timestamp !== "string" || Number.isNaN(Date.parse(obj.timestamp))) {
      throw new Error(`${where}: "timestamp" must be an ISO 8601 date, got ${JSON.stringify(obj.timestamp)}`);
    }
    if (typeof obj.reverted !== "boolean") {
      throw new Error(`${where}: "reverted" must be true or false, got ${JSON.stringify(obj.reverted)}`);
    }
    if (!SPLITS.includes(obj.split)) throw new Error(`${where}: "split" must be dev or test`);
    ids.add(obj.id);
    items.push(pick(obj as RevisionItem));
  });
  return items;
}

export async function loadRevisionDataset(path: string): Promise<LoadedRevisionDataset> {
  const text = await readFile(path, "utf8");
  return {
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
    items: parseRevisionDataset(text, path),
  };
}
