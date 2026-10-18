/**
 * Draw the reliability dev and test splits from the fetched revision pools.
 *
 * Pure: no network and no file access, so tests can import it directly. The dataset script
 * (eval/scripts/prepareRevisions.ts) fetches the pools and writes the files.
 *
 * Rules:
 *   - Each pool is shuffled with the seeded generator from rng.ts.
 *   - At most one revision per article across both splits and both labels.
 *   - The dev and test splits never share a revision or an article.
 *   - Labels are interleaved (reverted, stable, reverted, ...), so every prefix of a split
 *     stays balanced and `--limit` on a run still sees both labels.
 *
 * Pool rows carry revision ids, titles and timestamps only. No user names or IP addresses.
 */

import { createHash } from "node:crypto";
import type { RevisionItem } from "./reliabilityDataset";
import { makeRng, shuffle } from "./rng";
import type { Split } from "./types";

/** One edit from the recent-changes feed, as kept in a pool. */
export interface PoolRevision {
  rev_id: number;
  page_title: string;
  /** ISO 8601 save time. */
  timestamp: string;
}

export interface RevisionPools {
  reverted: PoolRevision[];
  stable: PoolRevision[];
}

export interface SplitSizes {
  /** Revisions per label in the dev split (default 20, so 40 rows). */
  devPerLabel: number;
  /** Revisions per label in the test split (default 50, so 100 rows). */
  testPerLabel: number;
}

export interface SampledSplits {
  dev: RevisionItem[];
  test: RevisionItem[];
}

export const DEFAULT_SPLIT_SIZES: SplitSizes = { devPerLabel: 20, testPerLabel: 50 };

type Label = "reverted" | "stable";
const LABELS: readonly Label[] = ["reverted", "stable"];

/** sha256 of the pools in a fixed key order, recorded in the file headers. */
export function poolSha256(pools: RevisionPools): string {
  const canonical = (rows: PoolRevision[]) =>
    rows.map((r) => ({ rev_id: r.rev_id, page_title: r.page_title, timestamp: r.timestamp }));
  const text = JSON.stringify({ reverted: canonical(pools.reverted), stable: canonical(pools.stable) });
  return createHash("sha256").update(text).digest("hex");
}

function checkSize(name: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number >= 0, got ${n}`);
}

function toItem(row: PoolRevision, reverted: boolean, split: Split): RevisionItem {
  return {
    id: `rev-${row.rev_id}`,
    rev_id: row.rev_id,
    page_title: row.page_title,
    timestamp: row.timestamp,
    reverted,
    split,
  };
}

/** Alternate reverted and stable rows. Both lists have the same length here. */
function interleave(reverted: RevisionItem[], stable: RevisionItem[]): RevisionItem[] {
  const out: RevisionItem[] = [];
  const max = Math.max(reverted.length, stable.length);
  for (let i = 0; i < max; i++) {
    if (reverted[i]) out.push(reverted[i]);
    if (stable[i]) out.push(stable[i]);
  }
  return out;
}

/**
 * Draw `devPerLabel` + `testPerLabel` revisions per label, one per article, and split them.
 *
 * Both shuffled pools are walked in turn (one reverted, then one stable), skipping any
 * revision whose article or revision id was already taken, so an article that appears in
 * both pools cannot end up in the dataset twice. The first `devPerLabel` drawn per label go
 * to dev and the rest to test.
 *
 * Throws "Not enough <label> revisions: need N, have M" when a pool runs out first.
 */
export function sampleSplits(
  pools: RevisionPools,
  sizes: SplitSizes = DEFAULT_SPLIT_SIZES,
  seed = 201,
): SampledSplits {
  checkSize("devPerLabel", sizes.devPerLabel);
  checkSize("testPerLabel", sizes.testPerLabel);
  const need = sizes.devPerLabel + sizes.testPerLabel;

  const rng = makeRng(seed);
  const shuffled: Record<Label, PoolRevision[]> = {
    reverted: shuffle(pools.reverted, rng),
    stable: shuffle(pools.stable, rng),
  };

  const usedTitles = new Set<string>();
  const usedRevs = new Set<number>();
  const drawn: Record<Label, PoolRevision[]> = { reverted: [], stable: [] };
  const cursor: Record<Label, number> = { reverted: 0, stable: 0 };

  const drawOne = (label: Label): boolean => {
    const rows = shuffled[label];
    while (cursor[label] < rows.length) {
      const row = rows[cursor[label]++];
      if (usedTitles.has(row.page_title) || usedRevs.has(row.rev_id)) continue;
      usedTitles.add(row.page_title);
      usedRevs.add(row.rev_id);
      drawn[label].push(row);
      return true;
    }
    return false;
  };

  for (let i = 0; i < need; i++) {
    for (const label of LABELS) {
      if (!drawOne(label)) {
        throw new Error(`Not enough ${label} revisions: need ${need}, have ${drawn[label].length}`);
      }
    }
  }

  const build = (split: Split, from: number, to: number) =>
    interleave(
      drawn.reverted.slice(from, to).map((r) => toItem(r, true, split)),
      drawn.stable.slice(from, to).map((r) => toItem(r, false, split)),
    );

  return {
    dev: build("dev", 0, sizes.devPerLabel),
    test: build("test", sizes.devPerLabel, need),
  };
}

export interface HeaderInfo {
  split: Split;
  reverted: number;
  stable: number;
  seed: number;
  /** Plain description of the recent-changes queries used to build the pools. */
  query: string;
  /** When the pools were fetched (ISO 8601). */
  fetchedAt: string;
  poolSha256: string;
}

/** Header comment for a split file. serialiseRevisionItems keeps the "//" prefixes. */
export function renderHeader(info: HeaderInfo): string {
  const n = info.reverted + info.stable;
  return [
    `// Reliability revisions, split=${info.split}, n=${n} (${info.reverted} reverted, ${info.stable} stable), seed=${info.seed}, one revision per article.`,
    `// Source: ${info.query}`,
    `// Fetched ${info.fetchedAt}, pool sha256 ${info.poolSha256}. Regenerate: npx tsx eval/scripts/prepareRevisions.ts`,
  ].join("\n");
}
