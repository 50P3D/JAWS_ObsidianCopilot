import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { ReliabilityBadge } from "../contract/claimCard";
import { aggregateScores, titleLabel, type PageScore } from "./aggregate";
import { BADGE_RANK, hasEditorTerm } from "./combine";
import { MAX_REASONS } from "./config";
import { arbSignals } from "./testArbitraries";

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const arbBadge = fc.constantFrom<ReliabilityBadge>("Low", "Medium", "High");

/**
 * Page titles. A small fixed pool makes duplicate titles common. It includes titles with editor
 * terms (redacted by titleLabel), an empty title, padded whitespace and a title ending in "ip".
 */
const arbTitle: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "Treaty of Versailles",
      "Paris",
      " Paris ",
      "User interface",
      "Account (bookkeeping)",
      "Editor war",
      "Ship",
      "",
    ),
    weight: 4,
  },
  { arbitrary: fc.string({ maxLength: 30 }), weight: 1 },
);

/**
 * Reasons that can never be dropped: no editor term, even after a title label ending in "ip" is
 * put in front (the "ip" + "address" join).
 */
const isSafeReason = (r: string) => r.length > 0 && !hasEditorTerm(`ip: ${r}`);

const arbSafeReason: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "Revert risk is high (0.82)",
      "The article has a disputed banner",
      "Few paragraphs cite a source (20%)",
      "Edited in the last 24 hours",
      "Several reverts in the last 30 days",
      "Edits are awaiting review",
      "All checks passed",
    ),
    weight: 4,
  },
  { arbitrary: fc.string({ minLength: 1, maxLength: 40 }).filter(isSafeReason), weight: 1 },
);

/** Reasons that the aggregator must drop. */
const arbEditorReason = fc.constantFrom(
  "Edited by a new user",
  "The editor account is new",
  "Changed from an IP address",
);

/** Every score keeps at least one safe reason, mixed in random order with duplicates and editor terms. */
const arbReasons: fc.Arbitrary<string[]> = fc
  .tuple(fc.array(arbSafeReason, { minLength: 1, maxLength: 5 }), fc.array(arbEditorReason, { maxLength: 2 }))
  .chain(([safe, editor]) => {
    const all = [...safe, ...editor];
    return fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length });
  });

const arbPageScore: fc.Arbitrary<PageScore> = fc.record({
  page_title: arbTitle,
  score: fc.record({
    revision_id: fc.integer({ min: 1, max: 20 }), // small range so duplicate ids show up
    badge: arbBadge,
    reasons: arbReasons,
    rules: fc.constant<string[]>([]),
    signals: arbSignals,
  }),
});

const lowestBadge = (scores: PageScore[]): ReliabilityBadge =>
  scores.map((s) => s.score.badge).reduce((a, b) => (BADGE_RANK[b] < BADGE_RANK[a] ? b : a));

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

// Feature: reliability-scorer, Property 11: Card badge is the lowest revision badge
// **Validates: Requirements 6.3, 6.5, 6.6**
test("Property 11: card badge is the lowest revision badge", () => {
  fc.assert(
    fc.property(fc.array(arbPageScore, { minLength: 1, maxLength: 8 }), (scores) => {
      const result = aggregateScores(scores);
      const lowest = lowestBadge(scores);

      assert.equal(result.badge, lowest);
      assert.ok(result.reasons.length >= 1 && result.reasons.length <= MAX_REASONS, `${result.reasons.length} reasons`);
      assert.equal(new Set(result.reasons).size, result.reasons.length, "duplicate reasons");

      const titles = [...new Set(scores.map((s) => s.page_title))];
      if (titles.length > 1) {
        const labels = titles.map((t) => `${titleLabel(t)}: `);
        for (const reason of result.reasons) {
          assert.ok(
            labels.some((l) => reason.startsWith(l)),
            `reason without a title label: ${JSON.stringify(reason)}`,
          );
        }
        // Every score has a safe reason, so the first lowest-badge article always contributes the first reason.
        const lowestReasons = new Set(
          scores
            .filter((s) => s.score.badge === lowest)
            .flatMap((s) => s.score.reasons.map((r) => `${titleLabel(s.page_title)}: ${r}`)),
        );
        assert.ok(
          lowestReasons.has(result.reasons[0]),
          `first reason is not from a ${lowest} article: ${JSON.stringify(result.reasons[0])}`,
        );
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: reliability-scorer, Property 12: Card result ignores evidence order
// **Validates: Requirements 6.4**
test("Property 12: card result ignores evidence order", () => {
  // Some lists repeat entries exactly, so ties on every sort key are covered too.
  const arbScores = fc
    .array(arbPageScore, { maxLength: 8 })
    .chain((base) => fc.subarray(base).map((repeats) => [...base, ...repeats]));
  fc.assert(
    fc.property(
      arbScores.chain((scores) =>
        fc.tuple(
          fc.constant(scores),
          fc.shuffledSubarray(scores, { minLength: scores.length, maxLength: scores.length }),
        ),
      ),
      ([scores, permuted]) => {
        assert.deepEqual(aggregateScores(permuted), aggregateScores(scores));
      },
    ),
    { numRuns: 100 },
  );
});
