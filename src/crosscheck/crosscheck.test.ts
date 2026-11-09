import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClaimCard, Evidence } from "../contract/claimCard";
import {
  HAIKU,
  SONNET,
  askClaude,
  buildMessages,
  crossCheck,
  crossCheckCards,
  parseReply,
  pickEvidenceSentences,
  reviewLabel,
} from "./crosscheck";

const KEY = "sk-ant-test-key-123";

const ev = (passage: string, extra: Partial<Evidence> = {}): Evidence => ({
  passage,
  page_title: "Albert Einstein",
  revision_id: 1,
  url: "https://en.wikipedia.org/w/index.php?title=Albert_Einstein&oldid=1",
  ...extra,
});

const card = (over: Partial<ClaimCard> = {}): ClaimCard => ({
  claim_id: "c1",
  original_text: "SECRET NOTE TEXT: he won the prize for relativity.",
  claim: "Albert Einstein won the Nobel Prize for relativity.",
  verdict: "Supported",
  evidence: [ev("Einstein received the 1921 Nobel Prize in Physics. It was awarded for the photoelectric effect.")],
  ...over,
});

type Call = { url: string; init: any; body: any };

/** A fake network that answers with the given replies in order. A reply is text, or an Error to throw, or a status number. */
function fakeNet(replies: (string | number | Error)[]) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: any): Promise<Response> => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("nope", { status: r });
    return new Response(JSON.stringify({ content: [{ type: "text", text: r }] }), { status: 200 });
  };
  return { calls, fetchFn };
}

const say = (stance: string, reason = "Because of the passage.") => JSON.stringify({ stance, reason });

// ── when it does nothing ───────────────────────────────────────────

