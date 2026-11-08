import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
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

test("shouldSuggest allows trailing spaces after the cursor", () => {
  assert.equal(ask({ after: "  " }), true);
});

test("shouldSuggest says no when words follow the cursor on the line", () => {
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

test("shouldSuggest skips maths blocks", () => {
  assert.equal(ask({ before: "$$\na + b + c " }), false);
});

test("shouldSuggest skips table rows", () => {
  assert.equal(ask({ before: "| a | b | c " }), false);
});

test("shouldSuggest allows a pipe that is not at the start of the line", () => {
  assert.equal(ask({ before: "a | b | c d e " }), true);
});

test("shouldSuggest allows inline $$ pairs in a sentence but not a lone $$", () => {
  assert.equal(ask({ before: "Write $$x + y$$ in a sentence like " }), true);
  assert.equal(ask({ before: "It costs $$ here and more " }), false);
});

test("shouldSuggest does not read a first line that merely starts with --- as frontmatter", () => {
  assert.equal(ask({ before: "--- one two three " }), true);
});

test("shouldSuggest does not count a dash in the middle of a line as a list marker", () => {
  assert.equal(ask({ before: "Say - it " }), true);
});

test("shouldSuggest uses minWordsBefore from the options", () => {
  const input = { ...base, before: "Hello there " };
  assert.equal(shouldSuggest(input, { minWordsBefore: 2 }), true);
  assert.equal(shouldSuggest({ ...input, before: "Hello there again " }, { minWordsBefore: 4 }), false);
  assert.equal(shouldSuggest({ ...input, before: "Hello there again now " }, { minWordsBefore: 4 }), true);
});

test("shouldSuggest counts numbered and starred list markers as markers", () => {
  assert.equal(ask({ before: "1. Second normal " }), false);
  assert.equal(ask({ before: "1) Second normal " }), false);
  assert.equal(ask({ before: "10. Second normal " }), false);
  assert.equal(ask({ before: "10. Second normal form " }), true);
  assert.equal(ask({ before: "* Second normal " }), false);
  assert.equal(ask({ before: "+ Second normal " }), false);
  assert.equal(ask({ before: "  - Second normal " }), false);
});

test("shouldSuggest treats only real headings as headings", () => {
  assert.equal(ask({ before: "# One two three " }), false);
  assert.equal(ask({ before: "###### One two three " }), false);
  assert.equal(ask({ before: "   ## One two three " }), false);
  assert.equal(ask({ before: "####### One two three " }), true);
  assert.equal(ask({ before: "#hashtag one two " }), true);
  assert.equal(ask({ before: "## Title\nSecond normal form removes " }), true);
});

test("shouldSuggest skips indented table rows", () => {
  assert.equal(ask({ before: "  | a | b | c " }), false);
});

test("shouldSuggest treats ~~~ and indented fences as code blocks", () => {
  assert.equal(ask({ before: "~~~\ncode plus more " }), false);
  assert.equal(ask({ before: "  ```\ncode plus more " }), false);
  assert.equal(ask({ before: "~~~\ncode\n~~~\nSecond normal form removes " }), true);
});

test("shouldSuggest ignores a fence marker that is not at the start of a line", () => {
  assert.equal(ask({ before: "Use ``` in a note\nSecond normal form removes " }), true);
});

test("shouldSuggest allows suggestions after a closed maths block", () => {
  assert.equal(ask({ before: "$$\na + b\n$$\nSecond normal form removes " }), true);
  assert.equal(ask({ before: "$$\na + b\n$$\n$$\nc + d plus " }), false);
});

test("shouldSuggest treats frontmatter with trailing spaces or CRLF line endings the same", () => {
  assert.equal(ask({ before: "---  \ntags: databases and more " }), false);
  assert.equal(ask({ before: "---\r\ntags: databases and more " }), false);
  assert.equal(ask({ before: "---\r\ntags: databases\r\n---\r\nSecond normal form removes " }), true);
  assert.equal(ask({ before: "```\r\ncode\r\n```\r\nSecond normal form removes " }), true);
});

test("shouldSuggest needs a real space just before the cursor, not a tab", () => {
  assert.equal(ask({ before: "Second normal form removes\t" }), false);
});

test("shouldSuggest treats a tab after the cursor like a space", () => {
  assert.equal(ask({ after: "\t" }), true);
});

test("shouldSuggest keeps the default word minimum when only another option is given", () => {
  assert.equal(shouldSuggest({ ...base, before: "Hello there " }, { maxWords: 5, maxContextChars: 10, maxTokens: 5 }), false);
  assert.equal(shouldSuggest({ ...base, before: "Hello there again " }, { maxWords: 5 }), true);
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
  // the context is capped at 100 characters on top of the fixed instruction
  assert.ok(prompt.length <= buildPrompt("").length + 100);
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

const instructionOnly = buildPrompt("");

test("buildPrompt wraps the context in a short instruction asking for a few words", () => {
  assert.ok(instructionOnly.length > 20 && instructionOnly.length < 300);
  assert.match(instructionOnly, /continu/i);
  assert.match(instructionOnly, /few words/i);
});

test("buildPrompt never sends more than maxContextChars of the note", () => {
  const before = "alpha beta gamma delta ".repeat(100);
  for (const max of [50, 100, 600]) {
    const prompt = buildPrompt(before, { maxContextChars: max });
    assert.ok(prompt.startsWith(instructionOnly));
    assert.ok(prompt.length - instructionOnly.length <= max, `max ${max}`);
  }
});

test("buildPrompt uses 600 characters of context by default", () => {
  const before = "alpha beta gamma delta ".repeat(100);
  const context = buildPrompt(before).slice(instructionOnly.length);
  assert.ok(context.length <= 600);
  assert.ok(context.length > 560);
});

test("buildPrompt keeps a word that starts exactly at the cut", () => {
  assert.equal(buildPrompt("aaa bbb ccc ", { maxContextChars: 8 }).slice(instructionOnly.length), "bbb ccc ");
});

test("buildPrompt trims spaces at the start of the cut context", () => {
  assert.equal(buildPrompt("aaa  bbb ccc ", { maxContextChars: 10 }).slice(instructionOnly.length), "bbb ccc ");
});

test("buildPrompt leaves a short note whole", () => {
  assert.equal(buildPrompt("Short note here ").slice(instructionOnly.length), "Short note here ");
});

test("buildPrompt strips empty, CRLF and trailing-space frontmatter but only at the top", () => {
  const body = (b: string) => buildPrompt(b).slice(instructionOnly.length);
  assert.equal(body("---\n---\nHello there again "), "Hello there again ");
  assert.equal(body("---\r\ntitle: x\r\n---\r\nHello there again "), "Hello there again ");
  assert.equal(body("---  \ntitle: x\n---  \nHello there again "), "Hello there again ");
  assert.equal(body("Intro text\n---\ntitle: x\n---\nHello there again "), "Intro text\n---\ntitle: x\n---\nHello there again ");
});

test("buildPrompt strips frontmatter that ends the note", () => {
  assert.equal(buildPrompt("---\ntitle: x\n---").slice(instructionOnly.length), "");
});

test("buildPrompt does not strip frontmatter that never closes (ghost text is not requested there)", () => {
  assert.equal(buildPrompt("---\ntitle: x\nHello ").slice(instructionOnly.length), "---\ntitle: x\nHello ");
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

test("cleanCompletion cuts at the first line even when it has no sentence end", () => {
  assert.equal(cleanCompletion("partial dependencies\nThird normal form.", BEFORE), "partial dependencies");
  assert.equal(cleanCompletion("partial dependencies\r\nThird normal form.", BEFORE), "partial dependencies");
});

test("cleanCompletion never returns a newline", () => {
  for (const raw of ["a b\nc d", "a b\r\nc d", "\na b", "a b\n", "\r\nx y"]) {
    assert.ok(!cleanCompletion(raw, BEFORE).includes("\n"), JSON.stringify(raw));
    assert.ok(!cleanCompletion(raw, BEFORE).includes("\r"), JSON.stringify(raw));
  }
});

test("cleanCompletion returns nothing for a reply that is only a quote mark or end punctuation", () => {
  for (const raw of ['"', "'", "!!!", "???", "- - -", "“”"]) assert.equal(cleanCompletion(raw, BEFORE), "", JSON.stringify(raw));
  assert.equal(cleanCompletion("...\nhello", BEFORE), "");
});

test("cleanCompletion removes single, smart and unclosed opening quotes", () => {
  assert.equal(cleanCompletion("'partial dependencies'", BEFORE), "partial dependencies");
  assert.equal(cleanCompletion("“partial dependencies”", BEFORE), "partial dependencies");
  assert.equal(cleanCompletion('"partial dependencies', BEFORE), "partial dependencies");
});

test("cleanCompletion only removes the closing quote at the very end", () => {
  assert.equal(cleanCompletion('"say "hi" now"', BEFORE), 'say "hi" now');
});

test("cleanCompletion leaves quotes that are inside the reply", () => {
  assert.equal(cleanCompletion('partial "dependencies" here', BEFORE), 'partial "dependencies" here');
  assert.equal(cleanCompletion('the "A" and "B"', BEFORE), 'the "A" and "B"');
});

test("cleanCompletion rejects every chatty opener but keeps words that only contain them", () => {
  for (const raw of [
    "Sure, partial dependencies",
    "Certainly partial dependencies",
    "Here is partial dependencies",
    "Here are some words",
    "Here's partial dependencies",
    "As an AI I cannot say",
    "I'm sorry but no",
    "I am sorry but no",
    "Sorry about that",
    "I cannot help",
    "I can't help",
  ]) {
    assert.equal(cleanCompletion(raw, BEFORE), "", raw);
  }
  assert.equal(cleanCompletion("make sure it works", BEFORE), "make sure it works");
  assert.equal(cleanCompletion("Surely partial dependencies", BEFORE), "Surely partial dependencies");
  assert.equal(cleanCompletion("we are sorry to see", BEFORE), "we are sorry to see");
});

test("cleanCompletion removes an echo of all of before but keeps a two-word overlap", () => {
  assert.equal(cleanCompletion("Second normal form removes partial dependencies.", BEFORE), "partial dependencies.");
  assert.equal(cleanCompletion("Second normal form removes", BEFORE), "");
  assert.equal(cleanCompletion("form removes partial dependencies", BEFORE), "form removes partial dependencies");
});

test("cleanCompletion keeps a reply that only starts like the words before the cursor", () => {
  assert.equal(cleanCompletion("Second normal form removesome things", BEFORE), "Second normal form removesome things");
});

test("cleanCompletion compares the echo ignoring capital letters", () => {
  assert.equal(cleanCompletion("NORMAL FORM REMOVES partial dependencies", BEFORE), "partial dependencies");
});

test("cleanCompletion stops after ! and ? and keeps repeated end marks together", () => {
  assert.equal(cleanCompletion("is it true? maybe not", BEFORE), "is it true?");
  assert.equal(cleanCompletion("wow! more words", BEFORE), "wow!");
  assert.equal(cleanCompletion("wait... more words", BEFORE), "wait...");
});

test("cleanCompletion keeps exactly maxWords words and uses 12 by default", () => {
  assert.equal(cleanCompletion("one two three four five", BEFORE, { maxWords: 5 }), "one two three four five");
  assert.equal(cleanCompletion("one two three four five six", BEFORE, { maxWords: 5 }), "one two three four five");
  const fifteen = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15";
  assert.equal(cleanCompletion(fifteen, BEFORE), "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12");
});

test("cleanCompletion keeps the default word limit when only another option is given", () => {
  const fifteen = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15";
  assert.equal(cleanCompletion(fifteen, BEFORE, { minWordsBefore: 1, maxTokens: 5 }).split(" ").length, 12);
});

test("cleanCompletion adds no space before closing punctuation but adds one before an opening bracket", () => {
  const before = "Second normal form removes";
  for (const p of [",", ";", ":", ")", "]", "}", "%"]) {
    assert.equal(cleanCompletion(`${p} and more`, before), `${p} and more`, p);
  }
  assert.equal(cleanCompletion("(and more)", before), " (and more)");
});

test("cleanCompletion never adds a space to an empty note", () => {
  assert.equal(cleanCompletion("Hello there", ""), "Hello there");
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

test("advanceSuggestion keeps the whole suggestion when nothing has been typed", () => {
  assert.equal(advanceSuggestion("ab", ""), "ab");
});

test("advanceSuggestion returns null when more was typed than suggested", () => {
  assert.equal(advanceSuggestion("ab", "abc"), null);
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

test("fetchCompletion sends a JSON content type and keeps the model loaded", async () => {
  const { fn, calls } = fakeFetch(() => ok("x"));
  await fetchCompletion({ ...args, fetchFn: fn });
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json" });
  assert.ok(calls[0].body.keep_alive);
  assert.deepEqual(calls[0].body.options.stop, ["\n"]);
});

test("fetchCompletion asks for 24 tokens by default and honours maxTokens", async () => {
  const { fn, calls } = fakeFetch(() => ok("x"));
  await fetchCompletion({ ...args, fetchFn: fn });
  await fetchCompletion({ ...args, opts: { maxTokens: 8 }, fetchFn: fn });
  assert.equal(calls[0].body.options.num_predict, 24);
  assert.equal(calls[1].body.options.num_predict, 8);
});

test("fetchCompletion keeps the token limit between 1 and 40", async () => {
  const { fn, calls } = fakeFetch(() => ok("x"));
  await fetchCompletion({ ...args, opts: { maxTokens: 100 }, fetchFn: fn });
  await fetchCompletion({ ...args, opts: { maxTokens: 0 }, fetchFn: fn });
  assert.equal(calls[0].body.options.num_predict, 40);
  assert.equal(calls[1].body.options.num_predict, 1);
});

test("fetchCompletion passes the context options on to the prompt", async () => {
  const { fn, calls } = fakeFetch(() => ok("x"));
  const before = "alpha beta gamma delta ".repeat(20);
  await fetchCompletion({ ...args, before, opts: { maxContextChars: 30 }, fetchFn: fn });
  assert.ok(String(calls[0].body.prompt).length < buildPrompt(before).length);
});

test("fetchCompletion tolerates several trailing slashes on the URL", async () => {
  const { fn, calls } = fakeFetch(() => ok("x"));
  await fetchCompletion({ ...args, ollamaUrl: "http://localhost:11434//", fetchFn: fn });
  assert.equal(calls[0].url, "http://localhost:11434/api/generate");
});

test("fetchCompletion includes the start of Ollama's error text in the error", async () => {
  const { fn } = fakeFetch(() => new Response("model not found", { status: 404 }));
  await assert.rejects(fetchCompletion({ ...args, fetchFn: fn }), /404.*model not found/);
});

test("fetchCompletion throws a clear error when the reply is not JSON", async () => {
  const { fn } = fakeFetch(() => new Response("not json", { status: 200 }));
  await assert.rejects(fetchCompletion({ ...args, fetchFn: fn }), /could not be read/);
});

test("fetchCompletion still reports the status when the error body cannot be read", async () => {
  const res = { ok: false, status: 503, text: async () => { throw new Error("body failed"); } } as unknown as Response;
  const { fn } = fakeFetch(() => res);
  await assert.rejects(fetchCompletion({ ...args, fetchFn: fn }), /503/);
});

test("fetchCompletion returns an empty string when the reply has no response field", async () => {
  const { fn } = fakeFetch(() => new Response("{}", { status: 200 }));
  assert.equal(await fetchCompletion({ ...args, fetchFn: fn }), "");
});

test("fetchCompletion returns an empty string when the request is aborted while reading the reply", async () => {
  const res = { ok: true, status: 200, json: async () => { throw new DOMException("aborted", "AbortError"); } } as unknown as Response;
  const { fn } = fakeFetch(() => res);
  assert.equal(await fetchCompletion({ ...args, fetchFn: fn }), "");
});

// ── editor state: showGhost, acceptGhost, dismissGhost ─────────────

// Just enough of an EditorView for the state logic: the state and dispatch
function fakeView(doc: string, anchor = doc.length, head = anchor) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: ghostTextExtension() }),
    lastTransaction: null as Transaction | null,
    dispatch(spec: TransactionSpec) {
      const tr = view.state.update(spec);
      view.lastTransaction = tr;
      view.state = tr.state;
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

test("showGhost ignores empty text", () => {
  const view = fakeView(DOC);
  showGhost(view, "");
  assert.equal(currentGhost(view), null);
});

test("showGhost ignores a request while text is selected", () => {
  const view = fakeView(DOC, 0, 6);
  showGhost(view, GHOST);
  assert.equal(currentGhost(view), null);
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

test("an insert that replaces text at the ghost clears it", () => {
  const view = fakeView(DOC + "zz", DOC.length);
  showGhost(view, GHOST);
  view.dispatch({ changes: { from: DOC.length, to: DOC.length + 2, insert: "p" }, selection: { anchor: DOC.length + 1 } });
  assert.equal(currentGhost(view), null);
});

test("deleting the character before the ghost clears it", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ changes: { from: DOC.length - 1, to: DOC.length }, selection: { anchor: DOC.length - 1 } });
  assert.equal(currentGhost(view), null);
});

test("two edits in one transaction clear the ghost", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ changes: [{ from: 0, insert: "x" }, { from: DOC.length, insert: "p" }], selection: { anchor: DOC.length + 2 } });
  assert.equal(currentGhost(view), null);
});

test("typing that leaves a selection clears the ghost", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ changes: { from: DOC.length, insert: "p" }, selection: { anchor: DOC.length, head: DOC.length + 1 } });
  assert.equal(currentGhost(view), null);
});

test("typing a matching letter with the cursor left behind clears the ghost", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ changes: { from: DOC.length, insert: "p" }, selection: { anchor: 0 } });
  assert.equal(currentGhost(view), null);
});

