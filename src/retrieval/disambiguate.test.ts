import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chooseSenses, expandDisambiguations, rankSenses, type Sense } from "./disambiguate";
import { clearCustomFetch, fetchPage, fetchSenses, isDisambiguation, pickSenseTitles, setCustomFetch, type WikiPage } from "./wikipedia";

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

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Fake Wikipedia for fetchSenses: one answer for the list of links, one for each batch of introductions. */
function fakeSenseWiki(links: string[], extracts: Record<string, any> = {}) {
  const urls: string[] = [];
  setCustomFetch(async (url: string) => {
    urls.push(url);
    const u = new URL(url);
    if (u.searchParams.get("prop") === "links") {
      return json({ query: { pages: [{ title: "Mercury", links: links.map((title) => ({ ns: 0, title })) }] } });
    }
    const titles = (u.searchParams.get("titles") ?? "").split("|");
    return json({ query: { pages: titles.map((t) => extracts[t] ?? { title: t, extract: `${t} introduction.` }) } });
  });
  return urls;
}

test("fetchSenses lists the page's links first and then reads their introductions", async () => {
  const urls = fakeSenseWiki(["Mercury (planet)", "Mercury (element)"], {
    "Mercury (planet)": { title: "Mercury (planet)", extract: "Mercury is the first planet from the Sun." },
    "Mercury (element)": { title: "Mercury (element)", extract: "Mercury is a chemical element." },
  });
  const senses = await fetchSenses("Mercury");
  assert.equal(urls.length, 2);
  assert.match(urls[0], /prop=links/);
  assert.match(urls[0], /titles=Mercury/);
  assert.match(urls[1], /exintro=1/);
  assert.deepEqual(senses.map((s) => s.title), ["Mercury (planet)", "Mercury (element)"]);
  assert.equal(senses[0].intro, "Mercury is the first planet from the Sun.");
});

test("fetchSenses reads the introductions of 'Name (...)' links even when they are far down the list", async () => {
  const others = Array.from({ length: 30 }, (_, i) => `Aardvark ${i}`);
  fakeSenseWiki([...others, "Mercury (planet)"]);
  const senses = await fetchSenses("Mercury", 5);
  assert.ok(senses.some((s) => s.title === "Mercury (planet)"));
  assert.equal(senses.length, 5);
});

test("fetchSenses asks for introductions in batches of at most 20 titles", async () => {
  const links = Array.from({ length: 45 }, (_, i) => `Mercury (sense ${i})`);
  const urls = fakeSenseWiki(links);
  const senses = await fetchSenses("Mercury", 45);
  assert.equal(urls.length, 1 + 3);
  for (const url of urls.slice(1)) {
    assert.ok((new URL(url).searchParams.get("titles") ?? "").split("|").length <= 20);
  }
  assert.equal(senses.length, 45);
});

test("fetchSenses leaves out missing pages, empty introductions, other disambiguation pages and the page itself", async () => {
  fakeSenseWiki(["Mercury (planet)", "Gone", "Blank", "Mercury (disambiguation)", "Mercury"], {
    "Mercury (planet)": { title: "Mercury (planet)", extract: "Mercury is the first planet." },
    Gone: { title: "Gone", missing: true },
    Blank: { title: "Blank", extract: "" },
    "Mercury (disambiguation)": { title: "Mercury (disambiguation)", extract: "Mercury may refer to:", pageprops: { disambiguation: "" } },
    Mercury: { title: "Mercury", extract: "Mercury may refer to:" },
  });
  const senses = await fetchSenses("Mercury");
  assert.deepEqual(senses.map((s) => s.title), ["Mercury (planet)"]);
});

test("fetchSenses makes only one request when the page has no links", async () => {
  const urls = fakeSenseWiki([]);
  assert.deepEqual(await fetchSenses("Mercury"), []);
  assert.equal(urls.length, 1);
});

test("fetchSenses throws when Wikipedia answers with an error", async () => {
  setCustomFetch(async () => new Response("no", { status: 503, statusText: "Service Unavailable" }));
  await assert.rejects(fetchSenses("Mercury"), /503/);
});

// ── pickSenseTitles ────────────────────────────────────────────────

test("pickSenseTitles puts 'Name (...)' titles first and keeps the rest in order", () => {
  const picked = pickSenseTitles("Mercury", ["Bristol Mercury", "Mercury (planet)", "HMS Mercury", "Mercury (element)"], 10);
  assert.deepEqual(picked, ["Mercury (planet)", "Mercury (element)", "Bristol Mercury", "HMS Mercury"]);
});

