import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { combineSignals } from "../../src/reliability/combine";
import { arbSignals, arbThresholds } from "../../src/reliability/testArbitraries";
import type { Signals, Thresholds } from "../../src/reliability/types";
import { binaryMetrics } from "./metrics";
import type { ReliabilityPrediction } from "./reliabilityDataset";
import { toBinaryRows } from "./reliabilityReport";
import { recomputeRows, reproductionMismatches } from "./tuneReliability";

/** One generated row: either scored from signals (as the runner saves it) or a failed row. */
type RowSpec = { kind: "scored"; signals: Signals; gold: boolean } | { kind: "error"; gold: boolean };

const arbRowSpec: fc.Arbitrary<RowSpec> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("scored" as const), signals: arbSignals, gold: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("error" as const), gold: fc.boolean() }) },
);

/** Build saved run rows the way reliabilityRun.ts does: badge, Low flag, reasons and rules from combineSignals. */
function savedRows(specs: readonly RowSpec[], t: Thresholds): ReliabilityPrediction[] {
  return specs.map((spec, i) => {
    const rev_id = 1000 + i;
    const base = { id: `rev-${rev_id}`, rev_id, page_title: `Page ${i}`, gold_reverted: spec.gold, ms: 0 };
    if (spec.kind === "error") {
      return { ...base, badge: null, predicted_low: false, reasons: [], rules: [], error: "HTTP 500 Internal Server Error" };
    }
    const score = combineSignals(spec.signals, t, { revisionId: rev_id });
    return {
      ...base,
      badge: score.badge,
      predicted_low: score.badge === "Low",
      reasons: score.reasons,
      rules: score.rules,
      signals: spec.signals,
    };
  });
}

// Feature: reliability-scorer, Property 16: Tuning reproduces saved badges
// **Validates: Requirements 11.1**
test("Property 16: recomputing at the saved thresholds reproduces saved badges and metrics", () => {
  fc.assert(
    fc.property(fc.array(arbRowSpec, { maxLength: 40 }), arbThresholds, (specs, t) => {
      const saved = savedRows(specs, t);
      // Round-trip through JSON, as the tuner reads the run file from disk.
      const fromDisk: ReliabilityPrediction[] = JSON.parse(JSON.stringify(saved));
      const again = recomputeRows(fromDisk, t);

      assert.equal(again.length, saved.length);
      for (let i = 0; i < saved.length; i++) {
        assert.equal(again[i].badge, saved[i].badge, `badge differs for ${saved[i].id}`);
        assert.equal(again[i].predicted_low, saved[i].predicted_low, `Low flag differs for ${saved[i].id}`);
      }
      assert.deepEqual(binaryMetrics(toBinaryRows(again)), binaryMetrics(toBinaryRows(saved)));
      assert.deepEqual(reproductionMismatches(fromDisk, t), []);
    }),
    { numRuns: 100 },
  );
});
