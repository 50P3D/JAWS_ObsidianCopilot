/**
 * Metrics for the evaluation. Pure functions, no I/O.
 *
 * Verdicts (the headline metric in the proposal):
 *   macro-F1 over the three labels, plus per-label precision, recall and F1,
 *   accuracy, and two rates the instructor asked for on balanced data:
 *     false_flag_rate  share of true (Supported) claims the system calls Refuted
 *     miss_rate        share of false (Refuted) claims the system does not call Refuted
 *
 * Reliability flags:
 *   precision and recall of the Low badge against "this revision was reverted".
 *
 * Conventions (match scikit-learn's zero_division=0):
 *   - A division by zero gives 0.
 *   - An unparseable prediction (null) counts as wrong. It lowers recall of the gold
 *     label but does not count as a prediction of any label.
 *   - macro-F1 averages over labels that appear in the gold data. A subset with no
 *     Not Enough Info claims is averaged over two labels, and the report says so.
 */

import { makeRng } from "./rng";
import { VERDICTS, type Verdict } from "./types";

export interface Scored {
  gold: Verdict;
  predicted: Verdict | null;
}

export type PredictedColumn = Verdict | "Invalid";
export const COLUMNS: readonly PredictedColumn[] = [...VERDICTS, "Invalid"];

/** matrix[gold][predicted] = count */
export type Confusion = Record<Verdict, Record<PredictedColumn, number>>;

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  /** Number of gold items with this label. */
  support: number;
}

export interface VerdictMetrics {
  count: number;
  accuracy: number;
  macro_f1: number;
  /** Labels that were averaged in macro_f1. */
  macro_labels: Verdict[];
  per_class: Record<Verdict, ClassMetrics>;
  false_flag_rate: number;
  miss_rate: number;
  invalid: number;
  confusion: Confusion;
}

const div = (n: number, d: number) => (d === 0 ? 0 : n / d);
const f1 = (p: number, r: number) => (p + r === 0 ? 0 : (2 * p * r) / (p + r));

export function confusion(rows: readonly Scored[]): Confusion {
  const m = {} as Confusion;
  for (const g of VERDICTS) {
    m[g] = {} as Record<PredictedColumn, number>;
    for (const c of COLUMNS) m[g][c] = 0;
  }
  for (const r of rows) m[r.gold][r.predicted ?? "Invalid"] += 1;
  return m;
}

export function verdictMetrics(rows: readonly Scored[]): VerdictMetrics {
  const m = confusion(rows);
  const per_class = {} as Record<Verdict, ClassMetrics>;
  for (const c of VERDICTS) {
    const tp = m[c][c];
    const predictedC = VERDICTS.reduce((a, g) => a + m[g][c], 0);
    const goldC = COLUMNS.reduce((a, p) => a + m[c][p], 0);
    const precision = div(tp, predictedC);
    const recall = div(tp, goldC);
    per_class[c] = { precision, recall, f1: f1(precision, recall), support: goldC };
  }
  const macro_labels = VERDICTS.filter((c) => per_class[c].support > 0);
  const macro_f1 = div(
    macro_labels.reduce((a, c) => a + per_class[c].f1, 0),
    macro_labels.length,
  );
  const correct = VERDICTS.reduce((a, c) => a + m[c][c], 0);
  const goldSupported = per_class.Supported.support;
  const goldRefuted = per_class.Refuted.support;

  return {
    count: rows.length,
    accuracy: div(correct, rows.length),
    macro_f1,
    macro_labels,
    per_class,
    false_flag_rate: div(m.Supported.Refuted, goldSupported),
    miss_rate: div(goldRefuted - m.Refuted.Refuted, goldRefuted),
    invalid: VERDICTS.reduce((a, g) => a + m[g].Invalid, 0),
    confusion: m,
  };
}

export const macroF1 = (rows: readonly Scored[]) => verdictMetrics(rows).macro_f1;

export interface Interval {
  value: number;
  low: number;
  high: number;
}

export interface BootstrapOptions {
  iterations?: number;
  seed?: number;
  /** 0.05 gives a 95% interval. */
  alpha?: number;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Percentile bootstrap: resample items with replacement and recompute the statistic.
 * With 50 claims the interval is wide. That is the honest answer, so we report it.
 */
export function bootstrap<T>(rows: readonly T[], stat: (rows: T[]) => number, opts: BootstrapOptions = {}): Interval {
  const { iterations = 2000, seed = 201, alpha = 0.05 } = opts;
  const value = stat(rows.slice());
  if (rows.length === 0) return { value, low: value, high: value };
  const rng = makeRng(seed);
  const samples: number[] = [];
  const buf: T[] = new Array(rows.length);
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < rows.length; j++) buf[j] = rows[Math.floor(rng() * rows.length)];
    samples.push(stat(buf));
  }
  samples.sort((a, b) => a - b);
  return { value, low: percentile(samples, alpha / 2), high: percentile(samples, 1 - alpha / 2) };
}

export interface PairedDelta extends Interval {
  /** Share of resamples where system B did not beat system A. A rough one-sided p-value. */
  p_not_better: number;
  pairs: number;
}

/**
 * Compare two systems on the same claims. Items are paired by index, so callers must
 * align both arrays by item id first. Returns stat(b) - stat(a) with an interval.
 */
export function pairedBootstrap(
  a: readonly Scored[],
  b: readonly Scored[],
  stat: (rows: Scored[]) => number = macroF1,
  opts: BootstrapOptions = {},
): PairedDelta {
  if (a.length !== b.length) throw new Error(`pairedBootstrap: lengths differ (${a.length} vs ${b.length})`);
  const { iterations = 2000, seed = 201, alpha = 0.05 } = opts;
  const n = a.length;
  const value = stat(b.slice()) - stat(a.slice());
  if (n === 0) return { value, low: value, high: value, p_not_better: 1, pairs: 0 };
  const rng = makeRng(seed);
  const deltas: number[] = [];
  const ba: Scored[] = new Array(n);
  const bb: Scored[] = new Array(n);
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < n; j++) {
      const k = Math.floor(rng() * n);
      ba[j] = a[k];
      bb[j] = b[k];
    }
    deltas.push(stat(bb) - stat(ba));
  }
  deltas.sort((x, y) => x - y);
  return {
    value,
    low: percentile(deltas, alpha / 2),
    high: percentile(deltas, 1 - alpha / 2),
    p_not_better: deltas.filter((d) => d <= 0).length / deltas.length,
    pairs: n,
  };
}

/** For reliability flags. positive = "flagged Low" (predicted) and "was reverted" (gold). */
export interface BinaryRow {
  gold: boolean;
  predicted: boolean;
}

export interface BinaryMetrics {
  count: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of predictions that were positive. "Flag nothing" has 0. */
  flag_rate: number;
}

export function binaryMetrics(rows: readonly BinaryRow[]): BinaryMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    if (r.predicted && r.gold) tp++;
    else if (r.predicted && !r.gold) fp++;
    else if (!r.predicted && r.gold) fn++;
    else tn++;
  }
  const precision = div(tp, tp + fp);
  const recall = div(tp, tp + fn);
  return { count: rows.length, tp, fp, fn, tn, precision, recall, f1: f1(precision, recall), flag_rate: div(tp + fp, rows.length) };
}