test("pickSenseTitles ignores capital letters in the name", () => {
  assert.deepEqual(pickSenseTitles("mercury", ["Zed", "MERCURY (planet)"], 10), ["MERCURY (planet)", "Zed"]);
});

test("pickSenseTitles leaves out the page itself, '(disambiguation)' pages and repeats", () => {
  const picked = pickSenseTitles("Mercury", ["Mercury", "Mercury (disambiguation)", "Mercury (planet)", "Mercury (planet)"], 10);
  assert.deepEqual(picked, ["Mercury (planet)"]);
});

test("pickSenseTitles never returns more than the limit", () => {
  const links = Array.from({ length: 10 }, (_, i) => `Mercury (${i})`);
  assert.equal(pickSenseTitles("Mercury", links, 3).length, 3);
});

test("pickSenseTitles falls back to the first links when none look like senses", () => {
  assert.deepEqual(pickSenseTitles("Mercury", ["Alpha", "Beta", "Gamma"], 2), ["Alpha", "Beta"]);
});

test("pickSenseTitles returns nothing for no links", () => {
  assert.deepEqual(pickSenseTitles("Mercury", [], 5), []);
});

function pageAnswer(title: string, extract: string, pageprops?: Record<string, string>) {
  return { query: { pages: [{ title, pageid: 7, extract, revisions: [{ revid: 70, timestamp: "2026-01-01T00:00:00Z" }], ...(pageprops ? { pageprops } : {}) }] } };
}

test("fetchPage marks a page flagged as a disambiguation page by Wikipedia", async () => {
  fakeWiki(pageAnswer("Mercury", "A long text that never says the giveaway words.", { disambiguation: "" }));
  assert.equal((await fetchPage("Mercury"))!.disambiguation, true);
});

test("fetchPage marks a page whose text says 'may refer to' even without the flag", async () => {
  fakeWiki(pageAnswer("Mercury", "Mercury may refer to:\n- the planet"));
  assert.equal((await fetchPage("Mercury"))!.disambiguation, true);
});

test("fetchPage does not mark an ordinary article", async () => {
  fakeWiki(pageAnswer("Mercury (planet)", "Mercury is the first planet from the Sun."));
  assert.equal((await fetchPage("Mercury (planet)"))!.disambiguation, false);
});

test("fetchPage asks Wikipedia for the disambiguation flag", async () => {
  const urls = fakeWiki(pageAnswer("Mercury (planet)", "Mercury is the first planet."));
  await fetchPage("Mercury (planet)");
  assert.match(urls[0], /pageprops/);
  assert.match(urls[0], /ppprop=disambiguation/);
});

// ── second pass: pin the numbers (added after the first Grok review) ──

const approx = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const WORDS10 = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10";
/** A meaning whose introduction shares the first `hits` of the ten claim words. */
const withHits = (title: string, hits: number): Sense => ({
  title,
  intro: Array.from({ length: hits }, (_, i) => `w${i + 1}`).join(" "),
});

test("rankSenses adds exactly 0.3 when the claim names the bracketed word, whatever its capitals", () => {
  const [hit] = rankSenses("BAR baz qux quux", [{ title: "Foo (bar)", intro: "nothing" }]);
  const [miss] = rankSenses("BAR baz qux quux", [{ title: "Foo (other)", intro: "nothing" }]);
  approx(hit.score, 0.25 + 0.3);
  approx(miss.score, 0);
});

test("rankSenses scores by shared words and ignores stopwords", () => {
  approx(rankSenses("alpha beta gamma delta", [{ title: "S", intro: "alpha beta" }])[0].score, 0.5);
  approx(rankSenses("the of and", [{ title: "S", intro: "the of and" }])[0].score, 0);
});

test("rankSenses adds the year bonus only when claim and introduction both have a year", () => {
  approx(rankSenses("foo 1999", [{ title: "S", intro: "foo from 1850" }])[0].score, 0.6);
  approx(rankSenses("foo 1999", [{ title: "S", intro: "foo from long ago" }])[0].score, 0.5);
});

test("chooseSenses keeps a meaning that scores exactly 0.25 and drops one just below", () => {
  assert.deepEqual(chooseSenses("alpha beta gamma delta", [{ title: "Sa", intro: "alpha" }]), ["Sa"]);
  assert.deepEqual(chooseSenses("alpha beta gamma delta epsilon", [{ title: "Sa", intro: "alpha" }]), []);
});

