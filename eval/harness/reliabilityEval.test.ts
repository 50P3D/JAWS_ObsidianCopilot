/**
 * Unit tests for the reliability evaluation: systems, metrics, report and tuner
 * (Requirements 10.1, 10.3, 10.5, 10.9, 11.2, 11.3).
 *
 * Run: npx tsx --test eval/harness/reliabilityEval.test.ts
 */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THRESHOLDS, LIFTWING_ENABLED, LIFTWING_URL } from "../../src/reliability/config";
import { clearCache, type FetchLike } from "../../src/reliability/http";
import { binaryMetrics, type BinaryMetrics } from "./metrics";
import type { ReliabilityPrediction, ReliabilityRunFile, RevisionItem } from "./reliabilityDataset";
import { reliabilityMetrics, renderReliabilityReport, toBinaryRows } from "./reliabilityReport";
import { createReliabilitySystem, type ReliabilitySystemOutput } from "./reliabilitySystems";
import { assertTunable, pickBest, recomputeRows, type GridRow } from "./tuneReliability";

// ---------------------------------------------------------------------------------------------
// Helpers

const item = (n: number, reverted: boolean, timestamp = "2026-09-01T10:15:30Z"): RevisionItem => ({
  id: `rev-${n}`,
  rev_id: n,
  page_title: `Article ${n}`,
  timestamp,
  reverted,
  split: "dev",
});

/** The same mapping reliabilityRun.ts uses for a row that scored without an error. */
const toPrediction = (it: RevisionItem, out: ReliabilitySystemOutput): ReliabilityPrediction => ({
  id: it.id,
  rev_id: it.rev_id,
  page_title: it.page_title,
  gold_reverted: it.reverted,
  badge: out.badge,
  predicted_low: out.badge === "Low",
  reasons: out.reasons,
  rules: out.rules,
  signals: out.signals,
  ms: 0,
});

/** A hand-made prediction row. predicted_low follows the badge, as in the runner. */
const row = (id: string, gold: boolean, low: boolean, extra: Partial<ReliabilityPrediction> = {}): ReliabilityPrediction => ({
  id,
  rev_id: Number(id.replace(/\D/g, "")) || 1,
  page_title: `Title of ${id}`,
  gold_reverted: gold,
  badge: low ? "Low" : "High",
  predicted_low: low,
  reasons: low ? [`Reason for ${id}`] : [],
  rules: low ? ["revert-risk-high"] : [],
  ms: 10,
  ...extra,
});

const runFile = (predictions: ReliabilityPrediction[], over: Partial<ReliabilityRunFile> = {}): ReliabilityRunFile => ({
  run_id: "20261017-120000_reliability-scorer_dev",
  started_at: "2026-10-17T12:00:00.000Z",
  finished_at: "2026-10-17T12:05:00.000Z",
  git_commit: "abc1234",
  system: { name: "scorer", thresholds: { ...DEFAULT_THRESHOLDS }, liftwing: true },
  dataset: { path: "eval/datasets/reliability-dev.jsonl", sha256: "0".repeat(64), split: "dev", count: predictions.length },
  predictions,
  ...over,
});

/** The text between one markdown heading and the next "## " heading. */
function section(md: string, heading: string): string {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `missing section ${heading}`);
  const next = md.indexOf("\n## ", start + heading.length);
  return md.slice(start, next < 0 ? undefined : next);
}

beforeEach(() => clearCache());

// ---------------------------------------------------------------------------------------------
// flag-nothing

