/**
 * Run one reliability system over one revision dataset split and save the scored rows plus a report.
 *
 * Usage (from the repo root):
 *   npx tsx eval/harness/reliabilityRun.ts --system flag-nothing
 *   npx tsx eval/harness/reliabilityRun.ts --system revert-risk-only
 *   npx tsx eval/harness/reliabilityRun.ts --system scorer --liftwing off
 *   npx tsx eval/harness/reliabilityRun.ts --system scorer --split test --final --risk-low 0.8
 *
 * Options:
 *   --system    flag-nothing | revert-risk-only | scorer   (required)
 *   --dataset   JSONL file. Default eval/datasets/reliability-dev.jsonl,
 *               or eval/datasets/reliability-test.jsonl with --split test
 *   --split     dev (default) or test. test also needs --final and is logged in TEST_RUNS.md
 *   --final     confirm a run on the frozen test split
 *   --limit     only the first N rows (files are interleaved by label, so prefixes stay balanced)
 *   --liftwing  on (default) or off. off skips the Lift Wing revert-risk request
 *   --risk-low  override the Low revert-risk threshold (revertRiskLow), a number in [0, 1]
 *   --out       output folder. Default eval/results
 *
 * Writes <out>/<run_id>.json (every row with its signals and reasons, the thresholds and every
 * setting) and <out>/<run_id>.md (the report). Gold positive = reverted, predicted positive =
 * badge Low. A row that fails is saved with its error, badge null and predicted_low false, so it
 * counts as not flagged. Rows run one after another to stay polite to the Wikimedia APIs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flagBool, flagNumber, parseArgs } from "./cli";
import { assertSplitAllowed, logTestRun } from "./dataset";
import { gitCommit } from "./git";
import {
  loadRevisionDataset,
  type ReliabilityPrediction,
  type ReliabilityRunFile,
  type ReliabilityRunSettings,
  type ReliabilitySystemName,
} from "./reliabilityDataset";
import { reliabilitySummaryLine, renderReliabilityReport } from "./reliabilityReport";
import { createReliabilitySystem, RELIABILITY_SYSTEM_NAMES, type ReliabilitySystemOptions } from "./reliabilitySystems";
import type { Split } from "./types";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDatasets: Record<Split, string> = {
  dev: fileURLToPath(new URL("../datasets/reliability-dev.jsonl", import.meta.url)),
  test: fileURLToPath(new URL("../datasets/reliability-test.jsonl", import.meta.url)),
};
const defaultOut = fileURLToPath(new URL("../results/", import.meta.url));

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const slug = (s: string) => s.replace(/[^a-zA-Z0-9.]+/g, "-").replace(/^-|-$/g, "");
const rel = (p: string) => relative(repoRoot, resolve(p)).replace(/\\/g, "/");

async function main() {
  const argv = process.argv.slice(2);
  const { flags } = parseArgs(argv);
  if (!flags.system || flags.system === "true") {
    console.error(`--system is required: ${RELIABILITY_SYSTEM_NAMES.join(", ")}`);
    process.exit(2);
  }
  if (!RELIABILITY_SYSTEM_NAMES.includes(flags.system as ReliabilitySystemName)) {
    throw new Error(`Unknown reliability system "${flags.system}". Choose one of: ${RELIABILITY_SYSTEM_NAMES.join(", ")}`);
  }
  const systemName = flags.system as ReliabilitySystemName;

  // Guard the frozen test split before touching any file (Requirement 10.7).
  const split = (flags.split ?? "dev") as Split;
  if (split !== "dev" && split !== "test") throw new Error("--split must be dev or test");
  const final = flagBool(flags, "final");
  assertSplitAllowed(split, final);

  const liftwingFlag = flags.liftwing === undefined ? null : flags.liftwing;
  if (liftwingFlag !== null && liftwingFlag !== "on" && liftwingFlag !== "off") {
    throw new Error(`--liftwing must be on or off, got "${liftwingFlag}"`);
  }
  const riskLow = flags["risk-low"] === undefined ? null : flagNumber(flags, "risk-low", NaN);
  if (riskLow !== null && (riskLow < 0 || riskLow > 1)) throw new Error(`--risk-low must be between 0 and 1, got ${riskLow}`);
  const limit = flagNumber(flags, "limit", 0);
  if (limit < 0 || !Number.isInteger(limit)) throw new Error(`--limit must be a non-negative integer, got ${limit}`);

  const datasetPath = flags.dataset ?? defaultDatasets[split];
  const dataset = await loadRevisionDataset(datasetPath);
  // A dev run must never read test rows, and the other way round: the file must match the split.
  const mismatched = dataset.items.filter((i) => i.split !== split);
  if (mismatched.length > 0) {
    throw new Error(
      `${datasetPath}: ${mismatched.length} of ${dataset.items.length} rows have a split other than ${split} ` +
        `(first: ${mismatched[0].id}, split ${mismatched[0].split}). Use the matching --split or dataset file.`,
    );
  }
  let items = dataset.items;
  if (limit > 0) items = items.slice(0, limit);
  if (items.length === 0) throw new Error(`No rows with split=${split} in ${datasetPath}`);

  const systemOpts: ReliabilitySystemOptions = {
    liftWing: liftwingFlag === "off" ? false : undefined,
    thresholds: riskLow === null ? undefined : { revertRiskLow: riskLow },
  };
  const system = createReliabilitySystem(systemName, systemOpts);

  const outDir = (flags.out ?? defaultOut).replace(/[\\/]$/, "");
  const settings: ReliabilityRunSettings = {
    argv,
    system: systemName,
    dataset: rel(datasetPath),
    split,
    final,
    limit: limit > 0 ? limit : null,
    liftwing_flag: liftwingFlag,
    liftwing_env: process.env.NOTECHECK_LIFTWING ?? null,
    risk_low: riskLow,
    out: rel(outDir),
  };

  const started = new Date();
  // flag-nothing never calls Lift Wing, so the "liftwing-off" tag only marks systems that would.
  const liftwingTag = system.info.name !== "flag-nothing" && !system.info.liftwing ? "_liftwing-off" : "";
  const runId = `${stamp(started)}_reliability-${slug(system.info.name)}${liftwingTag}_${split}`;
  console.log(`Run ${runId}: ${items.length} revisions from ${settings.dataset} (${split})`);

  const predictions: ReliabilityPrediction[] = [];
  for (const [n, item] of items.entries()) {
    const t0 = performance.now();
    let row: ReliabilityPrediction;
    try {
      // The system sees only the id, revision id, title and timestamp, never the gold label.
      const out = await system.check({ id: item.id, rev_id: item.rev_id, page_title: item.page_title, timestamp: item.timestamp });
      row = {
        id: item.id,
        rev_id: item.rev_id,
        page_title: item.page_title,
        gold_reverted: item.reverted,
        badge: out.badge,
        predicted_low: out.badge === "Low",
        reasons: out.reasons,
        rules: out.rules,
        signals: out.signals,
        ms: Math.round(performance.now() - t0),
      };
    } catch (e) {
      // Requirement 10.9: keep the error on the row and count it as not flagged.
      row = {
        id: item.id,
        rev_id: item.rev_id,
        page_title: item.page_title,
        gold_reverted: item.reverted,
        badge: null,
        predicted_low: false,
        reasons: [],
        rules: [],
        ms: Math.round(performance.now() - t0),
        error: e instanceof Error ? e.message : String(e),
      };
    }
    predictions.push(row);
    const mark = row.error ? "E" : row.predicted_low === row.gold_reverted ? "." : "x";
    process.stdout.write(mark + ((n + 1) % 50 === 0 ? ` ${n + 1}\n` : ""));
  }
  process.stdout.write("\n");

  const run: ReliabilityRunFile = {
    run_id: runId,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    git_commit: gitCommit(),
    system: system.info,
    dataset: { path: settings.dataset, sha256: dataset.sha256, split, count: items.length },
    settings,
    predictions,
  };

  await mkdir(outDir, { recursive: true });
  const jsonPath = `${outDir}/${runId}.json`;
  const mdPath = `${outDir}/${runId}.md`;
  await writeFile(jsonPath, JSON.stringify(run, null, 2) + "\n", "utf8");
  await writeFile(mdPath, renderReliabilityReport(run), "utf8");

  if (split === "test") {
    // Same log as the verdict runs. The Model column carries the reliability settings instead.
    const detail = `Lift Wing ${system.info.liftwing ? "on" : "off"}${system.info.thresholds ? `, revertRiskLow ${system.info.thresholds.revertRiskLow}` : ""}`;
    await logTestRun(
      `${outDir}/TEST_RUNS.md`,
      `| ${run.finished_at} | ${runId} | reliability:${system.info.name} | ${detail} | ${dataset.sha256.slice(0, 12)} | ${items.length} |`,
    );
  }

  console.log(reliabilitySummaryLine(run));
  const errors = predictions.filter((p) => p.error).length;
  if (errors) console.log(`${errors} revisions failed with an error. They count as not flagged. See the report for messages.`);
  console.log(`Saved ${rel(jsonPath)} and ${rel(mdPath)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