test("chooseSenses keeps a second meaning exactly 0.1 behind the best and drops one further behind", () => {
  const senses = [withHits("Sc", 3), withHits("Sb", 4), withHits("Sa", 5)];
  assert.deepEqual(chooseSenses(WORDS10, senses, { max: 3 }), ["Sa", "Sb"]);
});

test("chooseSenses drops a far-behind meaning even when it clears the minimum score", () => {
  const senses = [withHits("Sa", 10), withHits("Sb", 3)];
  assert.deepEqual(chooseSenses(WORDS10, senses, { max: 3 }), ["Sa"]);
});

test("chooseSenses keeps two meanings by default and lists the best first", () => {
  const four = ["Sa", "Sb", "Sc", "Sd"].map((t) => withHits(t, 5));
  assert.equal(chooseSenses(WORDS10, four).length, 2);
  const mixed = [withHits("Sc", 3), withHits("Sa", 5), withHits("Sb", 4)];
  assert.deepEqual(chooseSenses(WORDS10, mixed, { margin: 0.5, max: 2 }), ["Sa", "Sb"]);
});

test("chooseSenses returns nothing for a claim made only of stopwords", () => {
  assert.deepEqual(chooseSenses("the of and", SENSES), []);
});

test("expandDisambiguations still uses the other meanings when one cannot be fetched", async () => {
  const two: Sense[] = [
    { title: "Thing (q1)", intro: "shared words appear here" },
    { title: "Thing (q2)", intro: "shared words appear here" },
  ];
  const result = await expandDisambiguations("shared words appear here", [MERCURY_DISAMBIG], {
    fetchSenses: async () => two,
    fetchPage: async (title: string) => {
      if (title === "Thing (q1)") throw new Error("boom");
      return page("Thing (q2)", 11);
    },
  });
  assert.deepEqual(result.map((p) => p.title), ["Thing (q2)"]);
});

test("expandDisambiguations treats two titles with the same page id as one page", async () => {
  const redirect = page("Mercury, the planet", 2);
  const result = await expandDisambiguations(CLAIM, [PLANET, MERCURY_DISAMBIG], deps({ fetchPage: async () => redirect }));
  assert.deepEqual(result.map((p) => p.title), ["Mercury (planet)"]);
});

test("isDisambiguation also spots 'may also refer to' and looks only at the first 400 characters", () => {
  assert.equal(isDisambiguation(page("A", 20, { text: "A may also refer to:" })), true);
  assert.equal(isDisambiguation(page("A", 21, { text: `${"x".repeat(380)} may refer to` })), true);
  assert.equal(isDisambiguation(page("A", 22, { text: `${"x".repeat(401)} may refer to` })), false);
});

test("pickSenseTitles keeps the first titles when it has to cut", () => {
  const links = Array.from({ length: 5 }, (_, i) => `Mercury (${i + 1})`);
  assert.deepEqual(pickSenseTitles("Mercury", links, 3), ["Mercury (1)", "Mercury (2)", "Mercury (3)"]);
});

test("fetchSenses lists main-namespace links only and asks for the disambiguation flag", async () => {
  const urls = fakeSenseWiki(["Mercury (planet)"]);
  await fetchSenses("Mercury");
  assert.match(urls[0], /plnamespace=0/);
  assert.match(urls[1], /ppprop=disambiguation/);
});

test("fetchSenses reads at most 40 meanings by default", async () => {
  fakeSenseWiki(Array.from({ length: 45 }, (_, i) => `Mercury (sense ${i})`));
  assert.equal((await fetchSenses("Mercury")).length, 40);
});

test("fetchSenses drops a blank introduction and a page that only says 'may refer to'", async () => {
  fakeSenseWiki(["Mercury (planet)", "Spaces", "Mercury (list)"], {
    "Mercury (planet)": { title: "Mercury (planet)", extract: "Mercury is the first planet." },
    Spaces: { title: "Spaces", extract: " \n " },
    "Mercury (list)": { title: "Mercury (list)", extract: "Mercury may refer to:\n- a planet" },
  });
  assert.deepEqual((await fetchSenses("Mercury")).map((s) => s.title), ["Mercury (planet)"]);
});

test("fetchPage also marks 'may also refer to', but only near the top of the text", async () => {
  fakeWiki(pageAnswer("Mercury", "Mercury may also refer to:\n- the planet"));
  assert.equal((await fetchPage("Mercury"))!.disambiguation, true);
  fakeWiki(pageAnswer("Long", `${"x".repeat(401)} may refer to`));
  assert.equal((await fetchPage("Long"))!.disambiguation, false);
});
