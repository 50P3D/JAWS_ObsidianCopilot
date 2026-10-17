import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { LIFTWING_ENABLED, LIFTWING_URL, USER_AGENT } from "./config";
import { clearCache, type FetchLike } from "./http";
import { fetchSignals, parseLiftWing, type RevisionRef } from "./signals";
import { isUnavailable, type Unavailable } from "./types";

// ---------------------------------------------------------------------------------------------
// Property 5

/** Reference check, written separately from parseLiftWing. */
function expectedProbability(json: unknown): number | undefined {
  const get = (x: unknown, k: string): unknown =>
    x === null || x === undefined ? undefined : (x as Record<string, unknown>)[k];
  const p = get(get(get(json, "output"), "probabilities"), "true");
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1 ? p : undefined;
}

/** Values for `probabilities.true`: in range, edge values, out of range, non-finite and non-numbers. */
const arbTrueValue = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(0, 1, -0, -Number.MIN_VALUE, 1 + Number.EPSILON, NaN, Infinity, -Infinity),
  fc.double(),
  fc.anything(),
);

/** Responses close to the live shape, with some levels replaced or missing. */
const arbShaped = fc.oneof(
  arbTrueValue.map((t) => ({ output: { prediction: false, probabilities: { true: t, false: 0.5 } } })),
  arbTrueValue.map((t) => ({ output: { probabilities: { true: String(t) } }, t })),
  fc.record({ output: fc.oneof(fc.anything(), fc.record({ probabilities: fc.anything() })) }),
  fc.record({ probabilities: fc.record({ true: arbTrueValue }) }),
);

