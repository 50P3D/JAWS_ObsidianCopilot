import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  acceptGhost,
  advanceSuggestion,
  buildPrompt,
  cleanCompletion,
  currentGhost,
  dismissGhost,
  fetchCompletion,
  ghostTextExtension,
  shouldSuggest,
  showGhost,
  type SuggestInput,
} from "./ghostText";

// ── shouldSuggest ──────────────────────────────────────────────────

const base: SuggestInput = {
  before: "Second normal form removes partial ",
  after: "",
  hasSelection: false,
  enabled: true,
  busy: false,
};
const ask = (over: Partial<SuggestInput>) => shouldSuggest({ ...base, ...over });

test("shouldSuggest says yes at the end of a line after a space", () => {
  assert.equal(ask({}), true);
});

test("shouldSuggest says no when the feature is off", () => {
  assert.equal(ask({ enabled: false }), false);
});

test("shouldSuggest says no while a live check is running", () => {
  assert.equal(ask({ busy: true }), false);
});

test("shouldSuggest says no when text is selected", () => {
  assert.equal(ask({ hasSelection: true }), false);
});

test("shouldSuggest allows trailing spaces after the cursor but not words", () => {
  assert.equal(ask({ after: "  " }), true);
  assert.equal(ask({ after: "more words" }), false);
});

test("shouldSuggest needs a space just before the cursor", () => {
  assert.equal(ask({ before: "Second normal form removes partial" }), false);
});

test("shouldSuggest needs three words on the current line", () => {
  assert.equal(ask({ before: "Hello there " }), false);
  assert.equal(ask({ before: "Hello there again " }), true);
  assert.equal(ask({ before: "A long earlier paragraph about databases.\nHi " }), false);
});

test("shouldSuggest does not count a list marker as a word", () => {
  assert.equal(ask({ before: "- Second normal " }), false);
  assert.equal(ask({ before: "- Second normal form " }), true);
});

test("shouldSuggest skips headings", () => {
  assert.equal(ask({ before: "## Normal forms and keys " }), false);
});

test("shouldSuggest skips code blocks but not text after them", () => {
  assert.equal(ask({ before: "```ts\nconst a = 1 plus " }), false);
  assert.equal(ask({ before: "```\ncode\n```\nSecond normal form removes " }), true);
});

test("shouldSuggest skips frontmatter but not the note below it", () => {
  assert.equal(ask({ before: "---\ntags: databases and more " }), false);
  assert.equal(ask({ before: "---\ntags: databases\n---\n\nSecond normal form removes " }), true);
});

test("shouldSuggest skips maths blocks and table rows", () => {
  assert.equal(ask({ before: "$$\na + b + c " }), false);
  assert.equal(ask({ before: "| a | b | c " }), false);
});

// ── buildPrompt ────────────────────────────────────────────────────

test("buildPrompt puts the text before the cursor last, unchanged", () => {
  const before = "Second normal form removes partial ";
  assert.ok(buildPrompt(before).endsWith(before));
});

test("buildPrompt keeps only the end of a long note", () => {
  const before = "START-MARKER " + "filler words here ".repeat(100) + "the final words are these ";
  const prompt = buildPrompt(before, { maxContextChars: 100 });
  assert.ok(!prompt.includes("START-MARKER"));
  assert.ok(prompt.endsWith("the final words are these "));
  // the context is capped at 100 characters, and the instruction around it stays short
  assert.ok(prompt.length < 100 + 300);
});

test("buildPrompt never starts the context in the middle of a word", () => {
  const before = "word ".repeat(50) + "internationalisation is long and ";
  const prompt = buildPrompt(before, { maxContextChars: 30 });
  assert.ok(!prompt.includes("nationalisation"));
  assert.ok(prompt.endsWith("is long and "));
});

test("buildPrompt leaves out frontmatter at the top of the note", () => {
  const before = "---\ntitle: Secret title\n---\nSecond normal form removes ";
  const prompt = buildPrompt(before);
  assert.ok(!prompt.includes("Secret title"));
  assert.ok(prompt.endsWith("Second normal form removes "));
});

// ── cleanCompletion ────────────────────────────────────────────────

const BEFORE = "Second normal form removes ";

