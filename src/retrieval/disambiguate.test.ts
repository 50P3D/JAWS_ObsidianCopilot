import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chooseSenses, expandDisambiguations, rankSenses, type Sense } from "./disambiguate";
import { clearCustomFetch, fetchSenses, isDisambiguation, setCustomFetch, type WikiPage } from "./wikipedia";

const CLAIM = "Mercury is the closest planet to the Sun.";

const SENSES: Sense[] = [
  { title: "Mercury (element)", intro: "Mercury is a chemical element with the symbol Hg. It is a heavy silvery metal that is liquid at room temperature." },
  { title: "Mercury (planet)", intro: "Mercury is the first planet from the Sun and the smallest in the Solar System." },
  { title: "Mercury (mythology)", intro: "Mercury is a god in Roman religion and mythology, the messenger of the gods." },
];

// ── rankSenses ─────────────────────────────────────────────────────

test("rankSenses puts the sense whose introduction matches the claim first", () => {
  const ranked = rankSenses(CLAIM, SENSES);
  assert.equal(ranked[0].title, "Mercury (planet)");
  assert.equal(ranked.length, 3);
});

test("rankSenses sorts from best to worst", () => {
  const scores = rankSenses(CLAIM, SENSES).map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test("rankSenses gives a bonus when the claim names the bracketed qualifier", () => {
  const withBonus = rankSenses("The element is toxic.", [{ title: "Mercury (element)", intro: "A metal." }]);
  const without = rankSenses("It is toxic.", [{ title: "Mercury (element)", intro: "A metal." }]);
  assert.ok(withBonus[0].score > without[0].score);
});

test("rankSenses returns nothing for no senses", () => {
  assert.deepEqual(rankSenses(CLAIM, []), []);
});

// ── chooseSenses ───────────────────────────────────────────────────

test("chooseSenses picks the planet for a claim about the closest planet", () => {
  assert.deepEqual(chooseSenses(CLAIM, SENSES), ["Mercury (planet)"]);
});

test("chooseSenses picks the element for a claim about a liquid metal", () => {
  assert.deepEqual(chooseSenses("Mercury is a metal that is liquid at room temperature.", SENSES), ["Mercury (element)"]);
});

test("chooseSenses picks the god for a claim about Roman religion", () => {
  assert.deepEqual(chooseSenses("Mercury was the messenger of the gods in Roman religion.", SENSES), ["Mercury (mythology)"]);
});

test("chooseSenses keeps two senses when they score almost the same", () => {
  const senses: Sense[] = [
    { title: "Apollo (mission)", intro: "Apollo was a programme of crewed moon landings." },
    { title: "Apollo (god)", intro: "Apollo was a god of music, and of crewed journeys in myth." },
  ];
  const chosen = chooseSenses("Apollo crewed.", senses);
  assert.equal(chosen.length, 2);
});

test("chooseSenses returns nothing when no sense fits the claim", () => {
  assert.deepEqual(chooseSenses("Quantum computers use qubits.", SENSES), []);
});

test("chooseSenses never returns more than the limit", () => {
  const senses: Sense[] = [1, 2, 3, 4].map((n) => ({ title: `Thing (${n})`, intro: "shared words appear here" }));
  assert.equal(chooseSenses("shared words appear here", senses, { max: 3 }).length, 3);
  assert.equal(chooseSenses("shared words appear here", senses, { max: 1 }).length, 1);
});

test("chooseSenses returns nothing for no senses", () => {
  assert.deepEqual(chooseSenses(CLAIM, []), []);
});

// ── expandDisambiguations ──────────────────────────────────────────

const page = (title: string, pageid: number, extra: Partial<WikiPage> = {}): WikiPage => ({
  title,
  pageid,
  revision_id: pageid * 10,
  revision_timestamp: "2026-01-01T00:00:00Z",
  url: `https://en.wikipedia.org/w/index.php?title=${title}`,
  text: `${title} article text.`,
  ...extra,
});

const MERCURY_DISAMBIG = page("Mercury", 1, { disambiguation: true, text: "Mercury may refer to:" });
const PLANET = page("Mercury (planet)", 2);

function deps(over: Partial<Parameters<typeof expandDisambiguations>[2]> = {}) {
  return {
    fetchSenses: async () => SENSES,
    fetchPage: async (title: string) => (title === "Mercury (planet)" ? PLANET : null),
    ...over,
  };
}

test("expandDisambiguations leaves ordinary pages alone", async () => {
  const ordinary = page("Solar System", 5);
  assert.deepEqual(await expandDisambiguations(CLAIM, [ordinary], deps()), [ordinary]);
});

test("expandDisambiguations replaces a disambiguation page with the matching sense, in place", async () => {
  const before = page("Solar System", 5);
  const after = page("Sun", 6);
  const result = await expandDisambiguations(CLAIM, [before, MERCURY_DISAMBIG, after], deps());
  assert.deepEqual(result.map((p) => p.title), ["Solar System", "Mercury (planet)", "Sun"]);
});

test("expandDisambiguations does not repeat a page that is already in the list", async () => {
  const result = await expandDisambiguations(CLAIM, [PLANET, MERCURY_DISAMBIG], deps());
  assert.deepEqual(result.map((p) => p.title), ["Mercury (planet)"]);
});

test("expandDisambiguations drops a disambiguation page when no sense fits", async () => {
  const result = await expandDisambiguations("Quantum computers use qubits.", [MERCURY_DISAMBIG], deps());
  assert.deepEqual(result, []);
});

test("expandDisambiguations drops a disambiguation page when looking up the senses fails", async () => {
  const result = await expandDisambiguations(
    CLAIM,
    [MERCURY_DISAMBIG, page("Sun", 6)],
    deps({ fetchSenses: async () => { throw new Error("network down"); } }),
  );
  assert.deepEqual(result.map((p) => p.title), ["Sun"]);
});

test("expandDisambiguations skips missing pages", async () => {
  const result = await expandDisambiguations(CLAIM, [null, page("Sun", 6), null], deps());
  assert.deepEqual(result.map((p) => p.title), ["Sun"]);
});

test("expandDisambiguations never lets another disambiguation page through", async () => {
  const nested = page("Mercury (disambiguation)", 9, { disambiguation: true, text: "Mercury may also refer to:" });
  const result = await expandDisambiguations(CLAIM, [MERCURY_DISAMBIG], deps({ fetchPage: async () => nested }));
  assert.deepEqual(result, []);
});

test("expandDisambiguations skips a sense whose page cannot be fetched", async () => {
  const result = await expandDisambiguations(CLAIM, [MERCURY_DISAMBIG], deps({ fetchPage: async () => null }));
  assert.deepEqual(result, []);
});

test("expandDisambiguations looks up the senses of the disambiguation page by its title", async () => {
  const asked: string[] = [];
  await expandDisambiguations(CLAIM, [MERCURY_DISAMBIG], deps({ fetchSenses: async (t: string) => { asked.push(t); return SENSES; } }));
  assert.deepEqual(asked, ["Mercury"]);
});

// ── wikipedia.ts: isDisambiguation and fetchSenses ─────────────────

afterEach(() => clearCustomFetch());

test("isDisambiguation trusts the page's own disambiguation flag", () => {
  assert.equal(isDisambiguation(page("Mercury", 1, { disambiguation: true, text: "A long text with no giveaway words." })), true);
  assert.equal(isDisambiguation(page("Mercury (planet)", 2, { disambiguation: false, text: "Mercury may refer to a planet." })), false);
});

test("isDisambiguation still spots 'may refer to' when there is no flag", () => {
  assert.equal(isDisambiguation(page("Mercury", 1, { text: "Mercury may refer to:\n- the planet" })), true);
  assert.equal(isDisambiguation(page("Sun", 3, { text: "The Sun is a star." })), false);
});

function fakeWiki(body: unknown) {
  const urls: string[] = [];
  setCustomFetch(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return urls;
}

test("fetchSenses reads the linked articles' titles and introductions in one request", async () => {
  const urls = fakeWiki({
    query: {
      pages: [
        { title: "Mercury (planet)", extract: "Mercury is the first planet from the Sun." },
        { title: "Mercury (element)", extract: "Mercury is a chemical element." },
      ],
    },
  });
  const senses = await fetchSenses("Mercury");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /generator=links/);
  assert.match(urls[0], /titles=Mercury/);
  assert.deepEqual(senses.map((s) => s.title).sort(), ["Mercury (element)", "Mercury (planet)"]);
  assert.equal(senses.find((s) => s.title === "Mercury (planet)")!.intro, "Mercury is the first planet from the Sun.");
});

test("fetchSenses leaves out missing pages, empty introductions, other disambiguation pages and the page itself", async () => {
  fakeWiki({
    query: {
      pages: [
        { title: "Mercury (planet)", extract: "Mercury is the first planet." },
        { title: "Gone", missing: true },
        { title: "Blank", extract: "" },
        { title: "Mercury (disambiguation)", extract: "Mercury may refer to:", pageprops: { disambiguation: "" } },
        { title: "Mercury", extract: "Mercury may refer to:" },
      ],
    },
  });
  const senses = await fetchSenses("Mercury");
  assert.deepEqual(senses.map((s) => s.title), ["Mercury (planet)"]);
});

test("fetchSenses returns an empty list when the answer has no pages", async () => {
  fakeWiki({});
  assert.deepEqual(await fetchSenses("Mercury"), []);
});

test("fetchSenses throws when Wikipedia answers with an error", async () => {
  setCustomFetch(async () => new Response("no", { status: 503, statusText: "Service Unavailable" }));
  await assert.rejects(fetchSenses("Mercury"), /503/);
});
