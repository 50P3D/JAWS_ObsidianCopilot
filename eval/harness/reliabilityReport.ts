/**
 * Turn a reliability run file into a markdown report: Low-flag precision, recall, F1 and flag
 * rate with 95% intervals, the TP/FP/FN/TN counts, per-rule firing counts split by gold label,
 * Unavailable counts per signal, errors, and every false positive and false negative.
 *
 * Gold positive = the revision was later reverted. Predicted positive = the badge was Low.
 * A row with an error has predicted_low false, so it counts as not flagged (Requirement 10.9).
 */

import { RULE_IDS } from "../../src/reliability/combine";
import { isUnavailable, type Signals } from "../../src/reliability/types";
import { binaryMetrics, bootstrap, type BinaryMetrics, type BinaryRow, type Interval } from "./metrics";
import type { ReliabilityPrediction, ReliabilityRunFile } from "./reliabilityDataset";
import { f3, pct, quantile } from "./report";

const SEED = 201;
const SIGNAL_KEYS: readonly (keyof Signals)[] = ["maintenance", "editActivity", "revertRisk", "citations"];

export const revisionLink = (revId: number) => `https://en.wikipedia.org/w/index.php?oldid=${revId}`;

/** Map predictions to binaryMetrics rows: gold = reverted, predicted = flagged Low. */
export const toBinaryRows = (rows: readonly ReliabilityPrediction[]): BinaryRow[] =>
  rows.map((r) => ({ gold: r.gold_reverted, predicted: r.predicted_low }));

export interface ReliabilityMetrics extends BinaryMetrics {
  intervals: { precision: Interval; recall: Interval; f1: Interval; flag_rate: Interval };
  errors: number;
}

/** Low-flag metrics with seeded 95% bootstrap intervals. Shared by the runner, tuner and tests. */
export function reliabilityMetrics(rows: readonly ReliabilityPrediction[]): ReliabilityMetrics {
  const b = toBinaryRows(rows);
  const ci = (stat: (m: BinaryMetrics) => number) => bootstrap(b, (r) => stat(binaryMetrics(r)), { seed: SEED });
  return {
    ...binaryMetrics(b),
    intervals: {
      precision: ci((m) => m.precision),
      recall: ci((m) => m.recall),
      f1: ci((m) => m.f1),
      flag_rate: ci((m) => m.flag_rate),
    },
    errors: rows.filter((r) => r.error).length,
  };
}

function metricsBlock(rows: ReliabilityPrediction[]): string {
  const m = reliabilityMetrics(rows);
  const ms = rows.map((r) => r.ms);
  const goldPos = m.tp + m.fn;
  const row = (name: string, iv: Interval, fmt: (x: number) => string) =>
    `| ${name} | ${fmt(iv.value)} | ${fmt(iv.low)} to ${fmt(iv.high)} |`;

  const lines: string[] = [];
  lines.push("| Metric | Value | 95% interval |", "|---|---|---|");
  lines.push(row("Precision (Low flags that were reverted)", m.intervals.precision, f3));
  lines.push(row("Recall (reverted revisions flagged Low)", m.intervals.recall, f3));
  lines.push(row("F1", m.intervals.f1, f3));
  lines.push(row("Flag rate (share of revisions flagged Low)", m.intervals.flag_rate, pct));
  lines.push(`| Revisions (reverted / stable) | ${m.count} (${goldPos} / ${m.count - goldPos}) | |`);
  lines.push(`| Errors (counted as not flagged) | ${m.errors} of ${m.count} | |`);
  lines.push(`| Latency per revision, median / p90 | ${Math.round(quantile(ms, 0.5))} ms / ${Math.round(quantile(ms, 0.9))} ms | |`);

  lines.push("", "Confusion counts (positive = reverted / flagged Low)", "");
  lines.push("| gold \\ predicted | Low | not Low |", "|---|---|---|");
  lines.push(`| reverted | TP ${m.tp} | FN ${m.fn} |`);
  lines.push(`| stable | FP ${m.fp} | TN ${m.tn} |`);
  return lines.join("\n");
}

function ruleCounts(rows: ReliabilityPrediction[]): string {
  const ids = [...RULE_IDS, ...new Set(rows.flatMap((r) => r.rules).filter((id) => !RULE_IDS.includes(id as never)))];
  const count = (id: string, gold: boolean) => rows.filter((r) => r.gold_reverted === gold && r.rules.includes(id)).length;
  const fired = ids.filter((id) => rows.some((r) => r.rules.includes(id)));
  if (fired.length === 0) return "No rule fired on any revision.";
  const lines = ["| Rule | Fired on reverted | Fired on stable |", "|---|---|---|"];
  for (const id of ids) lines.push(`| \`${id}\` | ${count(id, true)} | ${count(id, false)} |`);
  return lines.join("\n");
}