// Feature: reliability-scorer, Property 5: Lift Wing response parsing
test("Property 5: parseLiftWing accepts exactly a finite output.probabilities.true in [0, 1]", () => {
  fc.assert(
    fc.property(fc.oneof(arbShaped, fc.jsonValue(), fc.anything()), (json) => {
      const result = parseLiftWing(json);
      const p = expectedProbability(json);
      if (p === undefined) {
        assert.ok(isUnavailable(result), `expected Unavailable for ${fc.stringify(json)}`);
      } else {
        assert.deepEqual(result, { probability: p });
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------------------------
// Example tests with a fake fetch

const AS_OF = new Date("2026-10-17T12:00:00Z");
const REV_TS = "2026-10-10T08:00:00Z";
const PROSE = "The treaty was signed in the Hall of Mirrors at the Palace of Versailles. ".repeat(4).trim();

const LIVE_LIFTWING = {
  model_name: "revertrisk-language-agnostic",
  model_version: "3",
  wiki_db: "enwiki",
  revision_id: 123,
  output: { prediction: false, probabilities: { true: 0.12, false: 0.88 } },
};

interface Call {
  url: string;
  init?: RequestInit;
}

interface Route {
  status?: number;
  body: unknown;
}

const json = (r: Route): Response =>
  new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });

/** Routes requests to the parse, query or Lift Wing response and records every call. */
function fakeFetch(rev: number, routes: { parse?: Route; query?: Route; liftWing?: Route } = {}) {
  const calls: Call[] = [];
  const parse = routes.parse ?? {
    body: { parse: { revid: rev, categories: [], templates: [], wikitext: `${PROSE}<ref>Smith 2001</ref>` } },
  };
  const query = routes.query ?? {
    body: {
      query: { pages: [{ title: "Treaty of Versailles", revisions: [{ revid: rev, timestamp: REV_TS, tags: [] }] }] },
    },
  };
  const liftWing = routes.liftWing ?? { body: { ...LIVE_LIFTWING, revision_id: rev } };

  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith(LIFTWING_URL)) return json(liftWing);
    const params = new URL(url).searchParams;
    if (params.get("action") === "parse") return json(parse);
    if (params.get("action") === "query") return json(query);
    return json({ status: 404, body: { error: { code: "unrouted" } } });
  };
  return { fetch, calls };
}

const ref = (revision_id: number): RevisionRef => ({
  revision_id,
  page_title: "Treaty of Versailles",
  revision_timestamp: REV_TS,
});

const isWikiCall = (c: Call) => !c.url.startsWith(LIFTWING_URL);
const isLiftWingCall = (c: Call) => c.url.startsWith(LIFTWING_URL);

beforeEach(() => clearCache());

test("wiki requests pin the revision and ask for ids, timestamps and tags only", async () => {
  const rev = 900001;
  const { fetch, calls } = fakeFetch(rev);
  await fetchSignals(ref(rev), { fetch, asOf: AS_OF, liftWing: false });

  const urls = calls.filter(isWikiCall).map((c) => decodeURIComponent(c.url.replace(/\+/g, " ")));
  assert.ok(urls.some((u) => u.includes(`oldid=${rev}`)), "parse request uses oldid");
  assert.ok(urls.some((u) => u.includes("rvprop=ids|timestamp|tags")), "history request uses rvprop=ids|timestamp|tags");

  for (const c of calls.filter(isWikiCall)) {
    for (const [key, value] of new URL(c.url).searchParams) {
      assert.doesNotMatch(`${key}=${value}`, /user/i, `no user fields in ${key}=${value}`);
    }
  }
});

test("Lift Wing is called with { rev_id, lang: 'en' } and the User-Agent header", { skip: !LIFTWING_ENABLED }, async () => {
  const rev = 900002;
  const { fetch, calls } = fakeFetch(rev);
  await fetchSignals(ref(rev), { fetch, asOf: AS_OF });

  const lw = calls.filter(isLiftWingCall);
  assert.equal(lw.length, 1);
  assert.equal(lw[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(lw[0].init?.body)), { rev_id: rev, lang: "en" });
  for (const c of calls) {
    assert.equal((c.init?.headers as Record<string, string>)["User-Agent"], USER_AGENT);
  }
});

test("a live-shape Lift Wing response is parsed to its 'true' probability", { skip: !LIFTWING_ENABLED }, async () => {
  const rev = 900003;
  const { fetch } = fakeFetch(rev, { liftWing: { body: LIVE_LIFTWING } });
  const signals = await fetchSignals(ref(rev), { fetch, asOf: AS_OF });
  assert.deepEqual(signals.revertRisk, { probability: 0.12 });
  assert.deepEqual(parseLiftWing(LIVE_LIFTWING), { probability: 0.12 });
});

test("an HTTP 500 from Lift Wing makes only the revert risk Unavailable", { skip: !LIFTWING_ENABLED }, async () => {
  const rev = 900004;
  const { fetch } = fakeFetch(rev, { liftWing: { status: 500, body: { error: "boom" } } });
  const signals = await fetchSignals(ref(rev), { fetch, asOf: AS_OF });

  assert.ok(isUnavailable(signals.revertRisk));
  assert.match((signals.revertRisk as Unavailable).cause, /HTTP 500/);
  assert.ok(!isUnavailable(signals.maintenance));
  assert.ok(!isUnavailable(signals.editActivity));
  assert.ok(!isUnavailable(signals.citations));
});

test("with Lift Wing disabled no Lift Wing request is sent", async () => {
  const rev = 900005;
  const { fetch, calls } = fakeFetch(rev);
  const signals = await fetchSignals(ref(rev), { fetch, asOf: AS_OF, liftWing: false });

  assert.equal(calls.filter(isLiftWingCall).length, 0);
  assert.deepEqual(signals.revertRisk, { unavailable: true, cause: "disabled" });
});

test("a parse failure marks both maintenance and citations Unavailable", async () => {
  // HTTP failure of the parse request.
  const revHttp = 900006;
  const http = fakeFetch(revHttp, { parse: { status: 500, body: {} } });
  const a = await fetchSignals(ref(revHttp), { fetch: http.fetch, asOf: AS_OF, liftWing: false });
  assert.ok(isUnavailable(a.maintenance));
  assert.ok(isUnavailable(a.citations));
  assert.match((a.maintenance as Unavailable).cause, /HTTP 500/);
  assert.ok(!isUnavailable(a.editActivity), "history is unaffected");

  // API error for a deleted or unknown revision.
  const revApi = 900007;
  const api = fakeFetch(revApi, { parse: { body: { error: { code: "nosuchrevid", info: "no such revision" } } } });
  const b = await fetchSignals(ref(revApi), { fetch: api.fetch, asOf: AS_OF, liftWing: false });
  assert.deepEqual(b.maintenance, { unavailable: true, cause: "nosuchrevid" });
  assert.deepEqual(b.citations, { unavailable: true, cause: "nosuchrevid" });
  assert.ok(!isUnavailable(b.editActivity), "history is unaffected");
});
