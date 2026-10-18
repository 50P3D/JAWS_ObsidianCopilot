import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Evidence } from "../contract/claimCard";
import { LIFTWING_ENABLED, LIFTWING_URL, USER_AGENT } from "./config";
import { getJson, type FetchLike } from "./http";
import { clearCache, mergeStubbed, scoreEvidence } from "./index";

// ---------------------------------------------------------------------------------------------
// Shared fakes

const AS_OF = new Date("2026-10-17T12:00:00Z");
const REV_TS = "2026-10-10T08:00:00Z";
const PROSE = "The treaty was signed in the Hall of Mirrors at the Palace of Versailles. ".repeat(4).trim();
const BADGES = new Set(["High", "Medium", "Low"]);

interface Call {
  url: string;
  init?: RequestInit;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that only settles when its abort signal fires (or never, if it has none). */
const hang = (init?: RequestInit): Promise<Response> =>
  new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const isLiftWing = (url: string) => url.startsWith(LIFTWING_URL);

/** The rev_id of a Lift Wing request body. */
const liftWingRev = (c: Call): number => JSON.parse(String(c.init?.body)).rev_id;

/** A valid response for whichever endpoint the URL is for. */
function validResponse(url: string, init?: RequestInit, risk = 0.1): Response {
  if (isLiftWing(url)) {
    const rev = JSON.parse(String(init?.body)).rev_id;
    return jsonResponse({ revision_id: rev, output: { prediction: false, probabilities: { true: risk, false: 1 - risk } } });
  }
  const params = new URL(url).searchParams;
  if (params.get("action") === "parse") {
    const revid = Number(params.get("oldid"));
    return jsonResponse({ parse: { revid, categories: [], templates: [], wikitext: `${PROSE}<ref>Smith 2001</ref>` } });
  }
  const revid = Number(params.get("revids") ?? 0);
  return jsonResponse({
    query: { pages: [{ title: params.get("titles") ?? "Page", revisions: [{ revid, timestamp: REV_TS, tags: [] }] }] },
  });
}

const evidence = (revision_id: number, page_title = "Treaty of Versailles", revision_timestamp?: string): Evidence => ({
  passage: "The Treaty of Versailles was signed on 28 June 1919.",
  page_title,
  revision_id,
  ...(revision_timestamp ? { revision_timestamp } : {}),
  url: `https://en.wikipedia.org/w/index.php?oldid=${revision_id}`,
});

beforeEach(() => clearCache());

// ---------------------------------------------------------------------------------------------
// Property 13

type Outcome =
  | { kind: "reject" }
  | { kind: "timeout" }
  | { kind: "status"; status: number }
  | { kind: "malformed-text" }
  | { kind: "malformed-shape"; body: unknown }
  | { kind: "valid"; risk: number };

const arbOutcome: fc.Arbitrary<Outcome> = fc.oneof(
  fc.constant<Outcome>({ kind: "reject" }),
  fc.constant<Outcome>({ kind: "timeout" }),
  fc.integer({ min: 400, max: 599 }).map<Outcome>((status) => ({ kind: "status", status })),
  fc.constant<Outcome>({ kind: "malformed-text" }),
  fc.jsonValue().map<Outcome>((body) => ({ kind: "malformed-shape", body })),
  fc.double({ min: 0, max: 1, noNaN: true }).map<Outcome>((risk) => ({ kind: "valid", risk })),
);

/** Outcomes are used in call order, cycling through the list. */
const arbFetchOutcomes = fc.array(arbOutcome, { minLength: 1, maxLength: 12 });

function outcomeFetch(outcomes: Outcome[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const outcome = outcomes[calls.length % outcomes.length];
    calls.push({ url, init });
    switch (outcome.kind) {
      case "reject":
        throw new TypeError("fetch failed");
      case "timeout":
        return hang(init);
      case "status":
        return jsonResponse({ error: "server" }, outcome.status);
      case "malformed-text":
        return new Response("{not json", { status: 200, headers: { "content-type": "application/json" } });
      case "malformed-shape":
        return jsonResponse(outcome.body);
      case "valid":
        return validResponse(url, init, outcome.risk);
    }
  };
  return { fetch, calls };
}

/** Evidence lists over a small id pool, so revision ids repeat; timestamps sometimes missing. */
const arbEvidence = fc.array(
  fc.record({
    id: fc.constantFrom(101, 102, 103, 104),
    title: fc.constantFrom("Treaty of Versailles", "Paris Peace Conference"),
    ts: fc.option(fc.constant(REV_TS), { nil: undefined }),
  }),
  { maxLength: 8 },
).map((items) => items.map((i) => evidence(i.id, i.title, i.ts)));

// Feature: reliability-scorer, Property 13: scoreEvidence always resolves and scores each revision once
test("Property 13: scoreEvidence always resolves and scores each revision once", async () => {
  await fc.assert(
    fc.asyncProperty(arbEvidence, arbFetchOutcomes, async (ev, outcomes) => {
      clearCache();
      const { fetch, calls } = outcomeFetch(outcomes);

      let result;
      try {
        result = await scoreEvidence(ev, { fetch, timeoutMs: 20, asOf: AS_OF });
      } catch (err) {
        assert.fail(`scoreEvidence rejected: ${String(err)}`);
      }

      const distinct = new Set(ev.map((e) => e.revision_id));
      if (ev.length === 0) {
        assert.deepEqual(result, { stubbed: [] });
        assert.equal(calls.length, 0);
        return;
      }

      assert.ok(result.reliability, "non-empty evidence gives a reliability");
      assert.ok(BADGES.has(result.reliability.badge), `badge ${result.reliability.badge}`);
      const n = result.reliability.reasons.length;
      assert.ok(n >= 1 && n <= 6, `got ${n} reasons`);
      assert.ok(Array.isArray(result.stubbed));

      const perRev = new Map<number, number>();
      for (const c of calls.filter((c) => isLiftWing(c.url))) {
        const rev = liftWingRev(c);
        assert.ok(distinct.has(rev), `Lift Wing asked for unknown revision ${rev}`);
        perRev.set(rev, (perRev.get(rev) ?? 0) + 1);
      }
      for (const [rev, count] of perRev) assert.ok(count <= 1, `revision ${rev} sent to Lift Wing ${count} times`);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------------------------
// Unit tests

/** Valid responses everywhere, with optional per-call overrides. Records every call. */
function routedFetch(override?: (url: string, init?: RequestInit) => Promise<Response> | Response | undefined) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const custom = await override?.(url, init);
    return custom ?? validResponse(url, init);
  };
  return { fetch, calls };
}

test("every request carries the project User-Agent header", async () => {
  const { fetch, calls } = routedFetch();
  // No revision_timestamp, so the timestamp lookup request is sent as well.
  await scoreEvidence([evidence(201)], { fetch, asOf: AS_OF });

  assert.ok(calls.length >= 3, `expected parse, lookup and history requests, got ${calls.length}`);
  if (LIFTWING_ENABLED) assert.equal(calls.filter((c) => isLiftWing(c.url)).length, 1);
  for (const c of calls) {
    assert.equal((c.init?.headers as Record<string, string>)["User-Agent"], USER_AGENT, c.url);
  }
});

test("a request is aborted after timeoutMs", async () => {
  // A fetch that honours the abort signal.
  const start = Date.now();
  await assert.rejects(getJson("https://example.org/a", { fetch: (_u, init) => hang(init), timeoutMs: 20 }), {
    message: "timeout after 20 ms",
  });
  // A fetch that ignores the abort signal still hits the deadline.
  await assert.rejects(
    getJson("https://example.org/b", { fetch: () => new Promise<Response>(() => {}), timeoutMs: 20 }),
    { message: "timeout after 20 ms" },
  );
  assert.ok(Date.now() - start < 2000, "both timeouts fire quickly");

  // Through scoreEvidence, hanging requests become Unavailable signals, not a rejection.
  const { fetch } = routedFetch((_u, init) => hang(init));
  const result = await scoreEvidence([evidence(202, "Treaty of Versailles", REV_TS)], { fetch, asOf: AS_OF, timeoutMs: 20 });
  assert.ok(result.reliability);
  assert.ok(result.reliability.reasons.some((r) => r.includes("timeout after 20 ms")), result.reliability.reasons.join(" | "));
});

test("a cached revision sends no new requests", async () => {
  const { fetch, calls } = routedFetch();
  const ev = [evidence(203, "Treaty of Versailles", REV_TS)];

  const first = await scoreEvidence(ev, { fetch, asOf: AS_OF });
  const sent = calls.length;
  assert.ok(sent > 0);

  const second = await scoreEvidence(ev, { fetch, asOf: AS_OF });
  assert.equal(calls.length, sent, "second run is served from the cache");
  assert.deepEqual(second, first);
});

test("a failed request is not cached and is fetched again", async () => {
  let attempts = 0;
  const flaky: FetchLike = async () => {
    attempts++;
    if (attempts === 1) throw new TypeError("fetch failed");
    return jsonResponse({ ok: true });
  };
  await assert.rejects(getJson("https://example.org/flaky", { fetch: flaky }), /fetch failed/);
  assert.deepEqual(await getJson("https://example.org/flaky", { fetch: flaky }), { ok: true });
  assert.equal(attempts, 2);

  // Through scoreEvidence: an HTTP 500 for the parse request is retried on the next run.
  let parseCalls = 0;
  const { fetch } = routedFetch((url) => {
    if (!isLiftWing(url) && new URL(url).searchParams.get("action") === "parse") {
      parseCalls++;
      if (parseCalls === 1) return jsonResponse({}, 500);
    }
    return undefined;
  });
  const ev = [evidence(204, "Treaty of Versailles", REV_TS)];
  const first = await scoreEvidence(ev, { fetch, asOf: AS_OF });
  const second = await scoreEvidence(ev, { fetch, asOf: AS_OF });
  assert.equal(parseCalls, 2);
  assert.ok(first.reliability?.reasons.some((r) => r.includes("HTTP 500")));
  assert.ok(!second.reliability?.reasons.some((r) => r.includes("HTTP 500")));
});

test("empty evidence returns { stubbed: [] } and sends no requests", async () => {
  const { fetch, calls } = routedFetch();
  assert.deepEqual(await scoreEvidence([], { fetch, asOf: AS_OF }), { stubbed: [] });
  assert.equal(calls.length, 0);
});

/** Lift Wing fails (HTTP 500) for the given revisions and succeeds for the rest. */
const liftWingFailsFor = (failing: number[]) =>
  routedFetch((url, init) =>
    isLiftWing(url) && failing.includes(JSON.parse(String(init?.body)).rev_id) ? jsonResponse({}, 500) : undefined,
  );

test('"revert-risk" is stubbed when Lift Wing fails for every revision', { skip: !LIFTWING_ENABLED }, async () => {
  const { fetch } = liftWingFailsFor([301, 302]);
  const result = await scoreEvidence([evidence(301, "A", REV_TS), evidence(302, "B", REV_TS)], { fetch, asOf: AS_OF });
  assert.deepEqual(result.stubbed, ["revert-risk"]);
});

test('"revert-risk" is not stubbed when Lift Wing scores at least one revision', { skip: !LIFTWING_ENABLED }, async () => {
  const { fetch } = liftWingFailsFor([311]);
  const result = await scoreEvidence([evidence(311, "A", REV_TS), evidence(312, "B", REV_TS)], { fetch, asOf: AS_OF });
  assert.deepEqual(result.stubbed, []);
});

test('nothing is stubbed when Lift Wing scores every revision', { skip: !LIFTWING_ENABLED }, async () => {
  const { fetch } = liftWingFailsFor([]);
  const result = await scoreEvidence([evidence(321, "A", REV_TS), evidence(322, "B", REV_TS)], { fetch, asOf: AS_OF });
  assert.deepEqual(result.stubbed, []);
  assert.ok(result.reliability);
});

test('"revert-risk" is stubbed when Lift Wing is disabled', async () => {
  const { fetch, calls } = routedFetch();
  const result = await scoreEvidence([evidence(331, "A", REV_TS)], { fetch, asOf: AS_OF, liftWing: false });
  assert.deepEqual(result.stubbed, ["revert-risk"]);
  assert.equal(calls.filter((c) => isLiftWing(c.url)).length, 0);
});

test("mergeStubbed replaces old scorer markers and keeps the others", () => {
  assert.equal(mergeStubbed(undefined, []), undefined);
  assert.equal(mergeStubbed([], []), undefined);
  assert.equal(mergeStubbed(["reliability"], []), undefined, "the placeholder marker is dropped");
  assert.deepEqual(mergeStubbed(["reliability"], ["revert-risk"]), ["revert-risk"]);
  assert.deepEqual(mergeStubbed(["revert-risk"], ["reliability"]), ["reliability"]);
  assert.deepEqual(mergeStubbed(["retrieval", "reliability"], ["revert-risk"]), ["retrieval", "revert-risk"]);
  assert.deepEqual(mergeStubbed(["retrieval", "retrieval"], ["revert-risk", "revert-risk"]), ["retrieval", "revert-risk"]);
  assert.deepEqual(mergeStubbed(["verification"], []), ["verification"]);
});
