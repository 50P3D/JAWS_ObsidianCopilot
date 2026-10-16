/**
 * Pick MiniCheck's Refuted / Not Enough Info threshold on the dev split, without calling
 * any model. It re-scores a saved minicheck run at every threshold from 0 to 1.
 *
 * Usage (from the repo root):
 *   npx tsx eval/harness/tuneMinicheck.ts eval/results/<minicheck dev run>.json
 *
 * Then use the printed value for the test run:
 *   npx tsx eval/harness/run.ts --system minicheck --nei-threshold <value> --split test --final
 *
 * Refuses test-split runs: tuning on the test set would make its numbers meaningless.
 */

import { readFile } from "node:fs/promises";
import { flagNumber, parseArgs } from "./cli";
import { verdictMetrics } from "./metrics";
import { f3, pct } from "./report";
import { minicheckVerdict } from "./systems/minicheck";
import type { RunFile } from "./types";

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  if (!rest[0]) {
    console.error("Give a minicheck run JSON file from the dev split.");
    process.exit(2);
  }
  const run: RunFile = JSON.parse(await readFile(rest[0], "utf8"));
  if (run.system.name !== "minicheck") throw new Error(`Expected a minicheck run, got ${run.system.name}`);
  if (run.dataset.split !== "dev") throw new Error("Tune on the dev split only.");
  const step = flagNumber(flags, "step", 0.05);

  const rows: { t: number; f1: number; acc: number; ff: number; miss: number }[] = [];
  for (let t = 0; t <= 1.0001; t += step) {
    const scored = run.predictions.map((p) => {
      const yes = (p.extra?.yes ?? null) as boolean | null;
      const best = Number(p.extra?.best_score ?? 0);
      // Rows that errored keep their null prediction.
      const predicted = p.error ? null : minicheckVerdict(yes, best, t);
      return { gold: p.gold, predicted };
    });
    const m = verdictMetrics(scored);
    rows.push({ t: Math.round(t * 1000) / 1000, f1: m.macro_f1, acc: m.accuracy, ff: m.false_flag_rate, miss: m.miss_rate });
  }

  console.log("threshold  macro-F1  accuracy  false-flag  miss");
  for (const r of rows) {
    console.log(`${r.t.toFixed(2).padStart(9)}  ${f3(r.f1).padStart(8)}  ${pct(r.acc).padStart(8)}  ${pct(r.ff).padStart(10)}  ${pct(r.miss).padStart(6)}`);
  }
  // Ties go to the threshold closest to the middle of the tied range, which is less overfit than an edge.
  const bestF1 = Math.max(...rows.map((r) => r.f1));
  const tied = rows.filter((r) => r.f1 === bestF1);
  const pick = tied[Math.floor((tied.length - 1) / 2)];
  console.log(`\nBest macro-F1 ${f3(bestF1)} at threshold ${pick.t} (${tied.length} tied). Dev has ${run.predictions.length} claims, so expect some overfit.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
