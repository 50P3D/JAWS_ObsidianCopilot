/**
 * Pick the scorer's `revertRiskLow` threshold on the dev split, without any network request
 * (Requirement 11). It re-scores a saved `scorer` run from its saved signals at every candidate
 * value from 0.30 to 0.95 in steps of 0.05, using `combineSignals` from src/reliability/combine.ts.
 *
 * Usage (from the repo root):
 *   npx tsx eval/harness/tuneReliability.ts eval/results/<scorer dev run>.json [--out <dir>]
 *
 * Prints the table and saves it to eval/results/tune-reliability-<run_id>.md (or <dir>). Then use
 * the printed value for the test run:
 *   npx tsx eval/harness/reliabilityRun.ts --system scorer --split test --final --risk-low <value>
 *
 * Choices:
 * - Only `revertRiskLow` moves. Every other threshold comes from the run's saved thresholds. The
 *   rules need `revertRiskMedium <= revertRiskLow` (otherwise the Medium revert-risk band is empty
 *   or inverted), so each candidate uses `revertRiskMedium = min(saved revertRiskMedium, candidate)`.
 * - Rows with an error, or without saved signals, stay not flagged (Requirement 10.9).
 * - Best = highest F1. Ties go to the higher min(precision, recall), then to the value closest to
 *   the run's current `revertRiskLow`, then to the lower value.
 * - Refuses test-split runs (tuning there would make the test numbers meaningless) and runs of any
 *   system other than `scorer` (only the scorer's badge depends on all the rules).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { combineSignals } from "../../src/reliability/combine";
import type { Thresholds } from "../../src/reliability/types";
import { parseArgs } from "./cli";
import { binaryMetrics, type BinaryMetrics } from "./metrics";
import type { ReliabilityPrediction, ReliabilityRunFile } from "./reliabilityDataset";
import { toBinaryRows } from "./reliabilityReport";
import { f3, pct } from "./report";

const defaultOut = fileURLToPath(new URL("../results/", import.meta.url));

/** Candidate `revertRiskLow` values, 0.30 to 0.95 in steps of 0.05. Built from integers to avoid float drift. */
export const RISK_LOW_GRID: readonly number[] = Array.from({ length: (95 - 30) / 5 + 1 }, (_, i) => (30 + i * 5) / 100);

/** Two F1 or min(P, R) values closer than this count as tied. */
const EPS = 1e-9;

export interface GridRow {
  revertRiskLow: number;
  /** The effective `revertRiskMedium`: min(saved, revertRiskLow). */
  revertRiskMedium: number;
  metrics: BinaryMetrics;
}

/** Refuse anything other than a dev-split scorer run with saved thresholds. */
export function assertTunable(run: ReliabilityRunFile): Thresholds {
  if (run.system?.name !== "scorer") throw new Error(`Expected a scorer run, got ${run.system?.name ?? "unknown"}`);
  if (run.dataset?.split !== "dev") {
    throw new Error("Refusing to tune on a test-split run. Tune on --split dev only; the test split is for the final numbers.");
  }
  if (!run.system.thresholds) throw new Error("The run has no saved thresholds, so the badges cannot be recomputed.");
  return run.system.thresholds;
}

/** The saved thresholds with `revertRiskLow` replaced, keeping `revertRiskMedium <= revertRiskLow`. */
export function thresholdsFor(base: Thresholds, revertRiskLow: number): Thresholds {
  return { ...base, revertRiskLow, revertRiskMedium: Math.min(base.revertRiskMedium, revertRiskLow) };
}

/**
 * Recompute badge, Low flag, reasons and rules from each row's saved signals. Pure, no network.
 * Rows with an error or without signals are returned unchanged except that they are not flagged.
 */
export function recomputeRows(rows: readonly ReliabilityPrediction[], thresholds: Thresholds): ReliabilityPrediction[] {
  return rows.map((row) => {
    if (row.error || !row.signals) return { ...row, predicted_low: false };
    const score = combineSignals(row.signals, thresholds, { revisionId: row.rev_id });
    return { ...row, badge: score.badge, predicted_low: score.badge === "Low", reasons: score.reasons, rules: score.rules };
  });
}

/** Metrics for every candidate value. */
export function sweep(rows: readonly ReliabilityPrediction[], base: Thresholds, grid: readonly number[] = RISK_LOW_GRID): GridRow[] {
  return grid.map((low) => {
    const t = thresholdsFor(base, low);
    return { revertRiskLow: low, revertRiskMedium: t.revertRiskMedium, metrics: binaryMetrics(toBinaryRows(recomputeRows(rows, t))) };
  });
}

const minPR = (m: BinaryMetrics) => Math.min(m.precision, m.recall);

/**
 * The best row: highest F1, then higher min(precision, recall), then closest to `current`
 * (when given), then the lower `revertRiskLow`. Throws on an empty grid.
 */
