/**
 * Turn a run file into a markdown report: headline numbers with 95% intervals, the
 * confusion matrix, per-label scores, and every failure, so the checkpoint can document them.
 */

import { bootstrap, COLUMNS, verdictMetrics, type Scored, type VerdictMetrics } from "./metrics";
import { VERDICTS, type ItemSource, type Prediction, type RunFile } from "./types";

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const f3 = (x: number) => x.toFixed(3);

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const short = (v: string) => (v === "Not Enough Info" ? "NEI" : v);

function metricsBlock(rows: Prediction[]): string {
  const scored: Scored[] = rows.map((r) => ({ gold: r.gold, predicted: r.predicted }));
  const m: VerdictMetrics = verdictMetrics(scored);
  const f1ci = bootstrap(scored, (r) => verdictMetrics(r).macro_f1);
  const accci = bootstrap(scored, (r) => verdictMetrics(r).accuracy);
  const ms = rows.map((r) => r.ms);

  const lines: string[] = [];
  lines.push("| Metric | Value | 95% interval |", "|---|---|---|");
  lines.push(`| Macro-F1 (${m.macro_labels.map(short).join(", ")}) | ${f3(m.macro_f1)} | ${f3(f1ci.low)} to ${f3(f1ci.high)} |`);
  lines.push(`| Accuracy | ${pct(m.accuracy)} | ${pct(accci.low)} to ${pct(accci.high)} |`);
  lines.push(`| False-flag rate (true claims called Refuted) | ${pct(m.false_flag_rate)} | |`);
  lines.push(`| Miss rate (false claims not called Refuted) | ${pct(m.miss_rate)} | |`);
  lines.push(`| Invalid or failed outputs | ${m.invalid} of ${m.count} | |`);
  lines.push(`| Latency per claim, median / p90 | ${Math.round(quantile(ms, 0.5))} ms / ${Math.round(quantile(ms, 0.9))} ms | |`);

  lines.push("", "Per label", "", "| Gold label | Support | Precision | Recall | F1 |", "|---|---|---|---|---|");
  for (const v of VERDICTS) {
    const c = m.per_class[v];
    lines.push(`| ${v} | ${c.support} | ${f3(c.precision)} | ${f3(c.recall)} | ${f3(c.f1)} |`);
  }

  lines.push("", "Confusion matrix (rows are gold, columns are predicted)", "");
  lines.push(`| gold \\ predicted | ${COLUMNS.map(short).join(" | ")} |`, `|---|${COLUMNS.map(() => "---").join("|")}|`);
  for (const g of VERDICTS) lines.push(`| ${short(g)} | ${COLUMNS.map((c) => m.confusion[g][c]).join(" | ")} |`);
  return lines.join("\n");
}

function failureList(rows: Prediction[]): string {
  const wrong = rows.filter((r) => !r.correct);
  if (wrong.length === 0) return "None.";
  const order = (r: Prediction) => `${r.gold}|${r.predicted ?? "~"}`;
  wrong.sort((a, b) => order(a).localeCompare(order(b)));
  const out: string[] = [];
  for (const r of wrong) {
    out.push(`- **${r.id}** gold ${short(r.gold)}, predicted ${r.predicted ? short(r.predicted) : "INVALID"}: "${r.claim}"`);
    if (r.error) out.push(`  - error: ${r.error}`);
    if (r.explanation) out.push(`  - model said: ${r.explanation.replace(/\s+/g, " ").slice(0, 300)}`);
    else if (r.raw && !r.predicted) out.push(`  - raw output: ${r.raw.replace(/\s+/g, " ").slice(0, 300)}`);
    if (r.evidence?.length) out.push(`  - evidence pages: ${r.evidence.map((e) => e.page_title).join(", ")}`);
  }
  return out.join("\n");
}

const caveats = (n: number) => `- **Small sample.** The intervals above come from 2000 bootstrap resamples. With ${n} claims, one claim moves accuracy by ${(100 / Math.max(1, n)).toFixed(1)} points. Treat differences inside the interval as noise.
- **FEVER may be contaminated.** FEVER was published in 2018 from a 2017 Wikipedia dump and is almost certainly in the training data of current models. A high no-RAG score may be memory, not reasoning. Our own-notes and generated claims are the check on this.
- **FEVER "Not Enough Info" is about the 2017 dump, not the world.** Many NEI claims are plainly true or false to a reader (or to today's Wikipedia). A system that answers them correctly is scored as wrong. Read the NEI failures before blaming the model.
- **Wikipedia has changed since 2017.** Retrieval reads today's pages, so a few gold labels may no longer match the evidence.`;

export function renderReport(run: RunFile): string {
  const p = run.predictions;
  const sources = [...new Set(p.map((r) => r.source))] as ItemSource[];
  const parts: string[] = [];
  parts.push(`# Evaluation run ${run.run_id}`, "");
  parts.push(`- System: \`${run.system.name}\`${run.system.model ? `, model \`${run.system.model}\`` : ""}${run.system.family ? ` (family ${run.system.family})` : ""}`);
  parts.push(`- Config: \`${JSON.stringify(run.system.config)}\``);
  parts.push(`- Dataset: \`${run.dataset.path}\`, split **${run.dataset.split}**, ${run.dataset.count} claims, sha256 \`${run.dataset.sha256.slice(0, 12)}\``);
  parts.push(`- Git commit: \`${run.git_commit ?? "unknown"}\``);
  parts.push(`- Started ${run.started_at}, finished ${run.finished_at}`, "");
  parts.push("## Results (all claims)", "", metricsBlock(p), "");
  const sr = p.filter((r) => r.gold !== "Not Enough Info");
  if (sr.length > 0 && sr.length < p.length) {
    parts.push(
      "## Results: gold Supported and Refuted claims only",
      "",
      "Drops the gold Not Enough Info claims (see the caveat on FEVER NEI below). Predictions are still three-way, so answering NEI here counts as wrong.",
      "",
      metricsBlock(sr),
      "",
    );
  }
  if (sources.length > 1) {
    for (const s of sources) {
      parts.push(`## Results: ${s} claims only`, "", metricsBlock(p.filter((r) => r.source === s)), "");
    }
  }
  parts.push("## Failures", "", failureList(p), "");
  parts.push("## Caveats", "", caveats(p.length), "");
  return parts.join("\n");
}

/** One line for the terminal. */
export function summaryLine(run: RunFile): string {
  const m = verdictMetrics(run.predictions.map((r) => ({ gold: r.gold, predicted: r.predicted })));
  return `${run.system.name}${run.system.model ? ` (${run.system.model})` : ""}: macro-F1 ${f3(m.macro_f1)}, accuracy ${pct(m.accuracy)}, false-flag ${pct(m.false_flag_rate)}, miss ${pct(m.miss_rate)}, invalid ${m.invalid}/${m.count}`;
}
