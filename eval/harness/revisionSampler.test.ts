import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  poolSha256,
  renderHeader,
  sampleSplits,
  type PoolRevision,
  type RevisionPools,
  type SplitSizes,
} from "./revisionSampler";
import type { RevisionItem } from "./reliabilityDataset";

interface Case {
  sizes: SplitSizes;
  pools: RevisionPools;
  seed: number;
}

/**
 * Pools that are large enough for the requested sizes, with repeated page titles.
 *
 * Each label gets its own title space with at least `need` distinct titles (each repeated
 * 1-3 times), so the other label can never use them up. On top of that there are shared
 * titles that appear in both pools, which the sampler must not take twice.
 */
const caseArb: fc.Arbitrary<Case> = fc
  .record({
    devPerLabel: fc.integer({ min: 0, max: 8 }),
    testPerLabel: fc.integer({ min: 0, max: 8 }),
    extraReverted: fc.integer({ min: 0, max: 5 }),
    extraStable: fc.integer({ min: 0, max: 5 }),
    // Repeats per own title (indexed modulo the array length).
    revertedRepeats: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 25 }),
    stableRepeats: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 25 }),
    // Shared titles: how many times each appears in the reverted and stable pools.
    shared: fc.array(
      fc.record({ inReverted: fc.integer({ min: 1, max: 3 }), inStable: fc.integer({ min: 1, max: 3 }) }),
      { maxLength: 6 },
    ),
    seed: fc.integer({ min: 0, max: 0xffffffff }),
  })
  .map((r) => {
    const need = r.devPerLabel + r.testPerLabel;
    let nextRev = 1000;
    const row = (title: string): PoolRevision => {
      const rev_id = nextRev++;
      return { rev_id, page_title: title, timestamp: new Date(Date.UTC(2026, 0, 1) + rev_id * 1000).toISOString() };
    };
    const reverted: PoolRevision[] = [];
    const stable: PoolRevision[] = [];
    for (let i = 0; i < need + r.extraReverted; i++) {
      const times = r.revertedRepeats[i % r.revertedRepeats.length];
      for (let k = 0; k < times; k++) reverted.push(row(`Reverted page ${i}`));
    }
    for (let i = 0; i < need + r.extraStable; i++) {
      const times = r.stableRepeats[i % r.stableRepeats.length];
      for (let k = 0; k < times; k++) stable.push(row(`Stable page ${i}`));
    }
    r.shared.forEach((s, i) => {
      for (let k = 0; k < s.inReverted; k++) reverted.push(row(`Shared page ${i}`));
      for (let k = 0; k < s.inStable; k++) stable.push(row(`Shared page ${i}`));
    });
    return {
      sizes: { devPerLabel: r.devPerLabel, testPerLabel: r.testPerLabel },
      pools: { reverted, stable },
      seed: r.seed,
    };
  });

function countLabels(items: RevisionItem[]): { reverted: number; stable: number } {
  const reverted = items.filter((i) => i.reverted).length;
  return { reverted, stable: items.length - reverted };
}

// Feature: reliability-scorer, Property 14: Revision sampler gives balanced, disjoint splits
// **Validates: Requirements 9.2, 9.3, 9.4, 9.5**
test("Property 14: sampler gives balanced, disjoint, reproducible splits", () => {
  fc.assert(
    fc.property(caseArb, ({ sizes, pools, seed }) => {
      const { dev, test: testSplit } = sampleSplits(pools, sizes, seed);

      // Requested sizes per label, and every row carries its own split.
      assert.deepEqual(countLabels(dev), { reverted: sizes.devPerLabel, stable: sizes.devPerLabel });
      assert.deepEqual(countLabels(testSplit), { reverted: sizes.testPerLabel, stable: sizes.testPerLabel });
      assert.ok(dev.every((i) => i.split === "dev"));
      assert.ok(testSplit.every((i) => i.split === "test"));

      // Each row comes from the pool matching its label, unchanged.
      for (const item of [...dev, ...testSplit]) {
        const pool = item.reverted ? pools.reverted : pools.stable;
        const source = pool.find((p) => p.rev_id === item.rev_id);
        assert.ok(source, `rev ${item.rev_id} not in the ${item.reverted ? "reverted" : "stable"} pool`);
        assert.equal(item.page_title, source.page_title);
        assert.equal(item.timestamp, source.timestamp);
      }

      // No revision id, item id or page title appears twice across both splits.
      const all = [...dev, ...testSplit];
      assert.equal(new Set(all.map((i) => i.rev_id)).size, all.length);
      assert.equal(new Set(all.map((i) => i.id)).size, all.length);
      assert.equal(new Set(all.map((i) => i.page_title)).size, all.length);

      // Every prefix of each split is balanced to within one.
      for (const split of [dev, testSplit]) {
        let diff = 0;
        for (const item of split) {
          diff += item.reverted ? 1 : -1;
          assert.ok(Math.abs(diff) <= 1, "prefix out of balance");
        }
      }

      // Same seed, same output.
      assert.deepEqual(sampleSplits(pools, sizes, seed), { dev, test: testSplit });
    }),
    { numRuns: 100 },
  );
});

test("too-small pool throws 'Not enough <label> revisions'", () => {
  const pools: RevisionPools = {
    // Two revisions of the same article only count once.
    reverted: [
      { rev_id: 1, page_title: "A", timestamp: "2026-01-01T00:00:00.000Z" },
      { rev_id: 2, page_title: "A", timestamp: "2026-01-01T00:00:01.000Z" },
    ],
    stable: [
      { rev_id: 3, page_title: "B", timestamp: "2026-01-01T00:00:02.000Z" },
      { rev_id: 4, page_title: "C", timestamp: "2026-01-01T00:00:03.000Z" },
    ],
  };
  assert.throws(() => sampleSplits(pools, { devPerLabel: 1, testPerLabel: 1 }, 7), /Not enough reverted revisions/);
});

test("renderHeader records the seed and the pool sha256", () => {
  const pools: RevisionPools = {
    reverted: [{ rev_id: 1, page_title: "A", timestamp: "2026-01-01T00:00:00.000Z" }],
    stable: [{ rev_id: 2, page_title: "B", timestamp: "2026-01-01T00:00:01.000Z" }],
  };
  const sha = poolSha256(pools);
  assert.match(sha, /^[0-9a-f]{64}$/);
  const header = renderHeader({
    split: "dev",
    reverted: 1,
    stable: 1,
    seed: 4242,
    query: "enwiki recentchanges, ns 0, no bots, no new pages",
    fetchedAt: "2026-01-02T03:04:05.000Z",
    poolSha256: sha,
  });
  assert.ok(header.includes("seed=4242"));
  assert.ok(header.includes(`sha256 ${sha}`));
  assert.ok(header.split("\n").every((line) => line.startsWith("//")));
});
