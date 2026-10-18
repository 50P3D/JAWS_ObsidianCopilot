/**
 * fast-check generators for the badge-rule tests (combine.test.ts, and aggregate tests if useful).
 * Test-only helper: nothing in the scorer imports this file.
 *
 * - arbSignals: each of the four signals measured or Unavailable with a random cause.
 * - arbThresholds: random Thresholds with revertRiskMedium <= revertRiskLow.
 * - arbWorsening + applyWorsening: one single step that makes one measured signal worse.
 */

import fc from "fast-check";
import {
  unavailable,
  isUnavailable,
  type BannerKind,
  type CitationSignal,
  type EditActivitySignal,
  type MaintenanceSignal,
  type RevertRiskSignal,
  type Signals,
  type Thresholds,
  type Unavailable,
} from "./types";

/** All banner kinds, in BANNER_RULES order. */
export const BANNER_KINDS: readonly BannerKind[] = [
  "pov",
  "disputed",
  "unreferenced",
  "more_citations",
  "cleanup",
  "current_event",
];

/** Realistic causes mixed with arbitrary strings (which may contain URLs, editor terms, odd Unicode). */
export const arbCause: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    "timeout after 5000 ms",
    "HTTP 500 Internal Server Error",
    "HTTP 429 Too Many Requests",
    "disabled",
    "no prose paragraphs",
    "nosuchrevid",
    "fetch failed https://en.wikipedia.org/w/api.php?action=parse&oldid=123",
  ),
  fc.string({ maxLength: 200 }),
  fc.string({ unit: "grapheme", maxLength: 60 }),
);

export const arbUnavailable: fc.Arbitrary<Unavailable> = arbCause.map(unavailable);

/** A [0, 1] probability, biased towards the default thresholds so boundary cases show up. */
const arbUnit: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(0, 0.4, 0.5, 0.7, 1),
);

export const arbMaintenance: fc.Arbitrary<MaintenanceSignal> = fc.record({
  // subarray keeps the original order, so banners stay distinct and in BANNER_RULES order.
  banners: fc.subarray([...BANNER_KINDS]),
  inlineIssues: fc.integer({ min: 0, max: 40 }),
});

export const arbEditActivity: fc.Arbitrary<EditActivitySignal> = fc
  .integer({ min: 0, max: 60 })
  .chain((editsInWindow) =>
    fc.record({
      ageHours: fc.oneof(fc.double({ min: 0, max: 2000, noNaN: true }), fc.constantFrom(0, 12, 24, 48)),
      isLatest: fc.boolean(),
      editsInWindow: fc.constant(editsInWindow),
      revertsInWindow: fc.integer({ min: 0, max: editsInWindow }),
      pendingReview: fc.constantFrom<boolean | null>(null, true, false),
    }),
  );

export const arbRevertRisk: fc.Arbitrary<RevertRiskSignal> = fc.record({ probability: arbUnit });

export const arbCitations: fc.Arbitrary<CitationSignal> = fc
  .integer({ min: 1, max: 40 })
  .chain((prose) =>
    fc.record({
      prose: fc.constant(prose),
      cited: fc.integer({ min: 0, max: prose }),
      refCount: fc.integer({ min: 0, max: 300 }),
    }),
  )
  .map(({ prose, cited, refCount }) => ({ coverage: cited / prose, prose, cited, refCount }));

/** Each signal is measured about 3 times in 4, otherwise Unavailable with a random cause. */
const orUnavailable = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | Unavailable> =>
  fc.oneof({ arbitrary: arb, weight: 3 }, { arbitrary: arbUnavailable, weight: 1 });

export const arbSignals: fc.Arbitrary<Signals> = fc.record({
  maintenance: orUnavailable(arbMaintenance),
  editActivity: orUnavailable(arbEditActivity),
  revertRisk: orUnavailable(arbRevertRisk),
  citations: orUnavailable(arbCitations),
});