function unavailableCounts(rows: ReliabilityPrediction[]): string {
  const withSignals = rows.filter((r) => r.signals);
  if (withSignals.length === 0) return "No signals were recorded for this system.";
  const lines = [
    `Out of ${withSignals.length} revisions with recorded signals.`,
    "",
    "| Signal | Unavailable on reverted | Unavailable on stable | Most common cause |",
    "|---|---|---|---|",
  ];
  for (const key of SIGNAL_KEYS) {
    const causes = new Map<string, number>();
    let rev = 0, stable = 0;
    for (const r of withSignals) {
      const s = r.signals![key];
      if (!isUnavailable(s)) continue;
      if (r.gold_reverted) rev++;
      else stable++;
      causes.set(s.cause, (causes.get(s.cause) ?? 0) + 1);
    }
    const top = [...causes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    lines.push(`| ${key} | ${rev} | ${stable} | ${top ? `${top[0].replace(/\|/g, "\\|")} (${top[1]})` : ""} |`);
  }
  return lines.join("\n");
}

function errorList(rows: ReliabilityPrediction[]): string {
  const errs = rows.filter((r) => r.error);
  if (errs.length === 0) return "None.";
  return errs
    .map((r) => `- **${r.id}** [${r.page_title}](${revisionLink(r.rev_id)}), gold ${r.gold_reverted ? "reverted" : "stable"}: ${r.error!.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
}

function failureList(rows: ReliabilityPrediction[], gold: boolean): string {
  const wrong = rows.filter((r) => r.gold_reverted === gold && r.predicted_low !== gold);
  if (wrong.length === 0) return "None.";
  const out: string[] = [];
  for (const r of wrong) {
    out.push(`- **${r.id}** [${r.page_title}](${revisionLink(r.rev_id)}), badge ${r.badge ?? "none (error)"}${r.rules.length ? `, rules ${r.rules.map((id) => `\`${id}\``).join(", ")}` : ""}`);
    if (r.error) out.push(`  - error: ${r.error.replace(/\s+/g, " ").slice(0, 300)}`);
    for (const reason of r.reasons) out.push(`  - ${reason}`);
  }
  return out.join("\n");
}

const caveats = (n: number) => `- **Small sample.** The intervals above come from 2000 bootstrap resamples (seed ${SEED}). With ${n} revisions, one revision moves recall or precision by several points. Treat differences inside the interval as noise.
- **The gold label is incomplete.** \`mw-reverted\` only marks reverts that MediaWiki detects (rollback, undo, exact manual revert), so some "stable" edits may have been undone by hand.
- **Labels can change.** A stable edit could still be reverted after it was sampled.
- **Evaluation time is not live time.** The evaluation scores each edit as of its own save time, while live use scores the current revision. Recency signals therefore behave differently in the two settings. This does not affect the Low flag, because recency only produces Medium.
- **Lift Wing is a strong baseline.** Lift Wing is itself trained on revert data, so \`revert-risk-only\` is a strong baseline. The interesting question is whether the rules add precision or recall beyond it.
- **Lift Wing internals were not checked.** Which features Lift Wing uses internally was not checked. NoteCheck only uses the revision-level probability and never shows or stores editor information.`;

export function renderReliabilityReport(run: ReliabilityRunFile): string {
  const p = run.predictions;
  const parts: string[] = [];
  parts.push(`# Reliability evaluation run ${run.run_id}`, "");
  parts.push(`- System: \`${run.system.name}\`, Lift Wing ${run.system.liftwing ? "on" : "off"}`);
  if (run.system.thresholds) parts.push(`- Thresholds: \`${JSON.stringify(run.system.thresholds)}\``);
  parts.push(`- Dataset: \`${run.dataset.path}\`, split **${run.dataset.split}**, ${run.dataset.count} revisions, sha256 \`${run.dataset.sha256.slice(0, 12)}\``);
  parts.push(`- Git commit: \`${run.git_commit ?? "unknown"}\``);
  parts.push(`- Started ${run.started_at}, finished ${run.finished_at}`, "");
  parts.push("## Low flag against \"was reverted\"", "", metricsBlock(p), "");
  parts.push("## Rule firing counts", "", ruleCounts(p), "");
  parts.push("## Unavailable signals", "", unavailableCounts(p), "");
  parts.push("## Errors", "", errorList(p), "");
  parts.push("## False positives (flagged Low, not reverted)", "", failureList(p, false), "");
  parts.push("## False negatives (reverted, not flagged Low)", "", failureList(p, true), "");
  parts.push("## Caveats", "", caveats(p.length), "");
  return parts.join("\n");
}

/** One line for the terminal. */
export function reliabilitySummaryLine(run: ReliabilityRunFile): string {
  const m = reliabilityMetrics(run.predictions);
  const iv = (i: Interval) => `${f3(i.value)} [${f3(i.low)}, ${f3(i.high)}]`;
  return `${run.system.name}${run.system.liftwing ? "" : " (Lift Wing off)"}: precision ${iv(m.intervals.precision)}, recall ${iv(m.intervals.recall)}, F1 ${f3(m.f1)}, flag rate ${pct(m.flag_rate)}, TP/FP/FN/TN ${m.tp}/${m.fp}/${m.fn}/${m.tn}, errors ${m.errors}/${m.count}`;
}
