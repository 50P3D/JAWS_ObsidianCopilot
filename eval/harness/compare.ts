/**
 * Compare saved runs on the claims they share, against a baseline run.
 *
 * Usage (from the repo root):
 *   npx tsx eval/harness/compare.ts eval/results/A.json eval/results/B.json [...more]
 *   npx tsx eval/harness/compare.ts A.json B.json --baseline no-rag --target 10 --out eval/results/compare.md
 *
 * Options:
 *   --baseline  system name of the baseline run. Default no-rag, else the first file
 *   --target    required improvement in macro-F1 points over the baseline. Default 10 (from the proposal)
 *   --out       also write the markdown table to this file
 *
 * The delta uses a paired bootstrap: the same resampled claims are scored for both systems,
 * which is fairer than comparing two separate intervals.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, flagNumber } from "./cli";
import { bootstrap, pairedBootstrap, verdictMetrics, type Scored } from "./metrics";
import { f3, pct } from "./report";
import type { RunFile } from "./types";

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  if (rest.length < 1) {
    console.error("Give one or more run JSON files.");
    process.exit(2);
  }
  const runs: RunFile[] = await Promise.all(rest.map(async (f) => JSON.parse(await readFile(f, "utf8"))));
  const target = flagNumber(flags, "target", 10);

  const splits = new Set(runs.map((r) => r.dataset.split));
  const shas = new Set(runs.map((r) => r.dataset.sha256));
  const warnings: string[] = [];
  if (splits.size > 1) warnings.push(`Runs mix splits (${[...splits].join(", ")}). Do not compare dev with test.`);
  if (shas.size > 1) warnings.push("Runs used different dataset files. Only shared claim ids are compared.");

  // Score every run on the claims all runs share, so the numbers line up.
  const shared = runs
    .map((r) => new Set(r.predictions.map((p) => p.id)))
    .reduce((a, b) => new Set([...a].filter((id) => b.has(id))));
  // Keep dataset order, so a run's interval here matches the one in its own report.
  const ids = runs[0].predictions.map((p) => p.id).filter((id) => shared.has(id));
  if (ids.length === 0) throw new Error("The runs have no claims in common.");
  const aligned = runs.map((r) => {
    const byId = new Map(r.predictions.map((p) => [p.id, p]));
    return ids.map((id): Scored => ({ gold: byId.get(id)!.gold, predicted: byId.get(id)!.predicted }));
  });

  const baseName = flags.baseline ?? (runs.some((r) => r.system.name === "no-rag") ? "no-rag" : runs[0].system.name);
  const baseIdx = runs.findIndex((r) => r.system.name === baseName);
  if (baseIdx < 0) throw new Error(`No run with system name "${baseName}"`);

  const label = (r: RunFile) => `${r.system.name}${r.system.model ? ` (${r.system.model})` : ""}`;
  const lines: string[] = [];
  lines.push(`# Comparison on ${ids.length} shared claims (split ${[...splits].join(", ")})`, "");
  for (const w of warnings) lines.push(`> Warning: ${w}`, "");
  lines.push("| System | Run | Macro-F1 [95% CI] | Accuracy | False-flag | Miss | Invalid |", "|---|---|---|---|---|---|---|");
  runs.forEach((r, i) => {
    const m = verdictMetrics(aligned[i]);
    const ci = bootstrap(aligned[i], (x) => verdictMetrics(x).macro_f1);
    lines.push(
      `| ${label(r)} | ${r.run_id} | ${f3(m.macro_f1)} [${f3(ci.low)}, ${f3(ci.high)}] | ${pct(m.accuracy)} | ${pct(m.false_flag_rate)} | ${pct(m.miss_rate)} | ${m.invalid} |`,
    );
  });

  lines.push("", `Change in macro-F1 against baseline **${label(runs[baseIdx])}** (target: +${target} points)`, "");
  lines.push("| System | Delta (points) | 95% CI | Share of resamples not better | Meets target? |", "|---|---|---|---|---|");
  runs.forEach((r, i) => {
    if (i === baseIdx) return;
    const d = pairedBootstrap(aligned[baseIdx], aligned[i]);
    const pts = (x: number) => (x * 100 >= 0 ? "+" : "") + (x * 100).toFixed(1);
    const meets = d.low * 100 >= target ? "yes, even at the low end of the CI" : d.value * 100 >= target ? "point estimate only, CI includes less" : "no";
    lines.push(`| ${label(r)} | ${pts(d.value)} | ${pts(d.low)} to ${pts(d.high)} | ${pct(d.p_not_better)} | ${meets} |`);
  });

  const md = lines.join("\n") + "\n";
  console.log(md);
  if (flags.out) {
    await writeFile(flags.out, md, "utf8");
    console.log(`Saved ${flags.out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