test("cleanCompletion keeps the first line only", () => {
  assert.equal(cleanCompletion("partial dependencies.\nThird normal form", BEFORE), "partial dependencies.");
});

test("cleanCompletion stops after the first sentence", () => {
  assert.equal(cleanCompletion("partial dependencies. It also requires", BEFORE), "partial dependencies.");
});

test("cleanCompletion does not stop at a decimal point", () => {
  assert.equal(cleanCompletion("about 3.5 percent of cases.", BEFORE), "about 3.5 percent of cases.");
});

test("cleanCompletion limits the number of words", () => {
  const raw = "one two three four five six seven eight nine ten";
  assert.equal(cleanCompletion(raw, BEFORE, { maxWords: 5 }), "one two three four five");
});

test("cleanCompletion removes words the model repeated from before the cursor", () => {
  assert.equal(cleanCompletion("normal form removes partial dependencies.", BEFORE), "partial dependencies.");
});

test("cleanCompletion drops leading spaces when the cursor already follows a space", () => {
  assert.equal(cleanCompletion("  partial dependencies", BEFORE), "partial dependencies");
});

test("cleanCompletion adds one space when the cursor follows a word", () => {
  const before = "Second normal form removes";
  assert.equal(cleanCompletion("partial dependencies", before), " partial dependencies");
  assert.equal(cleanCompletion(", and more", before), ", and more");
});

test("cleanCompletion removes wrapping quotes", () => {
  assert.equal(cleanCompletion('"partial dependencies."', BEFORE), "partial dependencies.");
});

test("cleanCompletion rejects chatty replies", () => {
  assert.equal(cleanCompletion("Sure! Here is the continuation: partial dependencies.", BEFORE), "");
  assert.equal(cleanCompletion("Here's a continuation: partial dependencies.", BEFORE), "");
});

test("cleanCompletion returns nothing for empty or symbol-only replies", () => {
  for (const raw of ["", "   ", "...", "\n\n"]) assert.equal(cleanCompletion(raw, BEFORE), "");
});

// ── advanceSuggestion ──────────────────────────────────────────────

test("advanceSuggestion removes what the user has typed from the front", () => {
  assert.equal(advanceSuggestion("partial dependencies.", "p"), "artial dependencies.");
  assert.equal(advanceSuggestion("partial dependencies.", "par"), "tial dependencies.");
});

test("advanceSuggestion returns null when the typing does not match", () => {
  assert.equal(advanceSuggestion("partial dependencies.", "x"), null);
  assert.equal(advanceSuggestion("partial dependencies.", "P"), null);
});

test("advanceSuggestion returns null once everything is typed", () => {
  assert.equal(advanceSuggestion("ab", "ab"), null);
});

// ── fetchCompletion ────────────────────────────────────────────────

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return reply();
  }) as typeof fetch;
  return { fn, calls };
}

const ok = (text: string) => new Response(JSON.stringify({ response: text }), { status: 200 });
const args = { before: "Second normal form removes partial ", model: "qwen3.5:2b", ollamaUrl: "http://localhost:11434" };

test("fetchCompletion posts a short, non-streaming request to Ollama", async () => {
  const { fn, calls } = fakeFetch(() => ok("dependencies."));
  await fetchCompletion({ ...args, fetchFn: fn });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:11434/api/generate");
  assert.equal(calls[0].init.method, "POST");
  const b = calls[0].body;
  assert.equal(b.model, "qwen3.5:2b");
  assert.equal(b.stream, false);
  assert.equal(b.think, false);
  assert.ok(b.options.stop.includes("\n"));
  assert.ok(b.options.num_predict > 0 && b.options.num_predict <= 40);
  assert.ok(String(b.prompt).endsWith("Second normal form removes partial "));
});

test("fetchCompletion returns the cleaned suggestion", async () => {
  const { fn } = fakeFetch(() => ok("dependencies.\nThird normal form"));
  assert.equal(await fetchCompletion({ ...args, fetchFn: fn }), "dependencies.");
});

test("fetchCompletion copes with a trailing slash on the Ollama URL", async () => {
  const { fn, calls } = fakeFetch(() => ok("x"));
  await fetchCompletion({ ...args, ollamaUrl: "http://localhost:11434/", fetchFn: fn });
  assert.equal(calls[0].url, "http://localhost:11434/api/generate");
});