test("no API key means no result and no request", async () => {
  const net = fakeNet([say("agree")]);
  assert.equal(await crossCheck(card(), { apiKey: "", fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

test("a card with no verdict is skipped", async () => {
  const net = fakeNet([say("agree")]);
  assert.equal(await crossCheck(card({ verdict: undefined }), { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

test("a Not Enough Info verdict is skipped", async () => {
  const net = fakeNet([say("agree")]);
  assert.equal(await crossCheck(card({ verdict: "Not Enough Info" }), { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

test("a card with no evidence is skipped", async () => {
  const net = fakeNet([say("agree")]);
  assert.equal(await crossCheck(card({ evidence: [] }), { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(await crossCheck(card({ evidence: undefined }), { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

test("course evidence is never sent, even when Wikipedia evidence is there too", async () => {
  const net = fakeNet([say("agree")]);
  const mixed = card({ evidence: [ev("Wikipedia text."), ev("My own lecture note.", { source: "course" })] });
  assert.equal(await crossCheck(mixed, { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

// ── routing ────────────────────────────────────────────────────────

test("Haiku agreeing is final: one request, no escalation", async () => {
  const net = fakeNet([say("agree", "The passage matches.")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.deepEqual(r, { stance: "agree", reason: "The passage matches.", model: HAIKU, escalated: false, models_tried: [HAIKU] });
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].body.model, HAIKU);
});

test("Haiku disagreeing escalates to Sonnet, and Sonnet's answer is the result", async () => {
  const net = fakeNet([say("disagree"), say("agree", "On a second look it holds.")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(r?.model, SONNET);
  assert.equal(r?.stance, "agree");
  assert.equal(r?.escalated, true);
  assert.deepEqual(r?.models_tried, [HAIKU, SONNET]);
  assert.deepEqual(net.calls.map((c) => c.body.model), [HAIKU, SONNET]);
});

test("Haiku unsure escalates too", async () => {
  const net = fakeNet([say("unsure"), say("disagree", "The prize was for another work.")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(r?.stance, "disagree");
  assert.equal(r?.model, SONNET);
});

test("Sonnet's answer is final even when it is unsure: there is no third request", async () => {
  const net = fakeNet([say("unsure"), say("unsure")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(r?.stance, "unsure");
  assert.equal(r?.model, SONNET);
  assert.equal(net.calls.length, 2);
});

test("a failing Haiku call escalates to Sonnet", async () => {
  const net = fakeNet([500, say("agree")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(r?.model, SONNET);
  assert.equal(r?.escalated, true);
  assert.deepEqual(r?.models_tried, [HAIKU, SONNET]);
});

test("a network error escalates", async () => {
  const net = fakeNet([new Error("offline"), say("agree")]);
  assert.equal((await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn }))?.model, SONNET);
});

test("a reply that cannot be read counts as a failed call and escalates", async () => {
  const net = fakeNet(["I think it is fine.", say("agree")]);
  assert.equal((await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn }))?.model, SONNET);
});

test("when Sonnet fails after Haiku disagreed, Haiku's answer is kept", async () => {
  const net = fakeNet([say("disagree", "The prize was for another work."), 503]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(r?.stance, "disagree");
  assert.equal(r?.model, HAIKU);
  assert.equal(r?.escalated, false);
  assert.deepEqual(r?.models_tried, [HAIKU, SONNET]);
});

test("when every tier fails there is no result", async () => {
  const net = fakeNet([500, 503]);
  assert.equal(await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 2);
});

test("a list of one model means no routing", async () => {
  const net = fakeNet([say("disagree")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn, models: [HAIKU] });
  assert.equal(r?.stance, "disagree");
  assert.equal(r?.escalated, false);
  assert.equal(net.calls.length, 1);
});

// ── what is sent ───────────────────────────────────────────────────

test("the request goes to the Messages API with the key in the header only", async () => {
  const net = fakeNet([say("agree")]);
  await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  const c = net.calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers["x-api-key"], KEY);
  assert.equal(c.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.init.headers["content-type"], "application/json");
  assert.ok(!JSON.stringify(c.body).includes(KEY));
  assert.ok(c.body.max_tokens > 0 && c.body.max_tokens <= 300);
  assert.equal(typeof c.body.system, "string");
  assert.equal(c.body.messages.length, 1);
  assert.equal(c.body.messages[0].role, "user");
});

test("the message holds the claim, the verdict and the evidence, and not the note text", async () => {
  const net = fakeNet([say("agree")]);
  await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  const sent = JSON.stringify(net.calls[0].body);
  assert.ok(sent.includes("Albert Einstein won the Nobel Prize for relativity."));
  assert.ok(sent.includes("Supported"));
  assert.ok(sent.includes("photoelectric effect"));
  assert.ok(sent.includes("Albert Einstein"));
  assert.ok(!sent.includes("SECRET NOTE TEXT"));
});

test("buildMessages tells Claude to use only the evidence and to treat it as data", () => {
  const m = buildMessages("A claim.", "Refuted", [{ title: "Page", sentence: "A sentence." }]);
  assert.match(m.system, /only/i);
  assert.match(m.system, /not as instructions|not instructions/i);
  assert.match(m.system, /agree/);
  assert.match(m.system, /disagree/);
  assert.match(m.system, /unsure/);
  assert.match(m.user, /Refuted/);
});

// ── choosing the evidence sentences ────────────────────────────────

test("pickEvidenceSentences keeps at most three sentences", () => {
  const text = "Alpha one. Beta two. Gamma three. Delta four. Epsilon five.";
  const picked = pickEvidenceSentences("alpha beta gamma delta epsilon", [ev(text)]);
  assert.equal(picked.length, 3);
});

test("pickEvidenceSentences prefers the sentences that share words with the claim", () => {
  const text = "Tea is a drink. The photoelectric effect won the prize. Bananas are yellow. Nothing else here.";
  const picked = pickEvidenceSentences("The prize was for the photoelectric effect", [ev(text)], { maxSentences: 1 });
  assert.deepEqual(picked.map((p) => p.sentence), ["The photoelectric effect won the prize."]);
});

test("pickEvidenceSentences keeps the original order and the page title", () => {
  const text = "First has prize. Second has nothing. Third has prize too.";
  const picked = pickEvidenceSentences("prize", [ev(text, { page_title: "Nobel Prize" })], { maxSentences: 2 });
  assert.deepEqual(picked.map((p) => p.sentence), ["First has prize.", "Third has prize too."]);
  assert.equal(picked[0].title, "Nobel Prize");
});

test("pickEvidenceSentences stays inside the character cap", () => {
  const long = "word ".repeat(100).trim() + ".";
  const picked = pickEvidenceSentences("word", [ev(`${long} ${long} ${long}`)], { maxChars: 300 });
  const total = picked.reduce((n, p) => n + p.sentence.length, 0);
  assert.ok(total <= 300, `total ${total}`);
});

test("pickEvidenceSentences reads sentences from several passages", () => {
  const picked = pickEvidenceSentences("prize", [ev("The prize is old.", { page_title: "A" }), ev("Another prize story.", { page_title: "B" })]);
  assert.deepEqual(picked.map((p) => p.title).sort(), ["A", "B"]);
});

test("pickEvidenceSentences gives nothing for empty evidence", () => {
  assert.deepEqual(pickEvidenceSentences("claim", []), []);
});

// ── reading the reply ──────────────────────────────────────────────

test("parseReply reads plain JSON", () => {
  assert.deepEqual(parseReply('{"stance":"agree","reason":"Fine."}'), { stance: "agree", reason: "Fine." });
});

test("parseReply reads JSON inside a code fence or after a sentence", () => {
  assert.equal(parseReply('Here you go:\n```json\n{"stance":"disagree","reason":"No."}\n```').stance, "disagree");
});

test("parseReply rejects a reply with no object", () => {
  assert.throws(() => parseReply("I agree."), /no JSON/);
  assert.throws(() => parseReply("}"), /no JSON/);
  assert.throws(() => parseReply("{"), /no JSON/);
  assert.throws(() => parseReply("}{"), /no JSON/);
});

test("parseReply rejects an unknown stance", () => {
  assert.throws(() => parseReply('{"stance":"maybe","reason":"x"}'), /unknown stance/);
});

test("parseReply rejects a missing or empty reason", () => {
  assert.throws(() => parseReply('{"stance":"agree"}'), /missing reason/);
  assert.throws(() => parseReply('{"stance":"agree","reason":"   "}'), /missing reason/);
  assert.throws(() => parseReply('{"stance":"agree","reason":5}'), /missing reason/);
});

test("parseReply cuts a long reason to 300 characters", () => {
  const r = parseReply(JSON.stringify({ stance: "agree", reason: "x".repeat(500) }));
  assert.equal(r.reason.length, 300);
});

// ── errors and the key ─────────────────────────────────────────────

test("askClaude errors carry the status and never the key", async () => {
  const net = fakeNet([401]);
  await assert.rejects(
    askClaude({ apiKey: KEY, model: HAIKU, system: "s", user: "u", fetch: net.fetchFn }),
    (e: Error) => /401/.test(e.message) && !e.message.includes(KEY),
  );
});

test("a thrown network error never leaks the key through the result", async () => {
  const net = fakeNet([new Error("offline"), new Error("offline")]);
  const r = await crossCheck(card(), { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(r, null);
});

// ── many cards ─────────────────────────────────────────────────────

test("crossCheckCards returns results by claim id and leaves skipped cards out", async () => {
  const net = fakeNet([say("agree"), say("disagree"), say("agree")]);
  const cards = [
    card({ claim_id: "c1" }),
    card({ claim_id: "c2", verdict: "Not Enough Info" }),
    card({ claim_id: "c3", verdict: "Refuted" }),
  ];
  const map = await crossCheckCards(cards, { apiKey: KEY, fetch: net.fetchFn });
  assert.deepEqual([...map.keys()], ["c1", "c3"]);
  assert.equal(map.get("c1")?.stance, "agree");
});

test("crossCheckCards checks one card at a time", async () => {
  let running = 0;
  let most = 0;
  const fetchFn = async (_u: string, init?: any): Promise<Response> => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return new Response(JSON.stringify({ content: [{ type: "text", text: say("agree") }] }), { status: 200 });
  };
  await crossCheckCards([card({ claim_id: "a" }), card({ claim_id: "b" }), card({ claim_id: "c" })], { apiKey: KEY, fetch: fetchFn });
  assert.equal(most, 1);
});

test("crossCheckCards does not stop when one card fails", async () => {
  const net = fakeNet([500, 500, say("agree")]);
  const map = await crossCheckCards([card({ claim_id: "a" }), card({ claim_id: "b" })], { apiKey: KEY, fetch: net.fetchFn });
  assert.equal(map.has("a"), false);
  assert.equal(map.get("b")?.stance, "agree");
});

// ── how it shows ───────────────────────────────────────────────────

test("reviewLabel says which model answered and whether it escalated", () => {
  assert.equal(reviewLabel({ stance: "agree", reason: "Fine.", model: HAIKU, escalated: false, models_tried: [HAIKU] }), "Claude Haiku agrees: Fine.");
  assert.equal(
    reviewLabel({ stance: "disagree", reason: "The prize was for another work.", model: SONNET, escalated: true, models_tried: [HAIKU, SONNET] }),
    "Claude Sonnet disagrees (after Haiku): The prize was for another work.",
  );
});

test("reviewLabel shows the full model name when it is not one of ours", () => {
  assert.equal(reviewLabel({ stance: "agree", reason: "Ok.", model: "some-model", escalated: false, models_tried: ["some-model"] }), "Claude some-model agrees: Ok.");
});

test("reviewLabel words unsure as unsure", () => {
  assert.match(reviewLabel({ stance: "unsure", reason: "Hard to say.", model: SONNET, escalated: true, models_tried: [HAIKU, SONNET] }), /is unsure/);
});

// ── second round: pin what the first run of Stryker showed was loose ──

test("the model names are the real API names", () => {
  assert.equal(HAIKU, "claude-haiku-5-5");
  assert.equal(SONNET, "claude-sonnet-5-5");
});

test("a key made only of spaces counts as no key", async () => {
  const net = fakeNet([say("agree")]);
  assert.equal(await crossCheck(card(), { apiKey: "   ", fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

test("evidence with no readable sentence is skipped", async () => {
  const net = fakeNet([say("agree")]);
  assert.equal(await crossCheck(card({ evidence: [ev("")] }), { apiKey: KEY, fetch: net.fetchFn }), null);
  assert.equal(net.calls.length, 0);
});

test("pickEvidenceSentences sends the sentences in their own order, not in ranking order", () => {
  const picked = pickEvidenceSentences("prize more words", [ev("Alpha has prize. Beta has prize more words.")], { maxSentences: 2 });
  assert.deepEqual(picked.map((p) => p.sentence), ["Alpha has prize.", "Beta has prize more words."]);
});

test("pickEvidenceSentences breaks a tie by taking the earlier sentence", () => {
  const picked = pickEvidenceSentences("prize", [ev("One has prize. Two has prize. Three has prize.")], { maxSentences: 1 });
  assert.deepEqual(picked.map((p) => p.sentence), ["One has prize."]);
});

test("pickEvidenceSentences trims the spaces around a sentence", () => {
  const picked = pickEvidenceSentences("prize", [ev("   Padded prize sentence.   ")]);
  assert.deepEqual(picked.map((p) => p.sentence), ["Padded prize sentence."]);
});

test("pickEvidenceSentences skips a passage that is only spaces", () => {
  assert.deepEqual(pickEvidenceSentences("prize", [ev("     ")]), []);
});

test("pickEvidenceSentences cuts a sentence that does not fit and marks the cut", () => {
  const sentence = "Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp.";
  const [one] = pickEvidenceSentences("aaaa", [ev(sentence)], { maxChars: 50 });
  assert.equal(one.sentence, "Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj…");
  assert.ok(one.sentence.length <= 50);
});

test("pickEvidenceSentences keeps a sentence that fits exactly", () => {
  const [one] = pickEvidenceSentences("aaaa", [ev("Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii.")], { maxChars: 45 });
  assert.equal(one.sentence, "Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii.");
});

test("pickEvidenceSentences counts what it already used against the cap", () => {
  const picked = pickEvidenceSentences("word", [ev("Word alpha beta gamma delta epsilon zeta eta. Word iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.")], { maxChars: 100 });
  const total = picked.reduce((n, p) => n + p.sentence.length, 0);
  assert.equal(picked.length, 2);
  assert.equal(total, 100);
});

test("pickEvidenceSentences stops when fewer than 40 characters are left", () => {
  const a = "Word alpha beta gamma delta epsilon zeta eta."; // 45 characters
  const b = "Word extra text that would fit in a cut piece.";
  const picked = pickEvidenceSentences("word", [ev(`${a} ${b}`)], { maxChars: 45 + 39 });
  assert.equal(picked.length, 1);
  const again = pickEvidenceSentences("word", [ev(`${a} ${b}`)], { maxChars: 45 + 40 });
  assert.equal(again.length, 2);
});

test("buildMessages lists the evidence in numbered lines and names the page", () => {
  const m = buildMessages("The claim.", "Supported", [
    { title: "Page A", sentence: "First sentence." },
    { title: "Page B", sentence: "Second sentence." },
  ]);
  assert.ok(m.user.includes("Claim: The claim.\nLocal verdict: Supported\n\nEvidence:\n[1] (Page A) First sentence.\n[2] (Page B) Second sentence."));
});

test("buildMessages system prompt states the task, the reply format and the meaning of each answer", () => {
  const { system } = buildMessages("c", "Refuted", [{ title: "t", sentence: "s" }]);
  assert.ok(system.includes("fact-checking verdict"));
  assert.ok(system.includes("a small local model"));
  assert.ok(system.includes('{"stance": "agree" | "disagree" | "unsure", "reason": "<one sentence>"}'));
  assert.ok(system.includes("too thin to tell"));
});

const rawNet = (body: unknown, status = 200) => async (_u: string, _i?: any): Promise<Response> =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("askClaude ignores blocks that are not text and joins text blocks without a separator", async () => {
  const text = await askClaude({
    apiKey: KEY, model: HAIKU, system: "s", user: "u",
    fetch: rawNet({ content: [{ type: "tool_use", text: "NO" }, { type: "text", text: '{"stance":"agree",' }, { type: "text", text: '"reason":"ok"}' }] }),
  });
  assert.equal(text, '{"stance":"agree","reason":"ok"}');
});

test("askClaude rejects a reply with no text, empty text, spaces only or no content", async () => {
  for (const body of [{ content: [] }, { content: [{ type: "text", text: "" }] }, { content: [{ type: "text", text: "   " }] }, {}, "null"]) {
    await assert.rejects(askClaude({ apiKey: KEY, model: HAIKU, system: "s", user: "u", fetch: rawNet(body) }), /no text/);
  }
});

test("askClaude reads a missing text field as empty, not as a placeholder", async () => {
  await assert.rejects(askClaude({ apiKey: KEY, model: HAIKU, system: "s", user: "u", fetch: rawNet({ content: [{ type: "text" }] }) }), /no text/);
});

test("askClaude uses the global fetch when none is given", async () => {
  const real = globalThis.fetch;
  let seen = "";
  globalThis.fetch = (async (url: any) => {
    seen = String(url);
    return new Response(JSON.stringify({ content: [{ type: "text", text: "hello" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await askClaude({ apiKey: KEY, model: HAIKU, system: "s", user: "u" }), "hello");
    assert.equal(seen, "https://api.anthropic.com/v1/messages");
  } finally {
    globalThis.fetch = real;
  }
});

test("askClaude error says which status came back", async () => {
  await assert.rejects(askClaude({ apiKey: KEY, model: HAIKU, system: "s", user: "u", fetch: rawNet("x", 429) }), /^Error: Claude API error 429$/);
});

test("pickEvidenceSentences takes the earliest sentences when several score the same", () => {
  const picked = pickEvidenceSentences("prize", [ev("One has prize. Two has prize. Three has prize. Four has prize. Five has prize.")], { maxSentences: 2 });
  assert.deepEqual(picked.map((p) => p.sentence), ["One has prize.", "Two has prize."]);
});

test("pickEvidenceSentences drops the space before the cut mark", () => {
  const [one] = pickEvidenceSentences("aaaa", [ev("Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp.")], { maxChars: 51 });
  assert.equal(one.sentence, "Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj…");
});

test("askClaude skips an empty entry among the content blocks", async () => {
  const text = await askClaude({ apiKey: KEY, model: HAIKU, system: "s", user: "u", fetch: rawNet({ content: [null, { type: "text", text: "hi" }] }) });
  assert.equal(text, "hi");
});