export function pickBest(grid: readonly GridRow[], current?: number): GridRow {
  if (grid.length === 0) throw new Error("pickBest: empty grid");
  const better = (a: GridRow, b: GridRow): boolean => {
    const df1 = a.metrics.f1 - b.metrics.f1;
    if (Math.abs(df1) > EPS) return df1 > 0;
    const dmin = minPR(a.metrics) - minPR(b.metrics);
    if (Math.abs(dmin) > EPS) return dmin > 0;
    if (current !== undefined) {
      const dd = Math.abs(a.revertRiskLow - current) - Math.abs(b.revertRiskLow - current);
      if (Math.abs(dd) > EPS) return dd < 0;
    }
    return a.revertRiskLow < b.revertRiskLow;
  };
  return grid.reduce((best, row) => (better(row, best) ? row : best));
}

/** Rows whose recomputed badge at the saved thresholds differs from the saved badge (should be 0). */
export function reproductionMismatches(rows: readonly ReliabilityPrediction[], saved: Thresholds): string[] {
  const again = recomputeRows(rows, saved);
  return rows.filter((r, i) => !r.error && r.signals && r.badge !== again[i].badge).map((r) => r.id);
}

export function renderTuneReport(run: ReliabilityRunFile, grid: readonly GridRow[], best: GridRow, mismatches: readonly string[]): string {
  const saved = run.system.thresholds!;
  const p = run.predictions;
  const skipped = p.filter((r) => r.error || !r.signals).length;
  const lines: string[] = [];
  lines.push(`# Reliability threshold tuning for run ${run.run_id}`, "");
  lines.push(`- Source run: \`${run.run_id}\`, system \`${run.system.name}\`, Lift Wing ${run.system.liftwing ? "on" : "off"}`);
  lines.push(`- Dataset: \`${run.dataset.path}\`, split **${run.dataset.split}**, ${run.dataset.count} revisions, sha256 \`${run.dataset.sha256.slice(0, 12)}\``);
  lines.push(`- Saved thresholds: \`${JSON.stringify(saved)}\``);
  lines.push(`- Rows with an error or no signals (kept not flagged): ${skipped} of ${p.length}`);
  lines.push(
    mismatches.length === 0
      ? "- Recomputing at the saved thresholds reproduces every saved badge."
      : `- **Warning:** recomputing at the saved thresholds changed ${mismatches.length} badge(s): ${mismatches.join(", ")}`,
  );
  lines.push(
    "- Only `revertRiskLow` moves. `revertRiskMedium` is min(saved, candidate) so the Medium band never inverts.",
    "- Best = highest F1, then higher min(precision, recall), then closest to the saved `revertRiskLow`, then the lower value.",
    "",
  );
  lines.push("| revertRiskLow | revertRiskMedium | Precision | Recall | F1 | min(P, R) | Flag rate | TP/FP/FN/TN |", "|---|---|---|---|---|---|---|---|");
  for (const r of grid) {
    const m = r.metrics;
    const mark = r === best ? " **best**" : r.revertRiskLow === saved.revertRiskLow ? " (saved)" : "";
    lines.push(
      `| ${r.revertRiskLow.toFixed(2)}${mark} | ${r.revertRiskMedium.toFixed(2)} | ${f3(m.precision)} | ${f3(m.recall)} | ${f3(m.f1)} | ${f3(minPR(m))} | ${pct(m.flag_rate)} | ${m.tp}/${m.fp}/${m.fn}/${m.tn} |`,
    );
  }
  const tied = grid.filter((r) => Math.abs(r.metrics.f1 - best.metrics.f1) <= EPS).length;
  lines.push(
    "",
    `Best F1 ${f3(best.metrics.f1)} at revertRiskLow ${best.revertRiskLow.toFixed(2)} (precision ${f3(best.metrics.precision)}, recall ${f3(best.metrics.recall)}, ${tied} value(s) tied on F1).`,
    `Dev has ${p.length} revisions, so expect some overfit.`,
    "",
  );
  return lines.join("\n");
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  if (!rest[0]) {
    console.error("Give a scorer run JSON file from the dev split.");
    process.exit(2);
  }
  const run: ReliabilityRunFile = JSON.parse(await readFile(rest[0], "utf8"));
  const saved = assertTunable(run);

  const grid = sweep(run.predictions, saved);
  const best = pickBest(grid, saved.revertRiskLow);
  const mismatches = reproductionMismatches(run.predictions, saved);
  const md = renderTuneReport(run, grid, best, mismatches);

  const outDir = flags.out ?? defaultOut;
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `tune-reliability-${run.run_id}.md`);
  await writeFile(outPath, md, "utf8");
  console.log(md);
  console.log(`Saved ${outPath}`);
}

/** True when this file is the script being run, so tests can import it without side effects. */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(fileURLToPath(import.meta.url)) === norm(entry);
}

if (isMain()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
