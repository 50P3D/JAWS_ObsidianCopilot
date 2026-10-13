/**
 * Score retrieval on the hand-written test claims.
 *
 * Usage (from the repo root):
 *   npx tsx src/retrieval/evaluate.ts
 *   npx tsx src/retrieval/evaluate.ts --configs keyword,embedding,hybrid,hybrid:30
 *
 * Options:
 *   --configs  comma list of mode or mode:candidates. Default keyword,embedding,hybrid
 *   --file     path to a claims JSON file. Default src/retrieval/testdata/claims.json
 *
 * Wikipedia answers are cached during the run and warmed up first, so the milliseconds shown
 * measure our own processing (mainly embeddings), not the network.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Evidence } from "../contract/claimCard";
import { parseArgs } from "./cli";
import { checkOllama } from "./embed";
import { scoreClaim, summarise, type ClaimResult, type TestClaim } from "./evalScore";
import { retrieveEvidence, type Mode } from "./retrieve";
import { enableCache } from "./wikipedia";

interface Config {
  label: string;
  mode: Mode;
  candidates?: number;
}

function parseConfigs(spec: string): Config[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [mode, cand] = s.split(":");
      if (!["keyword", "embedding", "hybrid"].includes(mode)) {
        throw new Error(`Unknown mode in --configs: "${s}". Use keyword, embedding or hybrid, optionally with :candidates.`);
      }
      return { label: s, mode: mode as Mode, candidates: cand ? Number(cand) : undefined };
    });
}

interface Row {
  item: TestClaim;
  result: ClaimResult;
  titles: string[];
  ms: number;
  error?: string;
}

async function runConfig(config: Config, claims: TestClaim[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const item of claims) {
    const t0 = performance.now();
    let evidence: Evidence[] = [];
    let error: string | undefined;
    try {
      evidence = await retrieveEvidence(item.claim, { mode: config.mode, candidates: config.candidates, top: 3 });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const ms = Math.round(performance.now() - t0);
    rows.push({
      item,
      result: scoreClaim(evidence, item),
      titles: evidence.map((e) => e.page_title),
      ms,
      error,
    });
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return rows;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const configs = parseConfigs(flags.configs || "keyword,embedding,hybrid");
  const file = flags.file || fileURLToPath(new URL("./testdata/claims.json", import.meta.url));
  const claims: TestClaim[] = JSON.parse(await readFile(file, "utf8"));

  if (configs.some((c) => c.mode !== "keyword")) {
    const problem = await checkOllama();
    if (problem) {
      console.error(`Setup problem: ${problem}`);
      process.exit(1);
    }
  }

  console.log(`${claims.length} claims from ${file}\n`);
  enableCache();

  process.stdout.write("Warming up the Wikipedia cache ");
  for (const item of claims) {
    try {
      await retrieveEvidence(item.claim, { mode: "keyword" });
    } catch {
      // errors are reported properly in the timed runs below
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n\n");

  const all: { config: Config; rows: Row[] }[] = [];
  for (const config of configs) {
    process.stdout.write(`Running ${config.label} `);
    all.push({ config, rows: await runConfig(config, claims) });
  }

  console.log("\nResults (higher is better, except ms)\n");
  console.log(["config".padEnd(14), "page@1".padStart(7), "page@3".padStart(7), "fact@3".padStart(7), "avg ms".padStart(8), "errors".padStart(7)].join(" "));
  for (const { config, rows } of all) {
    const s = summarise(rows.map((r) => r.result));
    const avg = Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length));
    const errors = rows.filter((r) => r.error).length;
    console.log(
      [
        config.label.padEnd(14),
        `${s.page_at_1}%`.padStart(7),
        `${s.page_at_3}%`.padStart(7),
        `${s.support_at_3}%`.padStart(7),
        String(avg).padStart(8),
        String(errors).padStart(7),
      ].join(" "),
    );
  }
  console.log("\npage@1: top passage is from an expected page.   page@3: any of the top 3 is.");
  console.log("fact@3: any of the top 3 passages contains the expected fact.");

  console.log("\nMisses (where the expected page was not in the top 3)\n");
  let anyMiss = false;
  for (const { config, rows } of all) {
    for (const r of rows) {
      if (!r.result.page_hit_3) {
        anyMiss = true;
        const got = r.error ? `ERROR ${r.error}` : r.titles.join(" | ") || "(nothing)";
        console.log(`[${config.label}] "${r.item.claim}"`);
        console.log(`    expected: ${r.item.expected_pages.join(" or ")}`);
        console.log(`    got:      ${got}`);
      }
    }
  }
  if (!anyMiss) console.log("None.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
