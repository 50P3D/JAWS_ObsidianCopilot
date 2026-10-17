import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { ReliabilityBadge } from "../contract/claimCard";
import { BADGE_RANK, RULE_IDS, combineSignals } from "./combine";
import { DEFAULT_THRESHOLDS } from "./config";
import { aggregateScores } from "./aggregate";
import { applyWorsening, arbCause, arbSignals, arbThresholds, arbWorsening } from "./testArbitraries";
import {
  isUnavailable,
  unavailable,
  type EditActivitySignal,
  type MaintenanceSignal,
  type Signals,
  type Thresholds,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Reference model (written from the design's rule table, independent of combine.ts)
// ---------------------------------------------------------------------------------------------

type RuleId = (typeof RULE_IDS)[number];

/** Ids of the rules that hold, in table order. */
function referenceRules(s: Signals, t: Thresholds): RuleId[] {
  const m = isUnavailable(s.maintenance) ? null : s.maintenance;
  const e = isUnavailable(s.editActivity) ? null : s.editActivity;
  const r = isUnavailable(s.revertRisk) ? null : s.revertRisk;
  const c = isUnavailable(s.citations) ? null : s.citations;
  const holds: Record<RuleId, boolean> = {
    "revert-risk-high": !!r && r.probability >= t.revertRiskLow,
    "banner-pov": !!m && m.banners.includes("pov"),
    "banner-disputed": !!m && m.banners.includes("disputed"),
    "banner-unreferenced": !!m && m.banners.includes("unreferenced"),
    "banner-more-citations": !!m && m.banners.includes("more_citations"),
    "banner-cleanup": !!m && m.banners.includes("cleanup"),
    "banner-current-event": !!m && m.banners.includes("current_event"),
    "inline-issues": !!m && m.inlineIssues >= t.inlineIssues,
    "revert-risk-medium": !!r && r.probability >= t.revertRiskMedium && r.probability < t.revertRiskLow,
    "recent-edit": !!e && e.isLatest && e.ageHours < t.recentEditHours,
    "pending-review": !!e && e.pendingReview === true,
    "revert-volatility": !!e && e.revertsInWindow >= t.revertsInWindow,
    "low-citations": !!c && c.coverage < t.citationCoverage,
  };
  return RULE_IDS.filter((id) => holds[id]);
}

const LOW_RULES = new Set<RuleId>(["revert-risk-high", "banner-pov", "banner-disputed", "banner-unreferenced"]);

const SIGNAL_LABELS: [keyof Signals, string][] = [
  ["maintenance", "Maintenance tags"],
  ["editActivity", "Edit history"],
  ["revertRisk", "Revert-risk score"],
  ["citations", "Citation coverage"],
];

const missingLabels = (s: Signals) => SIGNAL_LABELS.filter(([k]) => isUnavailable(s[k])).map(([, label]) => label);

function referenceBadge(s: Signals, t: Thresholds): ReliabilityBadge {
  const rules = referenceRules(s, t);
  if (rules.some((id) => LOW_RULES.has(id))) return "Low";
  if (rules.length > 0 || missingLabels(s).length >= t.unavailableCap) return "Medium";
  return "High";
}

/** Expected wording per rule id (from the design's rule table; numbers vary). */
const REASON_PATTERNS: Record<RuleId, RegExp> = {
  "revert-risk-high": /^This revision has a high predicted chance of being reverted \(\d\.\d\d\)$/,
  "banner-pov": /^Article is tagged as possibly not neutral \(POV\)$/,
  "banner-disputed": /^Article has a disputed factual accuracy tag$/,
  "banner-unreferenced": /^Article is tagged as citing no sources$/,
  "banner-more-citations": /^Article is tagged as needing more citations$/,
  "banner-cleanup": /^Article is tagged for cleanup$/,
  "banner-current-event": /^Article covers a current event and may change quickly$/,
  "inline-issues": /^Article has \d+ 'citation needed' or similar inline tags$/,
  "revert-risk-medium": /^This revision has a moderate predicted chance of being reverted \(\d\.\d\d\)$/,
  "recent-edit": /^The latest edit is under [\d.]+ hours old and may not have been reviewed yet$/,
  "pending-review": /^Article has edits awaiting review$/,
  "revert-volatility": /^Article had \d+ reverted edits in the 30 days before this revision$/,
  "low-citations": /^Only \d+% of paragraphs cite a source$/,
};

// strictTerms: a reason dropped for an editor term would throw instead of silently changing the count.
const STRICT = { strictTerms: true } as const;

// ---------------------------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------------------------

// Feature: reliability-scorer, Property 7: Badge follows the rule table
test("Property 7: badge follows the rule table", () => {
  fc.assert(
    fc.property(arbSignals, arbThresholds, (signals, t) => {
      const a = combineSignals(signals, t, STRICT);
      const b = combineSignals(signals, t, STRICT);
      assert.deepEqual(a, b);
      assert.equal(a.badge, referenceBadge(signals, t));
      if (missingLabels(signals).length >= 2 && t.unavailableCap <= 2) assert.notEqual(a.badge, "High");
    }),
    { numRuns: 100 },
  );
});

// Feature: reliability-scorer, Property 8: Reasons account for every rule and missing signal
test("Property 8: reasons account for every rule and missing signal", () => {
  fc.assert(
    fc.property(arbSignals, arbThresholds, (signals, t) => {
      const out = combineSignals(signals, t, STRICT);
      const expectedRules = referenceRules(signals, t);
      const missing = missingLabels(signals);

      assert.ok(out.reasons.length >= 1);
      assert.deepEqual(out.rules, expectedRules);
      assert.equal(out.reasons.length, expectedRules.length + missing.length + (out.badge === "High" ? 1 : 0));

      // One reason per fired rule, in table order, with that rule's wording.
      expectedRules.forEach((id, i) => assert.match(out.reasons[i], REASON_PATTERNS[id], `rule ${id}`));
      // Then one reason naming each Unavailable signal.
      missing.forEach((label, j) => {
        const reason = out.reasons[expectedRules.length + j];
        assert.ok(reason.startsWith(`${label} could not be checked: `), reason);
      });
      // A High badge ends with a passing-checks summary that is neither a rule nor a missing-signal reason.
      if (out.badge === "High") {
        const summary = out.reasons[out.reasons.length - 1];
        assert.ok(summary.length > 0);
        assert.doesNotMatch(summary, /could not be checked/);
      }
    }),
    { numRuns: 100 },
  );
});

/**
 * Independent check for Requirement 5.8 (user, editor, username, IP address, account; any case).
 * "username" is covered by "user". Checked on the raw text and on its lower-cased form, so odd
 * Unicode that only becomes a term after lower-casing is caught too.
 */
const EDITOR_WORDS = /user|editor|account|ip\s*address/i;
const mentionsEditor = (text: string) => EDITOR_WORDS.test(text) || EDITOR_WORDS.test(text.toLowerCase());

const TERMS = ["user", "username", "editor", "account", "IP address", "ip  address", "Users", "EDITORS"];

/** A cause with an editor term (random case) somewhere in random text, or one from arbCause. */
const arbTermCause: fc.Arbitrary<string> = fc.oneof(
  arbCause,
  fc
    .tuple(fc.string({ maxLength: 40 }), fc.mixedCase(fc.constantFrom(...TERMS)), fc.string({ maxLength: 40 }))
    .map(([a, term, b]) => `${a}${term}${b}`),
);

/** Signals where any subset of the four signals is replaced by Unavailable(cause with editor terms). */
const SIGNAL_KEYS: (keyof Signals)[] = ["maintenance", "editActivity", "revertRisk", "citations"];
const arbSignalsWithTermCauses: fc.Arbitrary<Signals> = fc
  .tuple(arbSignals, fc.subarray(SIGNAL_KEYS), fc.array(arbTermCause, { minLength: 4, maxLength: 4 }))
  .map(([base, keys, causes]) => {
    const s: Signals = { ...base };
    keys.forEach((k, i) => Object.assign(s, { [k]: unavailable(causes[i]) }));
    return s;
  });

/** Page titles, including real article titles that contain editor terms. */
const arbTitle: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    "Treaty of Versailles",
    "User interface",
    "Account (bookkeeping)",
    "IP address",
    "Video editor",
    "Username",
    "Ip",
    "",
  ),
  fc.mixedCase(fc.constantFrom(...TERMS)),
  fc.string({ maxLength: 40 }),
);

