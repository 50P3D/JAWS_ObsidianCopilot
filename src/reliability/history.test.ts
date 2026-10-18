import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { summariseHistory, type HistoryRevision } from "./history";

const MS_PER_HOUR = 3_600_000;
const REVERT_TAGS = new Set(["mw-rollback", "mw-undo", "mw-manual-revert"]);

// Whole seconds between 2001-01-01 and 2030-01-01, formatted like the API ("...T12:00:00Z").
const MIN_S = 978_307_200;
const MAX_S = 1_893_456_000;
const toIso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
const arbMs = fc.integer({ min: MIN_S, max: MAX_S }).map((s) => s * 1000);

const arbTags = fc.subarray(["mw-rollback", "mw-undo", "mw-manual-revert", "mw-reverted", "visualeditor", "mobile edit"]);

/** Raw history entries: small revid range so that collisions and ties happen. */
const arbRevs = (ms: fc.Arbitrary<number>) =>
  fc.array(fc.record({ revid: fc.integer({ min: 1, max: 50 }), ms, tags: arbTags }), { minLength: 1, maxLength: 20 });

const toHistory = (revs: { revid: number; ms: number; tags: string[] }[]): HistoryRevision[] =>
  revs.map((r) => ({ revid: r.revid, timestamp: toIso(r.ms), tags: r.tags }));

/** History input: a target revision taken from the list, and an As_Of at or after its timestamp. */
const arbHistoryInput = arbRevs(arbMs).chain((revs) =>
  fc.record({
    revs: fc.constant(revs),
    index: fc.integer({ min: 0, max: revs.length - 1 }),
    // Up to 60 days after the target, so some revisions fall after As_Of and some before.
    offsetMs: fc.integer({ min: 0, max: 60 * 24 * 3600 }).map((s) => s * 1000),
  }),
);

// Feature: reliability-scorer, Property 3: History summary matches a reference count
test("Property 3: history summary matches a reference count", () => {
  fc.assert(
    fc.property(arbHistoryInput, ({ revs, index, offsetMs }) => {
      const target = revs[index];
      const asOfMs = target.ms + offsetMs;
      const out = summariseHistory({
        revisionId: target.revid,
        revisionTimestamp: toIso(target.ms),
        asOf: new Date(asOfMs),
        revisions: toHistory(revs),
      });

      const visible = revs.filter((r) => r.ms <= asOfMs);
      const expectedEdits = visible.length;
      const expectedReverts = visible.filter((r) => r.tags.some((t) => REVERT_TAGS.has(t))).length;
      const newest = [...visible].sort((a, b) => b.ms - a.ms || b.revid - a.revid)[0];

      assert.equal(out.ageHours, (asOfMs - target.ms) / MS_PER_HOUR);
      assert.equal(out.editsInWindow, expectedEdits);
      assert.equal(out.revertsInWindow, expectedReverts);
      assert.ok(out.revertsInWindow >= 0 && out.revertsInWindow <= out.editsInWindow);
      assert.equal(out.isLatest, newest === undefined ? true : newest.revid === target.revid);
      assert.equal(out.pendingReview, null);
    }),
    { numRuns: 100 },
  );
});

// Feature: reliability-scorer, Property 4: No information from after As_Of
test("Property 4: revisions after As_Of do not change the summary", () => {
  const arbCase = fc
    .record({
      revs: arbRevs(arbMs),
      revisionId: fc.integer({ min: 1, max: 50 }),
      revisionMs: arbMs,
      asOfMs: arbMs,
      pendingSince: fc.option(arbMs.map(toIso), { nil: null }),
    })
    .chain((base) =>
      fc.record({
        base: fc.constant(base),
        future: fc.array(
          fc.record({
            revid: fc.integer({ min: 1, max: 100 }),
            // Strictly after As_Of, up to about 3 years later.
            ms: fc.integer({ min: 1, max: 100_000_000 }).map((s) => base.asOfMs + s * 1000),
            tags: fc.subarray(["mw-reverted", "mw-rollback", "mw-undo", "mw-manual-revert", "visualeditor"]),
          }),
          { minLength: 1, maxLength: 10 },
        ),
      }),
    );

  fc.assert(
    fc.property(arbCase, ({ base, future }) => {
      const input = {
        revisionId: base.revisionId,
        revisionTimestamp: toIso(base.revisionMs),
        asOf: new Date(base.asOfMs),
        pendingSince: base.pendingSince,
      };
      const before = summariseHistory({ ...input, revisions: toHistory(base.revs) });
      const after = summariseHistory({ ...input, revisions: toHistory([...base.revs, ...future]) });
      assert.deepEqual(after, before);
    }),
    { numRuns: 100 },
  );
});

// Pending review examples (Requirement 2.3).
const pendingInput = (pendingSince: string | null | undefined) =>
  summariseHistory({
    revisionId: 10,
    revisionTimestamp: "2024-05-01T12:00:00Z",
    asOf: new Date("2024-05-10T12:00:00Z"),
    revisions: [{ revid: 10, timestamp: "2024-05-01T12:00:00Z", tags: [] }],
    pendingSince,
  });

test("pendingReview is null when the article is not under pending changes", () => {
  assert.equal(pendingInput(null).pendingReview, null);
  assert.equal(pendingInput(undefined).pendingReview, null);
});

test("pendingReview is true when pending changes started at or before As_Of", () => {
  assert.equal(pendingInput("2024-05-05T08:00:00Z").pendingReview, true);
  assert.equal(pendingInput("2024-05-10T12:00:00Z").pendingReview, true);
});

test("pendingReview is false when pending changes started after As_Of", () => {
  assert.equal(pendingInput("2024-05-11T00:00:00Z").pendingReview, false);
});
