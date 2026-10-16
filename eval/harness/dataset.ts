/**
 * Load and check dataset files, and guard the frozen test split.
 *
 * Dataset files are JSONL: one EvalItem per line. Blank lines and lines starting
 * with "//" are ignored so a file can carry a short header comment.
 */

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { VERDICTS, type EvalItem, type ItemSource, type Split } from "./types";

const SOURCES: ItemSource[] = ["fever", "notes", "generated"];
const SPLITS: Split[] = ["dev", "test"];

export interface LoadedDataset {
  path: string;
  sha256: string;
  items: EvalItem[];
}

export function parseDataset(text: string, path = "<memory>"): EvalItem[] {
  const items: EvalItem[] = [];
  const ids = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return;
    const where = `${path}:${i + 1}`;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    if (typeof obj.id !== "string" || !obj.id) throw new Error(`${where}: missing "id"`);
    if (ids.has(obj.id)) throw new Error(`${where}: duplicate id "${obj.id}"`);
    if (typeof obj.claim !== "string" || !obj.claim.trim()) throw new Error(`${where}: missing "claim"`);
    if (!VERDICTS.includes(obj.label)) {
      throw new Error(`${where}: "label" must be one of ${VERDICTS.join(", ")}, got ${JSON.stringify(obj.label)}`);
    }
    if (!SOURCES.includes(obj.source)) throw new Error(`${where}: "source" must be one of ${SOURCES.join(", ")}`);
    if (!SPLITS.includes(obj.split)) throw new Error(`${where}: "split" must be dev or test`);
    ids.add(obj.id);
    items.push(obj as EvalItem);
  });
  return items;
}

export async function loadDataset(path: string): Promise<LoadedDataset> {
  const text = await readFile(path, "utf8");
  return {
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
    items: parseDataset(text, path),
  };
}

/**
 * The test split is for the final numbers only. Running it needs an explicit --final,
 * and every such run is appended to a log that lives in git, so repeated peeking shows up.
 */
export function assertSplitAllowed(split: Split, final: boolean): void {
  if (split === "test" && !final) {
    throw new Error(
      "Refusing to run the test split without --final. Tune on --split dev. " +
        "Run the test split once, at the end, and the run is logged in eval/results/TEST_RUNS.md.",
    );
  }
}

export async function logTestRun(logPath: string, line: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  let exists = true;
  try {
    await stat(logPath);
  } catch {
    exists = false;
  }
  const header = exists
    ? ""
    : "# Test split runs\n\nEvery run on the frozen test split is appended here automatically. " +
      "The test set should be run once per system for the final report. More rows than that means we peeked.\n\n" +
      "| When (UTC) | Run id | System | Model | Dataset sha256 | Count |\n|---|---|---|---|---|---|\n";
  await appendFile(logPath, header + line + "\n", "utf8");
}
