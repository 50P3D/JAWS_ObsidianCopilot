/**
 * Run one system over one dataset split and save the scored predictions plus a report.
 *
 * Usage (from the repo root):
 *   npx tsx eval/harness/run.ts --system constant:Supported
 *   npx tsx eval/harness/run.ts --system no-rag --model qwen3.5:9b
 *   npx tsx eval/harness/run.ts --system minicheck --retrieval-mode hybrid --nei-threshold 0.5
 *   npx tsx eval/harness/run.ts --system pipeline
 *
 * Options:
 *   --system    constant:<label> | no-rag | minicheck | pipeline   (required)
 *   --dataset   JSONL file. Default eval/datasets/fever-dev.jsonl
 *   --split     dev (default) or test. test also needs --final and is logged
 *   --final     confirm a run on the frozen test split
 *   --limit     only the first N items (files are interleaved by label, so prefixes stay balanced)
 *   --source    only items from fever, notes or generated
 *   --out       output folder. Default eval/results
 *
 * Writes eval/results/<run_id>.json (every prediction) and <run_id>.md (the report).
 * Runs are sequential on purpose: Ollama serves one model at a time on a laptop.
 */

import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { flagBool, flagNumber, parseArgs } from "./cli";
import { assertSplitAllowed, loadDataset, logTestRun } from "./dataset";
import { renderReport, summaryLine } from "./report";
import { createSystem, SYSTEM_NAMES } from "./systems";
import type { Prediction, RunFile, Split } from "./types";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDataset = fileURLToPath(new URL("../datasets/fever-dev.jsonl", import.meta.url));
const defaultOut = fileURLToPath(new URL("../results/", import.meta.url));

function gitCommit(): string | null {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const slug = (s: string) => s.replace(/[^a-zA-Z0-9.]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.system || flags.system === "true") {
    console.error(`--system is required: ${SYSTEM_NAMES.join(", ")}`);
    process.exit(2);
  }
  const split = (flags.split ?? "dev") as Split;
  if (split !== "dev" && split !== "test") throw new Error("--split must be dev or test");
  const final = flagBool(flags, "final");
  assertSplitAllowed(split, final);

  const datasetPath = flags.dataset ?? defaultDataset;
  const dataset = await loadDataset(datasetPath);
  let items = dataset.items.filter((i) => i.split === split);
  if (flags.source) items = items.filter((i) => i.source === flags.source);
  const limit = flagNumber(flags, "limit", 0);
  if (limit > 0) items = items.slice(0, limit);
  if (items.length === 0) throw new Error(`No items with split=${split}${flags.source ? ` and source=${flags.source}` : ""} in ${datasetPath}`);

  const system = createSystem(flags.system, flags);
  const problem = await system.setup?.();
  if (problem) {
    console.error(`Setup problem: ${problem}`);
    process.exit(1);
  }

  const started = new Date();
  const runId = `${stamp(started)}_${slug(system.info.name)}${system.info.model ? `_${slug(system.info.model)}` : ""}_${split}`;
  const relDataset = relative(repoRoot, datasetPath).replace(/\\/g, "/");
  console.log(`Run ${runId}: ${items.length} claims from ${relDataset} (${split})`);

  const predictions: Prediction[] = [];
  for (const [n, item] of items.entries()) {
    const t0 = performance.now();
    let row: Prediction;
    try {
      const out = await system.check(item);
      row = {
        id: item.id,
        claim: item.claim,
        gold: item.label,
        source: item.source,
        predicted: out.verdict,
        correct: out.verdict === item.label,
        ms: Math.round(performance.now() - t0),
        explanation: out.explanation,
        raw: out.raw,
        evidence: out.evidence?.map((e) => ({ page_title: e.page_title, revision_id: e.revision_id, retrieval_score: e.retrieval_score })),
        extra: out.extra,
      };
    } catch (e) {
      row = {
        id: item.id,
        claim: item.claim,
        gold: item.label,
        source: item.source,
        predicted: null,
        correct: false,
        ms: Math.round(performance.now() - t0),
        error: e instanceof Error ? e.message : String(e),
      };
    }
    predictions.push(row);
    const mark = row.error ? "E" : row.predicted === null ? "?" : row.correct ? "." : "x";
    process.stdout.write(mark + ((n + 1) % 50 === 0 ? ` ${n + 1}\n` : ""));
  }
  process.stdout.write("\n");

  const run: RunFile = {
    run_id: runId,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    git_commit: gitCommit(),
    system: system.info,
    dataset: { path: relDataset, sha256: dataset.sha256, split, count: items.length },
    predictions,
  };

  const outDir = flags.out ?? defaultOut;
  await mkdir(outDir, { recursive: true });
  const jsonPath = `${outDir.replace(/[\\/]$/, "")}/${runId}.json`;
  const mdPath = `${outDir.replace(/[\\/]$/, "")}/${runId}.md`;
  await writeFile(jsonPath, JSON.stringify(run, null, 2) + "\n", "utf8");
  await writeFile(mdPath, renderReport(run), "utf8");

  if (split === "test") {
    await logTestRun(
      `${outDir.replace(/[\\/]$/, "")}/TEST_RUNS.md`,
      `| ${run.finished_at} | ${runId} | ${system.info.name} | ${system.info.model ?? ""} | ${dataset.sha256.slice(0, 12)} | ${items.length} |`,
    );
  }

  console.log(summaryLine(run));
  const errors = predictions.filter((p) => p.error).length;
  if (errors) console.log(`${errors} claims failed with an error. See the report for messages.`);
  console.log(`Saved ${relative(repoRoot, jsonPath)} and ${relative(repoRoot, mdPath)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