test("typing or pasting several matching letters in one go moves the suggestion forward", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  type(view, "part");
  assert.deepEqual(currentGhost(view), { pos: DOC.length + 4, text: "ial dependencies." });
});

test("typing all of a two-letter suggestion in one go clears it", () => {
  const view = fakeView(DOC);
  showGhost(view, "ab");
  type(view, "ab");
  assert.equal(currentGhost(view), null);
});

test("setting the cursor to where it already is keeps the ghost", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ selection: { anchor: DOC.length } });
  assert.deepEqual(currentGhost(view), { pos: DOC.length, text: GHOST });
});

test("selecting text at the ghost clears it", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  view.dispatch({ selection: { anchor: DOC.length - 3, head: DOC.length } });
  assert.equal(currentGhost(view), null);
});

test("accepting is recorded as an input event", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  acceptGhost(view);
  assert.equal(view.lastTransaction!.isUserEvent("input"), true);
});

test("the functions are safe on an editor without the extension", () => {
  const bare = {
    state: EditorState.create({ doc: DOC, selection: { anchor: DOC.length } }),
    dispatch() {
      throw new Error("must not dispatch");
    },
  } as unknown as EditorView;
  showGhost(bare, GHOST);
  assert.equal(currentGhost(bare), null);
  assert.equal(acceptGhost(bare), false);
  assert.equal(dismissGhost(bare), false);
});

// Tab and Escape: look up the bindings the extension registers and call them
function binding(view: EditorView, key: string) {
  const all = view.state.facet(keymap).flat();
  return all.find((b) => b.key === key);
}

test("Tab accepts the ghost and Escape dismisses it", () => {
  const view = fakeView(DOC);
  showGhost(view, GHOST);
  assert.equal(binding(view, "Tab")!.run!(view), true);
  assert.equal(view.state.doc.toString(), DOC + GHOST);
  showGhost(view, "more");
  assert.equal(binding(view, "Escape")!.run!(view), true);
  assert.equal(currentGhost(view), null);
});

test("Tab and Escape do nothing and return false without a ghost, so Tab can still indent", () => {
  const view = fakeView(DOC);
  assert.equal(binding(view, "Tab")!.run!(view), false);
  assert.equal(binding(view, "Escape")!.run!(view), false);
  assert.equal(view.state.doc.toString(), DOC);
});
