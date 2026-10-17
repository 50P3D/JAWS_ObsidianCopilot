/**
 * Rebuild the markdown report for saved runs, for example after the report format changes.
 * No model is called.
 *
 * Usage (from the repo root):
 *   npx tsx eval/harness/rerender.ts eval/results/<run_id>.json [...more]
 */

import { readFile, writeFile } from "node:fs/promises";
import { renderReport, summaryLine } from "./report";
import type { RunFile } from "./types";

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Give one or more run JSON files.");
    process.exit(2);
  }
  for (const f of files) {
    const run: RunFile = JSON.parse(await readFile(f, "utf8"));
    const md = f.replace(/\.json$/, ".md");
    await writeFile(md, renderReport(run), "utf8");
    console.log(`${summaryLine(run)}\n  -> ${md}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