test("fetchCompletion passes the abort signal to fetch", async () => {
  const controller = new AbortController();
  const { fn, calls } = fakeFetch(() => ok("x"));
  await fetchCompletion({ ...args, signal: controller.signal, fetchFn: fn });
  assert.equal(calls[0].init.signal, controller.signal);
});

test("fetchCompletion returns an empty string when the request is aborted", async () => {
  const { fn } = fakeFetch(() => {
    throw new DOMException("aborted", "AbortError");
  });
  assert.equal(await fetchCompletion({ ...args, fetchFn: fn }), "");
});

test("fetchCompletion does not call fetch when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { fn, calls } = fakeFetch(() => ok("x"));
  assert.equal(await fetchCompletion({ ...args, signal: controller.signal, fetchFn: fn }), "");
  assert.equal(calls.length, 0);
});

test("fetchCompletion throws with the status when Ollama answers with an error", async () => {
  const { fn } = fakeFetch(() => new Response("boom", { status: 500 }));
  await assert.rejects(fetchCompletion({ ...args, fetchFn: fn }), /500/);
});

test("fetchCompletion throws a message naming Ollama when it cannot connect", async () => {
  const { fn } = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchCompletion({ ...args, fetchFn: fn }), /Ollama/);
});

// ── editor state: showGhost, acceptGhost, dismissGhost ─────────────

// Just enough of an EditorView for the state logic: the state and dispatch
function fakeView(doc: string, anchor = doc.length, head = anchor) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: ghostTextExtension() }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as typeof view & EditorView;
}

const DOC = "Second normal form removes ";
const GHOST = "partial dependencies.";
const type = (view: EditorView, text: string) => {
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: "input.type" });
};

test("showGhost shows the suggestion at the cursor", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  assert.deepEqual(currentGhost(view), { pos: DOC.length, text: GHOST });
});

test("the suggestion is not part of the note", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  assert.equal(view.state.doc.toString(), DOC);
});

test("showGhost ignores empty text and selections", () => {
  const empty = fakeView(DOC);
  showGhost(empty, "");
  assert.equal(currentGhost(empty), null);
  const selected = fakeView(DOC, 0, 6);
  showGhost(selected, GHOST);
  assert.equal(currentGhost(selected), null);
});

test("a new suggestion replaces the old one", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  showGhost(view, "another idea");
  assert.equal(currentGhost(view)!.text, "another idea");
});

test("acceptGhost inserts the text, moves the cursor after it and clears the suggestion", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  assert.equal(acceptGhost(view), true);
  assert.equal(view.state.doc.toString(), DOC + GHOST);
  assert.equal(view.state.selection.main.head, DOC.length + GHOST.length);
  assert.equal(currentGhost(view), null);
});

test("acceptGhost does nothing and returns false when there is no suggestion", () => {
  const view = fakeView(DOC);
  assert.equal(acceptGhost(view), false);
  assert.equal(view.state.doc.toString(), DOC);
});

test("dismissGhost clears the suggestion and leaves the note alone", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  assert.equal(dismissGhost(view), true);
  assert.equal(currentGhost(view), null);
  assert.equal(view.state.doc.toString(), DOC);
  assert.equal(dismissGhost(view), false);
});

test("typing the next letter of the suggestion moves it forward", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  type(view, "p");
  assert.deepEqual(currentGhost(view), { pos: DOC.length + 1, text: "artial dependencies." });
});

test("typing the whole suggestion clears it", () => {
  const view = fakeView(DOC);
  showGhost(view, "ab");
  type(view, "a");
  type(view, "b");
  assert.equal(currentGhost(view), null);
});

test("typing a different letter clears the suggestion", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  type(view, "x");
  assert.equal(currentGhost(view), null);
});

test("moving the cursor away clears the suggestion", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ selection: { anchor: 0 } });
  assert.equal(currentGhost(view), null);
});

test("editing earlier in the note clears the suggestion", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ changes: { from: 0, insert: "Note: " } });
  assert.equal(currentGhost(view), null);
});