// Feature: reliability-scorer, Property 9: Reasons never describe editors
test("Property 9: reasons never describe editors", () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ page_title: arbTitle, signals: arbSignalsWithTermCauses, rev: fc.nat() }), {
        minLength: 1,
        maxLength: 5,
      }),
      arbThresholds,
      (pages, t) => {
        // Strict mode: a template wording mistake would throw rather than be dropped silently.
        const scores = pages.map(({ page_title, signals, rev }) => ({
          page_title,
          score: combineSignals(signals, t, { revisionId: rev, strictTerms: true }),
        }));
        for (const { score } of scores) {
          assert.ok(score.reasons.length >= 1);
          for (const reason of score.reasons) assert.ok(!mentionsEditor(reason), `combineSignals: ${reason}`);
        }
        const card = aggregateScores(scores);
        assert.ok(card.reasons.length >= 1);
        for (const reason of card.reasons) assert.ok(!mentionsEditor(reason), `aggregateScores: ${reason}`);
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: reliability-scorer, Property 10: Worse signals never improve the badge
test("Property 10: worse signals never improve the badge", () => {
  fc.assert(
    fc.property(arbSignals, arbThresholds, arbWorsening, (signals, t, step) => {
      const worse = applyWorsening(signals, step);
      fc.pre(worse !== undefined);
      const before = combineSignals(signals, t, STRICT).badge;
      const after = combineSignals(worse!, t, STRICT).badge;
      assert.ok(BADGE_RANK[after] <= BADGE_RANK[before], `${step.kind}: ${before} -> ${after}`);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------------------------
// Unit tests: one worked example per rule (default thresholds)
// ---------------------------------------------------------------------------------------------

/** A clean revision: no banners, old non-latest revision, low revert risk, 87% coverage. Scores High. */
const clean = (): Signals => ({
  maintenance: { banners: [], inlineIssues: 0 },
  editActivity: { ageHours: 24 * 30, isLatest: false, editsInWindow: 5, revertsInWindow: 0, pendingReview: null },
  revertRisk: { probability: 0.08 },
  citations: { coverage: 0.87, prose: 100, cited: 87, refCount: 240 },
});

const withMaintenance = (patch: Partial<MaintenanceSignal>): Signals => {
  const s = clean();
  return { ...s, maintenance: { ...(s.maintenance as MaintenanceSignal), ...patch } };
};
const withEdit = (patch: Partial<EditActivitySignal>): Signals => {
  const s = clean();
  return { ...s, editActivity: { ...(s.editActivity as EditActivitySignal), ...patch } };
};

const EXAMPLES: { id: RuleId; badge: ReliabilityBadge; signals: Signals; reason: string }[] = [
  {
    id: "revert-risk-high",
    badge: "Low",
    signals: { ...clean(), revertRisk: { probability: 0.83 } },
    reason: "This revision has a high predicted chance of being reverted (0.83)",
  },
  {
    id: "banner-pov",
    badge: "Low",
    signals: withMaintenance({ banners: ["pov"] }),
    reason: "Article is tagged as possibly not neutral (POV)",
  },
  {
    id: "banner-disputed",
    badge: "Low",
    signals: withMaintenance({ banners: ["disputed"] }),
    reason: "Article has a disputed factual accuracy tag",
  },
  {
    id: "banner-unreferenced",
    badge: "Low",
    signals: withMaintenance({ banners: ["unreferenced"] }),
    reason: "Article is tagged as citing no sources",
  },
  {
    id: "banner-more-citations",
    badge: "Medium",
    signals: withMaintenance({ banners: ["more_citations"] }),
    reason: "Article is tagged as needing more citations",
  },
  {
    id: "banner-cleanup",
    badge: "Medium",
    signals: withMaintenance({ banners: ["cleanup"] }),
    reason: "Article is tagged for cleanup",
  },
  {
    id: "banner-current-event",
    badge: "Medium",
    signals: withMaintenance({ banners: ["current_event"] }),
    reason: "Article covers a current event and may change quickly",
  },
  {
    id: "inline-issues",
    badge: "Medium",
    signals: withMaintenance({ inlineIssues: 14 }),
    reason: "Article has 14 'citation needed' or similar inline tags",
  },
  {
    id: "revert-risk-medium",
    badge: "Medium",
    signals: { ...clean(), revertRisk: { probability: 0.52 } },
    reason: "This revision has a moderate predicted chance of being reverted (0.52)",
  },
  {
    id: "recent-edit",
    badge: "Medium",
    signals: withEdit({ isLatest: true, ageHours: 3 }),
    reason: "The latest edit is under 24 hours old and may not have been reviewed yet",
  },
  {
    id: "pending-review",
    badge: "Medium",
    signals: withEdit({ pendingReview: true }),
    reason: "Article has edits awaiting review",
  },
  {
    id: "revert-volatility",
    badge: "Medium",
    signals: withEdit({ editsInWindow: 12, revertsInWindow: 5 }),
    reason: "Article had 5 reverted edits in the 30 days before this revision",
  },
  {
    id: "low-citations",
    badge: "Medium",
    signals: { ...clean(), citations: { coverage: 0.32, prose: 25, cited: 8, refCount: 9 } },
    reason: "Only 32% of paragraphs cite a source",
  },
];

test("worked examples cover every rule id", () => {
  assert.deepEqual(EXAMPLES.map((e) => e.id), [...RULE_IDS]);
});

for (const ex of EXAMPLES) {
  test(`rule ${ex.id}: ${ex.badge} with its reason`, () => {
    const out = combineSignals(ex.signals, DEFAULT_THRESHOLDS, { revisionId: 42, strictTerms: true });
    assert.equal(out.badge, ex.badge);
    assert.deepEqual(out.rules, [ex.id]);
    assert.deepEqual(out.reasons, [ex.reason]);
    assert.equal(out.revision_id, 42);
  });
}

test("clean revision is High with a passing-checks summary", () => {
  const out = combineSignals(clean(), DEFAULT_THRESHOLDS, STRICT);
  assert.equal(out.badge, "High");
  assert.deepEqual(out.rules, []);
  assert.equal(out.reasons.length, 1);
  assert.match(out.reasons[0], /^No maintenance banners or inline issue tags; low predicted revert risk \(0\.08\)/);
  assert.match(out.reasons[0], /87% of paragraphs cite a source$/);
});

test("Treaty of Versailles-like case: inline issues below the threshold and no banners give High", () => {
  const out = combineSignals(withMaintenance({ inlineIssues: 4 }), DEFAULT_THRESHOLDS, STRICT);
  assert.equal(out.badge, "High");
  assert.deepEqual(out.rules, []);
  assert.equal(out.reasons.length, 1);
  assert.match(out.reasons[0], /^No maintenance banners; only 4 inline issue tags; /);
});

test("thresholds are inclusive: risk at revertRiskLow is Low, 0.4 is Medium, 10 inline tags is Medium", () => {
  const low = DEFAULT_THRESHOLDS.revertRiskLow;
  assert.equal(combineSignals({ ...clean(), revertRisk: { probability: low } }).badge, "Low");
  assert.equal(combineSignals({ ...clean(), revertRisk: { probability: low - 0.01 } }).badge, "Medium");
  assert.equal(combineSignals({ ...clean(), revertRisk: { probability: 0.4 } }).badge, "Medium");
  assert.equal(combineSignals(withMaintenance({ inlineIssues: 10 })).badge, "Medium");
  assert.equal(combineSignals(withMaintenance({ inlineIssues: 9 })).badge, "High");
});

test("two Unavailable signals cap the badge at Medium and are named in the reasons", () => {
  const s: Signals = {
    ...clean(),
    revertRisk: unavailable("timeout after 5000 ms"),
    citations: unavailable("no prose paragraphs"),
  };
  const out = combineSignals(s, DEFAULT_THRESHOLDS, STRICT);
  assert.equal(out.badge, "Medium");
  assert.deepEqual(out.rules, []);
  assert.deepEqual(out.reasons, [
    "Revert-risk score could not be checked: timeout after 5000 ms",
    "Citation coverage could not be checked: no prose paragraphs",
  ]);
});
