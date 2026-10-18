import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { BANNER_RULES, classifyMaintenance, countInlineIssues } from "./tags";
import type { BannerKind } from "./types";

const ALL_KINDS: readonly BannerKind[] = ["pov", "disputed", "unreferenced", "more_citations", "cleanup", "current_event"];

/** Category names (in Wikipedia's own spelling) that match each rule's category regexes. */
const CATEGORY_EXAMPLES: Record<BannerKind, string[]> = {
  pov: ["All NPOV disputes", "NPOV disputes from May 2024"],
  disputed: ["All accuracy disputes", "Accuracy disputes from June 2023"],
  unreferenced: ["All articles lacking sources", "Articles lacking sources from January 2021"],
  more_citations: ["All articles needing additional references", "Articles needing additional references from March 2019"],
  cleanup: [
    "All articles needing cleanup",
    "All pages needing cleanup",
    "Articles needing cleanup from April 2022",
    "Articles with style issues",
    "All articles with style issues",
    "Wikipedia articles with style issues",
    "Articles with style issues from October 2020",
  ],
  current_event: [],
};

/** Real-looking names that must not match any banner rule (including near misses). */
const UNRELATED_CATEGORIES = [
  "Living people",
  "Articles with short description",
  "Short description is different from Wikidata",
  "Use dmy dates from May 2024",
  "Articles with dead external links from May 2024",
  "CS1 maint: archived copy as title",
  "All articles with unsourced statements",
  "Accuracy",
];
const UNRELATED_TEMPLATES = [
  "Infobox country",
  "Reflist",
  "Citation needed",
  "Cn",
  "Cite web",
  "Cleanup bare URLs",
  "Current events portal",
  "Short description",
  "Povray",
];

interface Named {
  name: string;
  kind: BannerKind | null;
}

const bannerCategory: fc.Arbitrary<Named> = fc.constantFrom(
  ...BANNER_RULES.flatMap((r) => CATEGORY_EXAMPLES[r.kind].map((name) => ({ name, kind: r.kind }))),
);
const bannerTemplate: fc.Arbitrary<Named> = fc.constantFrom(
  ...BANNER_RULES.flatMap((r) => r.templates.map((name) => ({ name, kind: r.kind }))),
);
/** Random names prefixed with `zz` cannot equal any template name or match any anchored category regex. */
const randomUnrelated: fc.Arbitrary<Named> = fc
  .stringMatching(/^[a-z0-9 ]{0,20}$/)
  .map((s) => ({ name: `zz ${s}`, kind: null }));
const unrelatedCategory: fc.Arbitrary<Named> = fc.oneof(
  fc.constantFrom(...UNRELATED_CATEGORIES.map((name) => ({ name, kind: null }))),
  randomUnrelated,
);
const unrelatedTemplate: fc.Arbitrary<Named> = fc.oneof(
  fc.constantFrom(...UNRELATED_TEMPLATES.map((name) => ({ name, kind: null }))),
  randomUnrelated,
);

/** Rewrites a name with random letter case, `_` for some spaces and an optional namespace prefix. */
const formatted = (base: fc.Arbitrary<Named>): fc.Arbitrary<Named> =>
  fc
    .tuple(
      base,
      fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
      fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
      fc.constantFrom("", "Template:", "Category:", "template:", "CATEGORY:", "Template: ", "Category:_"),
      fc.constantFrom("", " ", "  "),
    )
    .map(([n, upper, underscore, prefix, pad]) => {
      const body = [...n.name]
        .map((ch, i) => {
          if (ch === " ") return underscore[i % 64] ? "_" : " ";
          return upper[i % 64] ? ch.toUpperCase() : ch.toLowerCase();
        })
        .join("");
      return { name: `${pad}${prefix}${body}${pad}`, kind: n.kind };
    });

const categoryList = fc.array(formatted(fc.oneof(bannerCategory, unrelatedCategory)), { maxLength: 8 });
const templateList = fc.array(formatted(fc.oneof(bannerTemplate, unrelatedTemplate)), { maxLength: 8 });

// Feature: reliability-scorer, Property 1: Banner classification ignores name formatting
// **Validates: Requirements 1.2, 1.4**
test("Property 1: banner classification ignores name formatting", () => {
  fc.assert(
    fc.property(categoryList, templateList, (cats, temps) => {
      const expected = new Set([...cats, ...temps].map((n) => n.kind).filter((k): k is BannerKind => k !== null));
      const { banners } = classifyMaintenance(
        cats.map((n) => n.name),
        temps.map((n) => n.name),
        "",
      );
      // Exactly the distinct kinds of the drawn names, once each, in BANNER_RULES order.
      assert.deepEqual(
        banners,
        BANNER_RULES.map((r) => r.kind).filter((k) => expected.has(k)),
      );
      assert.equal(new Set(banners).size, banners.length);
      for (const k of banners) assert.ok(ALL_KINDS.includes(k));
    }),
    { numRuns: 100 },
  );
});

const INLINE_ALIASES = ["citation needed", "cn", "fact", "failed verification", "dubious", "clarification needed"];

/** One inline issue tag: random alias, case, word separator, optional prefix, whitespace and parameters. */
const inlineTag: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...INLINE_ALIASES),
    fc.array(fc.boolean(), { minLength: 32, maxLength: 32 }),
    fc.constantFrom(" ", "_", "  ", "__", " _"),
    fc.constantFrom("", "Template:", "template:", "TEMPLATE : "),
    fc.constantFrom("", " ", "\n"),
    fc.constantFrom("", " ", "\n"),
    fc.option(fc.constantFrom("|date=May 2024", "|reason=Source does not say this", "|date=June 2021|reason=see talk"), {
      nil: "",
    }),
  )
  .map(([alias, upper, sep, prefix, wsOpen, wsClose, params]) => {
    const name = [...alias.split(" ").join(sep)]
      .map((ch, i) => (upper[i % 32] ? ch.toUpperCase() : ch.toLowerCase()))
      .join("");
    return `{{${wsOpen}${prefix}${name}${wsClose}${params}}}`;
  });

/**
 * Filler wikitext with no inline issue tags. Free text never contains `{`, so a tag can only start
 * inside one of the fixed templates, and those are near misses that the regex must not count.
 */
const filler: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9 .,;:'"\-\n=*|]{0,40}$/),
  fc.constantFrom(
    "{{Infobox person|name=Jane Doe}}",
    "{{reflist}}",
    "{{citation|title=A book}}",
    "{{cite web|url=https://example.org|title=Example}}",
    "{{fact sheet}}",
    "{{factual accuracy}}",
    "{{cnn}}",
    "{{Clarification}}",
    "{{dubious-ish}}",
    "{{Failed}}",
    "{{Template:Reflist}}",
    "<ref>Smith 2001, p. 4.</ref>",
    "[[Category:Living people]]",
  ),
);

const docPart = fc.oneof(
  filler.map((text) => ({ text, tag: false })),
  inlineTag.map((text) => ({ text, tag: true })),
);

// Feature: reliability-scorer, Property 2: Inline issue count
// **Validates: Requirements 1.3**
test("Property 2: inline issue count equals the number of inserted tags", () => {
  fc.assert(
    fc.property(fc.array(docPart, { maxLength: 20 }), (parts) => {
      const wikitext = parts.map((p) => p.text).join("");
      const k = parts.filter((p) => p.tag).length;
      assert.equal(classifyMaintenance([], [], wikitext).inlineIssues, k);
      assert.equal(countInlineIssues(wikitext), k);
    }),
    { numRuns: 100 },
  );
});
