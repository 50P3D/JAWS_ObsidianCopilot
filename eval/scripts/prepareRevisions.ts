/**
 * Fetch reverted and stable English Wikipedia revisions and draw the reliability dev and test splits.
 *
 * Usage (from the repo root, needs network access to en.wikipedia.org):
 *   npx tsx eval/scripts/prepareRevisions.ts
 *   npx tsx eval/scripts/prepareRevisions.ts --dev 20 --test 50 --seed 201
 *
 * --dev and --test are revisions per label, so the defaults give 40 dev rows and 100 test rows.
 *
 * Writes:
 *   eval/datasets/reliability-dev.jsonl    tuning set (committed)
 *   eval/datasets/reliability-test.jsonl   frozen test set (committed, run once at the end)
 *
 * Pools (both from list=recentchanges: main namespace, non-bot, edits only, no page creations):
 *   reverted  edits tagged mw-reverted
 *   stable    edits 7 to 30 days old carrying none of mw-reverted, mw-rollback, mw-undo, mw-manual-revert
 * Each pool is capped at 2000 rows. The sampler (eval/harness/revisionSampler.ts) shuffles them
 * with the seed, keeps one revision per article across both splits and interleaves the labels.
 *
 * The recent-changes feed is live, so a later run fetches different pools. The header of each
 * output file records the seed, the query, the fetch time and the sha256 of the pools.
 *
 * Privacy: rcprop never asks for `user`, and only revision ids, titles and timestamps are kept.
 * If a pool is too small the script exits non-zero and writes nothing.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { USER_AGENT, WIKI_API } from "../../src/reliability/config";
import { flagNumber, parseArgs } from "../harness/cli";
import { serialiseRevisionItems, type RevisionItem } from "../harness/reliabilityDataset";
import { poolSha256, renderHeader, sampleSplits, type PoolRevision } from "../harness/revisionSampler";
import type { Split } from "../harness/types";

const datasetsDir = fileURLToPath(new URL("../datasets/", import.meta.url));

const POOL_CAP = 2000;
const PAGE_LIMIT = 500; // the most a non-bot client may ask for per request
const FETCH_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STABLE_MIN_AGE_DAYS = 7;
const STABLE_MAX_AGE_DAYS = 30;
const REVERT_TAGS = ["mw-reverted", "mw-rollback", "mw-undo", "mw-manual-revert"];

/** Shared query parameters. No `user` in rcprop, so user names and IPs are never fetched. */
const BASE_PARAMS: Record<string, string> = {
  action: "query",
  list: "recentchanges",
  rcnamespace: "0",
  rcshow: "!bot",
  rctype: "edit",
  rcprop: "ids|title|timestamp|tags",
  rclimit: String(PAGE_LIMIT),
  format: "json",
  formatversion: "2",
};

interface RecentChange {
  revid?: number;
  title?: string;
  timestamp?: string;
  tags?: string[];
}

interface RecentChangesResponse {
  error?: { code?: string; info?: string };
  continue?: Record<string, string>;
  query?: { recentchanges?: RecentChange[] };
}

async function getJson(params: Record<string, string>): Promise<RecentChangesResponse> {
  const url = `${WIKI_API}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${WIKI_API}`);
  const data = (await res.json()) as RecentChangesResponse;
  if (data.error) throw new Error(`MediaWiki error ${data.error.code ?? "?"}: ${data.error.info ?? ""}`);
  return data;
}

/**
 * Page through recent changes with rccontinue until `POOL_CAP` rows pass `keep` or the feed ends.
 * Only rev_id, title and timestamp are kept from each row.
 */
async function fetchPool(
  label: string,
  params: Record<string, string>,
  keep: (rc: RecentChange) => boolean,
): Promise<PoolRevision[]> {
  const pool: PoolRevision[] = [];
  let cont: Record<string, string> = {};
  for (let page = 1; pool.length < POOL_CAP; page++) {
    const data = await getJson({ ...BASE_PARAMS, ...params, ...cont });
    for (const rc of data.query?.recentchanges ?? []) {
      if (typeof rc.revid !== "number" || rc.revid <= 0 || !rc.title || !rc.timestamp) continue;
      if (!keep(rc)) continue;
      pool.push({ rev_id: rc.revid, page_title: rc.title, timestamp: rc.timestamp });
      if (pool.length >= POOL_CAP) break;
    }
    console.log(`  ${label}: page ${page}, ${pool.length} rows`);
    if (!data.continue?.rccontinue) break;
    cont = data.continue;
  }
  return pool;
}

const hasRevertTag = (rc: RecentChange) => (rc.tags ?? []).some((t) => REVERT_TAGS.includes(t));

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const devPerLabel = flagNumber(flags, "dev", 20);
  const testPerLabel = flagNumber(flags, "test", 50);
  const seed = flagNumber(flags, "seed", 201);

  const now = Date.now();
  const fetchedAt = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  // rcdir defaults to "older": rcstart is the newer bound and rcend the older one.
  const stableStart = new Date(now - STABLE_MIN_AGE_DAYS * DAY_MS).toISOString();
  const stableEnd = new Date(now - STABLE_MAX_AGE_DAYS * DAY_MS).toISOString();

  console.log(`Fetching recent changes from ${WIKI_API} ...`);
  const reverted = await fetchPool("reverted", { rctag: "mw-reverted" }, () => true);
  const stable = await fetchPool("stable", { rcstart: stableStart, rcend: stableEnd }, (rc) => !hasRevertTag(rc));
  const pools = { reverted, stable };
  const sha = poolSha256(pools);
  console.log(`Pools: ${reverted.length} reverted, ${stable.length} stable (sha256 ${sha.slice(0, 12)})`);

  // Throws "Not enough <label> revisions: need N, have M" before anything is written.
  const { dev, test } = sampleSplits(pools, { devPerLabel, testPerLabel }, seed);

  const query =
    `enwiki list=recentchanges (rcnamespace=0, rcshow=!bot, rctype=edit, rcprop=ids|title|timestamp|tags, ` +
    `up to ${POOL_CAP} per pool). Reverted: rctag=mw-reverted. ` +
    `Stable: ${STABLE_MIN_AGE_DAYS} to ${STABLE_MAX_AGE_DAYS} days old (rcstart=${stableStart}, rcend=${stableEnd}), ` +
    `no ${REVERT_TAGS.join("/")} tags.`;

  const render = (split: Split, items: RevisionItem[]) => {
    const nReverted = items.filter((i) => i.reverted).length;
    const header = renderHeader({
      split,
      reverted: nReverted,
      stable: items.length - nReverted,
      seed,
      query,
      fetchedAt,
      poolSha256: sha,
    });
    return serialiseRevisionItems(items, header);
  };
  // Render both files first, so a failure leaves no partial output.
  const outputs: [string, RevisionItem[], string][] = [
    ["reliability-dev.jsonl", dev, render("dev", dev)],
    ["reliability-test.jsonl", test, render("test", test)],
  ];
  for (const [name, items, body] of outputs) {
    await writeFile(`${datasetsDir}${name}`, body, "utf8");
    const nReverted = items.filter((i) => i.reverted).length;
    console.log(`Wrote eval/datasets/${name}: ${nReverted} reverted, ${items.length - nReverted} stable`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
