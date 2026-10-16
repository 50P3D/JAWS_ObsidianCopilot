/**
 * Smoke test: run one claim through retrieval and print the result.
 *
 * Usage:
 *   npm run smoke
 *   npm run smoke -- "Pluto was reclassified as a dwarf planet in 2006."
 *   npm run smoke -- "The Treaty of Versailles was signed in 1920." --mode keyword
 *
 * Options:
 *   --mode keyword|embedding|hybrid   (default hybrid)
 *   --pages N                         articles to read (default 3)
 *   --top N                           passages to return (default 3)
 */

import type { ClaimCard } from "../contract/claimCard";
import { parseArgs } from "./cli";
import { checkOllama } from "./embed";
import { retrieveEvidence, type Mode } from "./retrieve";

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const claim = rest.join(" ").trim() || "The Treaty of Versailles was signed in 1920.";
  const mode = (flags.mode || "hybrid") as Mode;
  if (!["keyword", "embedding", "hybrid"].includes(mode)) {
    console.error(`Unknown mode "${mode}". Use keyword, embedding or hybrid.`);
    process.exit(1);
  }

  if (mode !== "keyword") {
    const problem = await checkOllama();
    if (problem) {
      console.error(`Setup problem: ${problem}`);
      process.exit(1);
    }
  }

  console.log(`Claim: ${claim}`);
  console.log(`Mode:  ${mode}\n`);

  const t0 = performance.now();
  const evidence = await retrieveEvidence(claim, {
    mode,
    pages: flags.pages ? Number(flags.pages) : undefined,
    top: flags.top ? Number(flags.top) : undefined,
    log: (step, ms) => console.log(`  [${ms} ms] ${step}`),
  });
  const total = Math.round(performance.now() - t0);

  console.log(`\nTotal: ${total} ms. ${evidence.length} passages.\n`);
  if (evidence.length === 0) {
    console.log("No evidence found.");
  }
  evidence.forEach((e, i) => {
    const h = e.highlight ? e.passage.slice(e.highlight.start, e.highlight.end) : e.passage;
    console.log(`${i + 1}. [${e.retrieval_score}] ${e.page_title} > ${e.section} (revision ${e.revision_id})`);
    console.log(`   ${h.length > 220 ? h.slice(0, 220) + "..." : h}`);
    console.log(`   ${e.url}\n`);
  });

  const card: ClaimCard = {
    claim_id: "c1",
    original_text: claim,
    claim,
    evidence,
    stubbed: ["claim extraction", "reliability", "verification"],
  };
  console.log("--- claim card (as the next stage would receive it) ---");
  console.log(JSON.stringify(card, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
