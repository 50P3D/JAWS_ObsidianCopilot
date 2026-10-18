/**
 * Live smoke test for the reliability scorer (needs network access to Wikimedia).
 *
 * 1. Looks up the current revision of "Treaty of Versailles" with one prop=revisions call.
 * 2. Scores it with scoreRevision and prints the signals, the fired rules, the badge and the reasons.
 * 3. Scores it again through scoreEvidence (served from the cache) to show the card-level result.
 *
 * Run with:  npx tsx src/reliability/smoke.ts
 *            npx tsx src/reliability/smoke.ts --liftwing off
 */

import { USER_AGENT, WIKI_API } from "./config";
import { DEFAULT_THRESHOLDS, evaluateRules, isUnavailable, scoreEvidence, scoreRevision } from "./index";

const TITLE = "Treaty of Versailles";

const flag = process.argv.indexOf("--liftwing");
const liftWing = !(flag >= 0 && process.argv[flag + 1] === "off");

async function currentRevision(title: string): Promise<{ revision_id: number; revision_timestamp: string }> {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries({
    action: "query",
    prop: "revisions",
    titles: title,
    rvprop: "ids|timestamp",
    rvlimit: "1",
    format: "json",
    formatversion: "2",
  })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json: any = await res.json();
  const rev = json?.query?.pages?.[0]?.revisions?.[0];
  if (typeof rev?.revid !== "number" || typeof rev?.timestamp !== "string") {
    throw new Error(`no current revision found for "${title}"`);
  }
  return { revision_id: rev.revid, revision_timestamp: rev.timestamp };
}

async function main() {
  console.log("=== Reliability Scorer Smoke Test ===\n");
  console.log(`Lift Wing: ${liftWing ? "on" : "off (--liftwing off)"}`);

  const t0 = Date.now();
  const { revision_id, revision_timestamp } = await currentRevision(TITLE);
  const url = `https://en.wikipedia.org/w/index.php?oldid=${revision_id}`;
  console.log(`Revision:  ${TITLE} @ ${revision_id} (${revision_timestamp})\n  ${url}\n`);

  const ref = { revision_id, page_title: TITLE, revision_timestamp };
  const score = await scoreRevision(ref, { liftWing });

  console.log("Signals:");
  for (const [name, value] of Object.entries(score.signals)) {
    const shown = isUnavailable(value) ? `Unavailable (${value.cause})` : JSON.stringify(value);
    console.log(`  ${name.padEnd(13)} ${shown}`);
  }

  const hits = evaluateRules(score.signals, DEFAULT_THRESHOLDS);
  console.log(`\nFired rules: ${hits.length === 0 ? "(none)" : ""}`);
  for (const h of hits) console.log(`  [${h.level}] ${h.id}`);

  console.log(`\nBadge: ${score.badge}`);
  console.log("Reasons:");
  for (const r of score.reasons) console.log(`  - ${r}`);

  const evidence = [{ passage: "", page_title: TITLE, revision_id, revision_timestamp, url }];
  const card = await scoreEvidence(evidence, { liftWing });
  console.log("\nscoreEvidence (card level):");
  console.log(`  badge:   ${card.reliability?.badge ?? "(none)"}`);
  for (const r of card.reliability?.reasons ?? []) console.log(`  reason:  ${r}`);
  console.log(`  stubbed: ${JSON.stringify(card.stubbed)}`);

  const liftWingAnswered = !isUnavailable(score.signals.revertRisk);
  console.log(`\nLift Wing responded: ${liftWingAnswered ? "yes" : "no"}`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err);
  process.exit(1);
});
