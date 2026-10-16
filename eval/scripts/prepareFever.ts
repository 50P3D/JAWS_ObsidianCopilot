/**
 * Download the labelled FEVER dev set and draw our balanced dev and test samples from it.
 *
 * Usage (from the repo root):
 *   npx tsx eval/scripts/prepareFever.ts
 *   npx tsx eval/scripts/prepareFever.ts --dev 50 --test 300 --seed 201
 *
 * Writes:
 *   eval/datasets/raw/shared_task_dev.jsonl   the full download (about 4 MB, gitignored)
 *   eval/datasets/fever-dev.jsonl             tuning set (committed)
 *   eval/datasets/fever-test.jsonl            frozen test set (committed, run once at the end)
 *
 * Sampling: each split gets about equal Supported, Refuted and Not Enough Info claims, so
 * true and false claims are balanced. The two splits never share a claim. Items are
 * interleaved by label, so `--limit 9` on a run still sees three of each.
 *
 * The same seed and the same download give the same files on every machine. The header of
 * each output file records the seed and the sha256 of the download.
 *
 * FEVER (Thorne et al., 2018) is released under CC BY-SA 3.0, like the Wikipedia text it is built from.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { flagNumber, parseArgs } from "../harness/cli";
import { normaliseLabel } from "../harness/labels";
import { makeRng, shuffle } from "../harness/rng";
import { VERDICTS, type EvalItem, type Split, type Verdict } from "../harness/types";

const FEVER_URL = "https://fever.ai/download/fever/shared_task_dev.jsonl";
const datasetsDir = fileURLToPath(new URL("../datasets/", import.meta.url));
const rawPath = `${datasetsDir}raw/shared_task_dev.jsonl`;

interface FeverRow {
  id: number;
  label: string;
  claim: string;
  evidence: unknown;
}

/** FEVER titles look like "Mercury_-LRB-planet-RRB-". Turn them back into normal titles. */
export function normaliseFeverTitle(t: string): string {
  return t
    .replace(/_/g, " ")
    .replace(/-LRB-/g, "(")
    .replace(/-RRB-/g, ")")
    .replace(/-LSB-/g, "[")
    .replace(/-RSB-/g, "]")
    .replace(/-COLON-/g, ":")
    .trim();
}

/** Evidence is [[[annotation_id, evidence_id, title | null, sentence | null], ...], ...]. */
function evidencePages(evidence: unknown): string[] {
  const titles = new Set<string>();
  if (!Array.isArray(evidence)) return [];
  for (const set of evidence) {
    if (!Array.isArray(set)) continue;
    for (const ev of set) {
      if (Array.isArray(ev) && typeof ev[2] === "string") titles.add(normaliseFeverTitle(ev[2]));
    }
  }
  return [...titles];
}

async function ensureDownload(): Promise<string> {
  try {
    const s = await stat(rawPath);
    if (s.size > 0) {
      console.log(`Using existing download ${rawPath}`);
      return readFile(rawPath, "utf8");
    }
  } catch {
    // not downloaded yet
  }
  console.log(`Downloading ${FEVER_URL} ...`);
  const res = await fetch(FEVER_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  await mkdir(`${datasetsDir}raw`, { recursive: true });
  await writeFile(rawPath, text, "utf8");
  console.log(`Saved ${rawPath} (${(text.length / 1e6).toFixed(1)} MB)`);
  return text;
}

/** Split `n` across the three labels as evenly as possible (remainder goes to Supported, then Refuted). */
function quota(n: number): Record<Verdict, number> {
  const base = Math.floor(n / 3);
  const rem = n - base * 3;
  return {
    Supported: base + (rem > 0 ? 1 : 0),
    Refuted: base + (rem > 1 ? 1 : 0),
    "Not Enough Info": base,
  };
}

/** Round-robin by label so every prefix of the file stays balanced. */
function interleave(byLabel: Record<Verdict, EvalItem[]>): EvalItem[] {
  const out: EvalItem[] = [];
  const max = Math.max(...VERDICTS.map((v) => byLabel[v].length));
  for (let i = 0; i < max; i++) for (const v of VERDICTS) if (byLabel[v][i]) out.push(byLabel[v][i]);
  return out;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const devN = flagNumber(flags, "dev", 50);
  const testN = flagNumber(flags, "test", 300);
  const seed = flagNumber(flags, "seed", 201);

  const text = await ensureDownload();
  const rawSha = createHash("sha256").update(text).digest("hex");

  // Group by label, dropping exact duplicate claim texts.
  const pools: Record<Verdict, FeverRow[]> = { Supported: [], Refuted: [], "Not Enough Info": [] };
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as FeverRow;
    const label = normaliseLabel(row.label);
    const key = row.claim.trim().toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    pools[label].push(row);
  }
  console.log(
    `FEVER dev: ${VERDICTS.map((v) => `${pools[v].length} ${v}`).join(", ")} (sha256 ${rawSha.slice(0, 12)})`,
  );

  const rng = makeRng(seed);
  const shuffled = Object.fromEntries(VERDICTS.map((v) => [v, shuffle(pools[v], rng)])) as Record<Verdict, FeverRow[]>;

  const qDev = quota(devN);
  const qTest = quota(testN);
  const build = (split: Split, from: (v: Verdict) => FeverRow[]) => {
    const byLabel = {} as Record<Verdict, EvalItem[]>;
    for (const v of VERDICTS) {
      byLabel[v] = from(v).map((r) => {
        const item: EvalItem = { id: `fever-${r.id}`, claim: r.claim.trim(), label: v, source: "fever", split };
        const pages = evidencePages(r.evidence);
        if (pages.length) item.evidence_pages = pages;
        return item;
      });
    }
    return interleave(byLabel);
  };

  for (const v of VERDICTS) {
    if (shuffled[v].length < qDev[v] + qTest[v]) throw new Error(`Not enough ${v} claims for the requested sizes`);
  }
  const dev = build("dev", (v) => shuffled[v].slice(0, qDev[v]));
  const test = build("test", (v) => shuffled[v].slice(qDev[v], qDev[v] + qTest[v]));

  const header = (split: Split, n: number) =>
    [
      `// FEVER shared_task_dev sample, split=${split}, n=${n}, seed=${seed}, balanced by label.`,
      `// Source: ${FEVER_URL} (sha256 ${rawSha}). CC BY-SA 3.0. Regenerate: npx tsx eval/scripts/prepareFever.ts`,
      `// evidence_pages are titles from FEVER's 2017 Wikipedia dump and may have been renamed since.`,
    ].join("\n");

  const write = async (name: string, split: Split, items: EvalItem[]) => {
    const body = header(split, items.length) + "\n" + items.map((i) => JSON.stringify(i)).join("\n") + "\n";
    await writeFile(`${datasetsDir}${name}`, body, "utf8");
    const counts = VERDICTS.map((v) => `${items.filter((i) => i.label === v).length} ${v}`).join(", ");
    console.log(`Wrote eval/datasets/${name}: ${counts}`);
  };
  await write("fever-dev.jsonl", "dev", dev);
  await write("fever-test.jsonl", "test", test);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
