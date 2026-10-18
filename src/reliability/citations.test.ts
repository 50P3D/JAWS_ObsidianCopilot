import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { citationCoverage, proseParagraphs } from "./citations";
import { isUnavailable } from "./types";

const PROSE = "The treaty was signed in the Hall of Mirrors at the Palace of Versailles. ".repeat(4).trim();

test("proseParagraphs drops non-prose blocks and short paragraphs", () => {
  const text = [
    "== Background ==",
    `* ${PROSE}`,
    `{| class="wikitable"\n| ${PROSE}\n|}`,
    `{{Infobox treaty | name = ${PROSE} }}`,
    `[[File:Treaty.jpg|thumb|${PROSE}]]`,
    `[[category:Treaties]] ${PROSE}`,
    `<!-- ${PROSE} -->`,
    "A short paragraph.",
    PROSE,
  ].join("\n\n");
  assert.deepEqual(proseParagraphs(text), [PROSE]);
});

test("citationCoverage counts cited paragraphs and ref openings", () => {
  const text = [
    `${PROSE}<ref name="a">Smith 2001</ref><ref name="a" />`,
    `${PROSE}{{SFN|Jones|1999|p=4}}`,
    `${PROSE}{{harvnb|Lee|2010}}`,
    PROSE,
    "== References ==",
    "{{reflist}}<references />",
  ].join("\r\n\r\n");
  assert.deepEqual(citationCoverage(text), { coverage: 0.75, prose: 4, cited: 3, refCount: 2 });
});

test("citationCoverage is Unavailable without prose paragraphs", () => {
  const result = citationCoverage("== Heading ==\n\n* item\n\nToo short.");
  assert.ok(isUnavailable(result));
  assert.equal(result.cause, "no prose paragraphs");
});

// ---------------------------------------------------------------------------------------------
// Property-based test
// ---------------------------------------------------------------------------------------------

/** Plain lowercase words (5+ letters) that cannot form citation markup or a non-prose opening. */
const WORDS = [
  "treaty", "signed", "palace", "mirrors", "europe", "nations", "council", "history",
  "kingdom", "empire", "settled", "border", "region", "armies", "peace", "summit",
];
const word = fc.constantFrom(...WORDS);

/** A run of words joined by spaces or single newlines (never a blank line). */
const words = (min: number, max: number) =>
  fc
    .tuple(fc.array(word, { minLength: min, maxLength: max }), fc.array(fc.constantFrom(" ", "\n"), { minLength: max }))
    .map(([ws, seps]) => ws.map((w, i) => (i === 0 ? w : seps[i] + w)).join(""));

/** At least 40 words of 5+ letters plus separators gives at least 239 characters. */
const longText = words(40, 70);
/** At most 10 words of at most 7 letters plus separators stays below 200 characters. */
const shortText = words(1, 10);

/** Citation markup with the number of `<ref` openings it contains. */
const citation: fc.Arbitrary<{ markup: string; refs: number }> = fc.constantFrom(
  { markup: "<ref>Smith 2001</ref>", refs: 1 },
  { markup: '<REF name="a">Smith 2001</REF>', refs: 1 },
  { markup: '<ref name="a" />', refs: 1 },
  { markup: "<ref/>", refs: 1 },
  { markup: "{{sfn|Jones|1999|p=4}}", refs: 0 },
  { markup: "{{ SFN|Jones|1999}}", refs: 0 },
  { markup: "{{harvnb|Lee|2010}}", refs: 0 },
  { markup: "{{Harvnb |Lee|2010}}", refs: 0 },
);

/** Inserts citation markup after the first word, so the block still opens with a plain word. */
const withCitation = (text: string, markup: string) => {
  const cut = text.search(/[ \n]/);
  return cut < 0 ? text + markup : text.slice(0, cut) + markup + text.slice(cut);
};

/** Optional citation markup for a text, tracking whether it cites and how many `<ref` it opens. */
const maybeCited = (text: fc.Arbitrary<string>) =>
  fc.tuple(text, fc.option(citation, { nil: undefined })).map(([t, c]) => ({
    text: c ? withCitation(t, c.markup) : t,
    cited: c !== undefined,
    refs: c ? c.refs : 0,
  }));

type Block = { text: string; prose: boolean; cited: boolean; refs: number };

const proseBlock: fc.Arbitrary<Block> = maybeCited(longText).map((b) => ({ ...b, prose: true }));

/** Non-prose blocks: each opens with an excluded prefix, or is a short paragraph. */
const nonProseBlock: fc.Arbitrary<Block> = fc
  .tuple(
    maybeCited(fc.oneof(longText, shortText)),
    fc.constantFrom(
      (t: string) => `== ${t.replace(/\n/g, " ")} ==`,
      (t: string) => `* ${t}`,
      (t: string) => `# ${t}`,
      (t: string) => `: ${t}`,
      (t: string) => `; ${t}`,
      (t: string) => `{| class="wikitable"\n| ${t}\n|}`,
      (t: string) => `| ${t}`,
      (t: string) => `! ${t}`,
      (t: string) => `{{Infobox treaty | name = ${t} }}`,
      (t: string) => `[[File:Treaty.jpg|thumb|${t}]]`,
      (t: string) => `[[ image : Treaty.png|${t}]]`,
      (t: string) => `[[Category:Treaties]] ${t}`,
      (t: string) => `<!-- ${t} -->`,
    ),
    maybeCited(shortText),
    fc.boolean(),
  )
  .map(([b, wrap, short, useShort]) =>
    useShort
      ? { text: short.text, prose: false, cited: false, refs: short.refs }
      : { text: wrap(b.text), prose: false, cited: false, refs: b.refs },
  );

/** Blank-line separators, including whitespace-only lines and Windows line endings. */
const separator = fc.constantFrom("\n\n", "\n \n", "\n\t\n\n", "\r\n\r\n", "\n\n\n");

// Feature: reliability-scorer, Property 6: Citation coverage
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
test("Property 6: citationCoverage is cited / prose over prose paragraphs only", () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(proseBlock, nonProseBlock), { maxLength: 12 }),
      fc.array(separator, { minLength: 12 }),
      fc.constantFrom("", "\n", "  \n"),
      (blocks, seps, edge) => {
        const text = edge + blocks.map((b, i) => (i === 0 ? b.text : seps[i] + b.text)).join("") + edge;
        const prose = blocks.filter((b) => b.prose);
        const cited = prose.filter((b) => b.cited).length;
        const refCount = blocks.reduce((n, b) => n + b.refs, 0);

        assert.deepEqual(
          proseParagraphs(text),
          prose.map((b) => b.text),
        );

        const result = citationCoverage(text);
        if (prose.length === 0) {
          assert.ok(isUnavailable(result));
          assert.equal(result.cause, "no prose paragraphs");
          return;
        }
        assert.ok(!isUnavailable(result));
        assert.deepEqual(result, { coverage: cited / prose.length, prose: prose.length, cited, refCount });
        assert.ok(result.coverage >= 0 && result.coverage <= 1);
      },
    ),
    { numRuns: 100 },
  );
});