test("flag-nothing gives precision 0, recall 0 and flag rate 0, without any network call", async () => {
  const realFetch = globalThis.fetch;
  let globalCalls = 0;
  globalThis.fetch = (async () => {
    globalCalls++;
    throw new Error("flag-nothing must not fetch");
  }) as typeof fetch;
  let injectedCalls = 0;
  const injected: FetchLike = async () => {
    injectedCalls++;
    throw new Error("flag-nothing must not fetch");
  };

  try {
    const system = createReliabilitySystem("flag-nothing", { fetch: injected });
    assert.equal(system.info.name, "flag-nothing");
    assert.equal(system.info.liftwing, false);
    assert.equal(system.info.thresholds, undefined);

    const items = [item(1, true), item(2, false), item(3, true), item(4, false)];
    const predictions: ReliabilityPrediction[] = [];
    for (const it of items) {
      const out = await system.check({ id: it.id, rev_id: it.rev_id, page_title: it.page_title, timestamp: it.timestamp });
      assert.equal(out.badge, "High");
      assert.equal(out.low, false);
      assert.equal(out.signals, undefined);
      predictions.push(toPrediction(it, out));
    }

    const m = binaryMetrics(toBinaryRows(predictions));
    assert.deepEqual(
      { precision: m.precision, recall: m.recall, f1: m.f1, flag_rate: m.flag_rate },
      { precision: 0, recall: 0, f1: 0, flag_rate: 0 },
    );
    assert.deepEqual({ tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn }, { tp: 0, fp: 0, fn: 2, tn: 2 });

    const rm = reliabilityMetrics(predictions);
    assert.equal(rm.precision, 0);
    assert.equal(rm.recall, 0);
    assert.equal(rm.flag_rate, 0);
    // Every resample flags nothing, so the intervals collapse to 0.
    assert.deepEqual(rm.intervals.flag_rate, { value: 0, low: 0, high: 0 });
    assert.deepEqual(rm.intervals.recall, { value: 0, low: 0, high: 0 });

    assert.equal(globalCalls, 0, "no global fetch");
    assert.equal(injectedCalls, 0, "no injected fetch");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("createReliabilitySystem rejects an unknown system name", () => {
  assert.throws(() => createReliabilitySystem("random"), /Unknown reliability system "random"/);
});

// ---------------------------------------------------------------------------------------------
// Metrics

test("hand-worked 6-row example: TP 2, FP 1, FN 1, TN 2", () => {
  const rows = [
    row("tp1", true, true),
    row("tp2", true, true),
    row("fp1", false, true),
    row("fn1", true, false),
    row("tn1", false, false),
    row("tn2", false, false),
  ];
  const m = reliabilityMetrics(rows);
  assert.deepEqual({ count: m.count, tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn }, { count: 6, tp: 2, fp: 1, fn: 1, tn: 2 });
  // precision = 2 / (2 + 1), recall = 2 / (2 + 1), F1 = 2/3, flag rate = 3 / 6
  assert.ok(Math.abs(m.precision - 2 / 3) < 1e-12);
  assert.ok(Math.abs(m.recall - 2 / 3) < 1e-12);
  assert.ok(Math.abs(m.f1 - 2 / 3) < 1e-12);
  assert.equal(m.flag_rate, 0.5);
  assert.equal(m.errors, 0);

  // The point estimate sits inside its own interval, and the interval is in [0, 1].
  for (const iv of Object.values(m.intervals)) {
    assert.ok(iv.low <= iv.value && iv.value <= iv.high, JSON.stringify(iv));
    assert.ok(iv.low >= 0 && iv.high <= 1, JSON.stringify(iv));
  }
});

test("an errored row is counted as not flagged", () => {
  const errored = row("err7", true, false, {
    badge: null,
    reasons: [],
    rules: [],
    error: "timeout after 5000 ms",
  });
  const rows = [row("tp1", true, true), errored, row("tn1", false, false)];

  const m = reliabilityMetrics(rows);
  assert.deepEqual({ tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn }, { tp: 1, fp: 0, fn: 1, tn: 1 });
  assert.equal(m.errors, 1);
  assert.equal(m.recall, 0.5);

  // The tuner keeps errored rows not flagged, even if a row claims otherwise.
  const recomputed = recomputeRows([{ ...errored, predicted_low: true }], DEFAULT_THRESHOLDS);
  assert.equal(recomputed[0].predicted_low, false);
  assert.equal(recomputed[0].error, "timeout after 5000 ms");
});

// ---------------------------------------------------------------------------------------------
// Report

test("the report lists every false positive and false negative, and no TP or TN in those sections", () => {
  const rows = [
    row("tp11", true, true),
    row("fp21", false, true),
    row("fp22", false, true),
    row("fn31", true, false),
    row("fn32", true, false, { badge: null, reasons: [], rules: [], error: "HTTP 503 Service Unavailable" }),
    row("tn41", false, false),
  ];
  const md = renderReliabilityReport(runFile(rows));

  const fp = section(md, "## False positives");
  const fn = section(md, "## False negatives");
  const has = (text: string, id: string) => text.includes(`**${id}**`);

  for (const id of ["fp21", "fp22"]) assert.ok(has(fp, id), `FP section lists ${id}`);
  for (const id of ["fn31", "fn32"]) assert.ok(has(fn, id), `FN section lists ${id}`);
  for (const id of ["tp11", "tn41", "fn31", "fn32"]) assert.ok(!has(fp, id), `FP section does not list ${id}`);
  for (const id of ["tp11", "tn41", "fp21", "fp22"]) assert.ok(!has(fn, id), `FN section does not list ${id}`);

  // Each listed failure has its revision link, and the errored FN shows its error.
  assert.ok(fp.includes("https://en.wikipedia.org/w/index.php?oldid=21"));
  assert.ok(fn.includes("https://en.wikipedia.org/w/index.php?oldid=32"));
  assert.match(fn, /error: HTTP 503/);
  assert.match(fp, /Reason for fp21/);

  // The confusion counts match.
  assert.match(md, /TP 1 \| FN 2/);
  assert.match(md, /FP 2 \| TN 1/);
});

test("the report says None when there are no false positives or false negatives", () => {
  const md = renderReliabilityReport(runFile([row("tp1", true, true), row("tn1", false, false)]));
  assert.match(section(md, "## False positives"), /None\./);
  assert.match(section(md, "## False negatives"), /None\./);
});

// ---------------------------------------------------------------------------------------------
// Tuner

const metricsOf = (precision: number, recall: number): BinaryMetrics => ({
  count: 10,
  tp: 0,
  fp: 0,
  fn: 0,
  tn: 0,
  precision,
  recall,
  f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  flag_rate: 0.5,
});
const gridRow = (revertRiskLow: number, precision: number, recall: number): GridRow => ({
  revertRiskLow,
  revertRiskMedium: Math.min(0.4, revertRiskLow),
  metrics: metricsOf(precision, recall),
});

test("pickBest takes the highest F1", () => {
  const grid = [gridRow(0.5, 0.5, 0.5), gridRow(0.6, 0.8, 0.7), gridRow(0.7, 0.9, 0.4)];
  assert.equal(pickBest(grid).revertRiskLow, 0.6);
  assert.equal(pickBest([...grid].reverse()).revertRiskLow, 0.6);
});

test("pickBest breaks an F1 tie by the higher min(precision, recall)", () => {
  // Both have F1 2/3: (0.5, 1.0) has min 0.5, (0.6, 0.75) has min 0.6.
  const grid = [gridRow(0.4, 0.5, 1.0), gridRow(0.9, 0.6, 0.75)];
  assert.ok(Math.abs(grid[0].metrics.f1 - grid[1].metrics.f1) < 1e-12);
  assert.equal(pickBest(grid, 0.4).revertRiskLow, 0.9, "min(P, R) beats closeness to current");
  assert.equal(pickBest([...grid].reverse(), 0.4).revertRiskLow, 0.9);
});

test("pickBest then prefers the value closest to the current threshold, then the lower value", () => {
  const same = (low: number) => gridRow(low, 0.7, 0.7);
  const grid = [same(0.5), same(0.6), same(0.8), same(0.9)];

  assert.equal(pickBest(grid, 0.75).revertRiskLow, 0.8, "closest to current");
  assert.equal(pickBest([...grid].reverse(), 0.75).revertRiskLow, 0.8);
  // 0.6 and 0.8 are equally far from 0.7 (up to float error): the lower one wins.
  assert.equal(pickBest(grid, 0.7).revertRiskLow, 0.6, "equidistant goes to the lower value");
  assert.equal(pickBest([...grid].reverse(), 0.7).revertRiskLow, 0.6);
  // Without a current value, the lowest tied value wins.
  assert.equal(pickBest(grid).revertRiskLow, 0.5);
  assert.equal(pickBest([...grid].reverse()).revertRiskLow, 0.5);
});

test("pickBest throws on an empty grid", () => {
  assert.throws(() => pickBest([]), /empty grid/);
});

test("the tuner refuses a test-split run and a non-scorer run", () => {
  const rows = [row("tp1", true, true)];
  const testRun = runFile(rows, {
    dataset: { path: "eval/datasets/reliability-test.jsonl", sha256: "1".repeat(64), split: "test", count: 1 },
  });
  assert.throws(() => assertTunable(testRun), /test-split/);

  const baseline = runFile(rows, { system: { name: "revert-risk-only", thresholds: { ...DEFAULT_THRESHOLDS }, liftwing: true } });
  assert.throws(() => assertTunable(baseline), /Expected a scorer run, got revert-risk-only/);

  const noThresholds = runFile(rows, { system: { name: "scorer", liftwing: true } });
  assert.throws(() => assertTunable(noThresholds), /no saved thresholds/);

  assert.deepEqual(assertTunable(runFile(rows)), DEFAULT_THRESHOLDS);
});

// ---------------------------------------------------------------------------------------------
// revert-risk-only and scorer with a fake fetch

const PROSE = "The treaty was signed in the Hall of Mirrors at the Palace of Versailles after long talks. ".repeat(4).trim();

interface Call {
  url: string;
  init?: RequestInit;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Clean article (no banners, fully cited), one revision in the history, and a fixed revert risk. */
function fakeFetch(it: RevisionItem, risk: number) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith(LIFTWING_URL)) {
      return jsonResponse({ output: { prediction: risk >= 0.5, probabilities: { true: risk, false: 1 - risk } } });
    }
    const params = new URL(url).searchParams;
    if (params.get("action") === "parse") {
      return jsonResponse({ parse: { revid: it.rev_id, categories: [], templates: [], wikitext: `${PROSE}<ref>Smith 2001</ref>` } });
    }
    if (params.get("action") === "query") {
      return jsonResponse({
        query: { pages: [{ title: it.page_title, revisions: [{ revid: it.rev_id, timestamp: it.timestamp, tags: [] }] }] },
      });
    }
    return jsonResponse({ error: { code: "unrouted" } }, 404);
  };
  return { fetch, calls };
}

const inputOf = (it: RevisionItem) => ({ id: it.id, rev_id: it.rev_id, page_title: it.page_title, timestamp: it.timestamp });
const low = DEFAULT_THRESHOLDS.revertRiskLow;

test("revert-risk-only and scorer flag Low exactly at risk >= revertRiskLow", { skip: !LIFTWING_ENABLED }, async () => {
  const cases: { risk: number; low: boolean }[] = [
    { risk: Math.min(1, low + 0.05), low: true },
    { risk: low, low: true },
    { risk: Math.max(0, low - 0.01), low: false },
  ];
  let n = 7_000_000;
  for (const name of ["revert-risk-only", "scorer"] as const) {
    for (const c of cases) {
      const it = item(++n, true);
      const { fetch } = fakeFetch(it, c.risk);
      const out = await createReliabilitySystem(name, { fetch }).check(inputOf(it));
      assert.equal(out.low, c.low, `${name} at risk ${c.risk}`);
      assert.equal(out.badge === "Low", c.low, `${name} badge at risk ${c.risk}`);
      assert.equal(out.rules.includes("revert-risk-high"), c.low, `${name} rule at risk ${c.risk}`);
      assert.deepEqual(out.signals?.revertRisk, { probability: c.risk });
    }
  }
});

test("a --risk-low override moves the Low cut-off", { skip: !LIFTWING_ENABLED }, async () => {
  const it = item(7_100_001, true);
  const { fetch } = fakeFetch(it, 0.75);
  const strict = createReliabilitySystem("revert-risk-only", { fetch, thresholds: { revertRiskLow: 0.8 } });
  assert.equal(strict.info.thresholds?.revertRiskLow, 0.8);
  assert.equal((await strict.check(inputOf(it))).low, false);
});

test("revert-risk-only with Lift Wing off never flags Low and sends no Lift Wing request", async () => {
  const it = item(7_200_001, true);
  const { fetch, calls } = fakeFetch(it, 0.99);
  const system = createReliabilitySystem("revert-risk-only", { fetch, liftWing: false });
  assert.equal(system.info.liftwing, false);
  const out = await system.check(inputOf(it));
  assert.equal(out.low, false);
  assert.equal(out.badge, "Medium");
  assert.equal(calls.filter((c) => c.url.startsWith(LIFTWING_URL)).length, 0);
});

test("scorer and revert-risk-only use asOf = the item's own timestamp", async () => {
  // A timestamp far in the past, so "now" would give an rvstart years away.
  const timestamp = "2024-03-05T07:08:09Z";
  for (const name of ["revert-risk-only", "scorer"] as const) {
    clearCache();
    const it = item(name === "scorer" ? 7_300_001 : 7_300_002, false, timestamp);
    const { fetch, calls } = fakeFetch(it, 0.1);
    await createReliabilitySystem(name, { fetch, liftWing: false }).check(inputOf(it));

    const history = calls
      .map((c) => new URL(c.url).searchParams)
      .find((p) => p.get("action") === "query" && p.get("prop") === "revisions|flagged");
    assert.ok(history, `${name} sent a history request`);
    const rvstart = Date.parse(history.get("rvstart")!);
    const diff = rvstart - Date.parse(timestamp);
    // rvstart is As_Of rounded up to the minute.
    assert.ok(diff >= 0 && diff < 60_000, `${name}: rvstart ${history.get("rvstart")} is within a minute after ${timestamp}`);
  }
});