/** Random Thresholds with revertRiskMedium <= revertRiskLow. */
export const arbThresholds: fc.Arbitrary<Thresholds> = fc
  .record({
    a: arbUnit,
    b: arbUnit,
    recentEditHours: fc.integer({ min: 1, max: 96 }),
    revertsInWindow: fc.integer({ min: 1, max: 10 }),
    inlineIssues: fc.integer({ min: 1, max: 30 }),
    citationCoverage: arbUnit,
    unavailableCap: fc.integer({ min: 1, max: 4 }),
  })
  .map(({ a, b, ...rest }) => ({ revertRiskLow: Math.max(a, b), revertRiskMedium: Math.min(a, b), ...rest }));

/** One single worsening step. Amounts are relative, so a step applies to any measured signal. */
export type Worsening =
  | { kind: "revert-risk-up"; delta: number }
  | { kind: "add-banner"; banner: BannerKind }
  | { kind: "inline-issues-up"; delta: number }
  | { kind: "coverage-down"; uncite: number }
  | { kind: "younger"; factor: number }
  | { kind: "reverts-up"; delta: number }
  | { kind: "pending-review" };

export const arbWorsening: fc.Arbitrary<Worsening> = fc.oneof(
  fc.record({ kind: fc.constant("revert-risk-up" as const), delta: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant("add-banner" as const), banner: fc.constantFrom(...BANNER_KINDS) }),
  fc.record({ kind: fc.constant("inline-issues-up" as const), delta: fc.integer({ min: 0, max: 30 }) }),
  fc.record({ kind: fc.constant("coverage-down" as const), uncite: fc.integer({ min: 0, max: 40 }) }),
  fc.record({ kind: fc.constant("younger" as const), factor: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant("reverts-up" as const), delta: fc.integer({ min: 0, max: 10 }) }),
  fc.record({ kind: fc.constant("pending-review" as const) }),
);

/**
 * Applies one worsening step. Returns undefined when the step does not apply: the target signal
 * is Unavailable, or (for pending-review) the article is not under pending changes or already has
 * edits awaiting review. Measuring a missing signal is not a worsening, so it is never generated.
 */
export function applyWorsening(s: Signals, w: Worsening): Signals | undefined {
  switch (w.kind) {
    case "revert-risk-up": {
      if (isUnavailable(s.revertRisk)) return undefined;
      return { ...s, revertRisk: { probability: Math.min(1, s.revertRisk.probability + w.delta) } };
    }
    case "add-banner": {
      if (isUnavailable(s.maintenance)) return undefined;
      const set = new Set([...s.maintenance.banners, w.banner]);
      return { ...s, maintenance: { ...s.maintenance, banners: BANNER_KINDS.filter((k) => set.has(k)) } };
    }
    case "inline-issues-up": {
      if (isUnavailable(s.maintenance)) return undefined;
      return { ...s, maintenance: { ...s.maintenance, inlineIssues: s.maintenance.inlineIssues + w.delta } };
    }
    case "coverage-down": {
      if (isUnavailable(s.citations)) return undefined;
      const c = s.citations;
      const cited = Math.max(0, c.cited - w.uncite);
      // Never raise coverage, even if a hand-made signal had coverage below cited / prose.
      return { ...s, citations: { ...c, cited, coverage: Math.min(c.coverage, cited / c.prose) } };
    }
    case "younger": {
      if (isUnavailable(s.editActivity)) return undefined;
      return { ...s, editActivity: { ...s.editActivity, ageHours: s.editActivity.ageHours * w.factor } };
    }
    case "reverts-up": {
      if (isUnavailable(s.editActivity)) return undefined;
      const e = s.editActivity;
      return {
        ...s,
        editActivity: { ...e, revertsInWindow: e.revertsInWindow + w.delta, editsInWindow: e.editsInWindow + w.delta },
      };
    }
    case "pending-review": {
      if (isUnavailable(s.editActivity) || s.editActivity.pendingReview !== false) return undefined;
      return { ...s, editActivity: { ...s.editActivity, pendingReview: true } };
    }
  }
}
