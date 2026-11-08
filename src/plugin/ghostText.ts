/**
 * Ghost text: a short grey suggestion after the cursor, from a small local model.
 * Tab accepts it, Esc dismisses it. The suggestion is never part of the note until accepted.
 *
 * No Obsidian imports, so it can be unit tested. The behaviour of every function is written
 * down in GHOST-TEXT.md, and ghostText.test.ts checks it.
 *
 *   shouldSuggest       decide whether to ask the model at all
 *   buildPrompt         the text sent to the model
 *   cleanCompletion     make the model's reply safe to show
 *   advanceSuggestion   move the suggestion forward as the user types it
 *   fetchCompletion     the Ollama call
 *   ghostTextExtension  the CodeMirror state and drawing, with showGhost, acceptGhost and so on
 */

import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";

export interface GhostOptions {
  /** Most characters of the note before the cursor that go into the prompt. */
  maxContextChars: number;
  /** Most words a suggestion may have. */
  maxWords: number;
  /** Words needed on the current line before a suggestion is requested. */
  minWordsBefore: number;
  /** Token limit sent to the model. */
  maxTokens: number;
}

export const DEFAULT_GHOST_OPTIONS: GhostOptions = {
  maxContextChars: 600,
  maxWords: 12,
  minWordsBefore: 3,
  maxTokens: 24,
};

const withDefaults = (opts?: Partial<GhostOptions>): GhostOptions => ({ ...DEFAULT_GHOST_OPTIONS, ...opts });

export interface SuggestInput {
  /** The whole note up to the cursor. */
  before: string;
  /** The rest of the cursor's line after the cursor. */
  after: string;
  hasSelection: boolean;
  enabled: boolean;
  /** True while a live fact-check is running. */
  busy: boolean;
}

export interface Ghost {
  /** Document offset where the grey text is shown (the cursor). */
  pos: number;
  text: string;
}

// ── shouldSuggest ──────────────────────────────────────────────────

const FENCE = /^\s*(```|~~~)/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

function inFrontmatter(beforeCurrentLine: string): boolean {
  const lines = beforeCurrentLine.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return false;
  // frontmatter is still open when no later line closes it
  return !lines.slice(1).some((l) => l.trim() === "---");
}

function inCodeFence(beforeCurrentLine: string): boolean {
  const fences = beforeCurrentLine.split(/\r?\n/).filter((l) => FENCE.test(l)).length;
  return fences % 2 === 1;
}

/** Decide whether to ask the model for a suggestion. */
export function shouldSuggest(input: SuggestInput, opts?: Partial<GhostOptions>): boolean {
  const o = withDefaults(opts);
  if (!input.enabled || input.busy || input.hasSelection) return false;
  if (input.after.trim() !== "") return false;
  if (!input.before.endsWith(" ")) return false;

  const lineStart = input.before.lastIndexOf("\n") + 1;
  const line = input.before.slice(lineStart);
  const earlier = input.before.slice(0, lineStart);

  if (/^\s{0,3}#{1,6}\s/.test(line)) return false;
  if (/^\s*\|/.test(line)) return false;
  if (FENCE.test(line) || inCodeFence(earlier)) return false;
  if (inFrontmatter(earlier)) return false;
  if ((input.before.match(/\$\$/g) ?? []).length % 2 === 1) return false;

  const words = line.replace(LIST_MARKER, "").split(/\s+/).filter(Boolean);
  return words.length >= o.minWordsBefore;
}

// ── buildPrompt ────────────────────────────────────────────────────

const INSTRUCTION =
  "Continue the text below with the next few words only. Reply with only those words, no quotes or explanation.\n\n";

const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** The text sent to the model: a short instruction, then the end of the note up to the cursor. */
export function buildPrompt(before: string, opts?: Partial<GhostOptions>): string {
  const o = withDefaults(opts);
  let text = before.replace(FRONTMATTER, "");
  if (text.length > o.maxContextChars) {
    const start = text.length - o.maxContextChars;
    const cutInsideWord = /\S/.test(text[start - 1] ?? " ") && /\S/.test(text[start]);
    text = text.slice(start);
    if (cutInsideWord) text = text.replace(/^\S+/, "");
    text = text.replace(/^\s+/, "");
  }
  return INSTRUCTION + text;
}

// ── cleanCompletion ────────────────────────────────────────────────

const CHATTY =
  /^(?:sure\b|certainly\b|here(?:'s|’s|\s+is|\s+are)\b|as an ai\b|(?:i'?m|i am)\s+sorry\b|sorry\b|i\s+can(?:'t|not)\b)/i;
const OPEN_QUOTE = /^["'“‘`]/;
const CLOSE_QUOTE = /["'”’`]$/;

/** Turn the model's raw reply into a safe suggestion, or an empty string. */
export function cleanCompletion(raw: string, before: string, opts?: Partial<GhostOptions>): string {
  const o = withDefaults(opts);
  let s = (raw.replace(/\r/g, "").split("\n")[0] ?? "").trim();

  if (OPEN_QUOTE.test(s)) s = s.replace(OPEN_QUOTE, "").replace(CLOSE_QUOTE, "").trim();
  if (CHATTY.test(s)) return "";

  // the model sometimes repeats the last words before the cursor
  const beforeWords = before.trim().split(/\s+/).filter(Boolean);
  for (let k = Math.min(beforeWords.length, 8); k >= 3; k--) {
    const echo = beforeWords.slice(-k).join(" ");
    if (s.toLowerCase().startsWith(echo.toLowerCase())) {
      const rest = s.slice(echo.length);
      if (rest === "" || /^[^\p{L}\p{N}]/u.test(rest)) {
        s = rest.trim();
        break;
      }
    }
  }

  // stop after the first sentence end (a decimal point is not one)
  const end = /[.!?]+(?=\s|$)/.exec(s);
  if (end) s = s.slice(0, end.index + end[0].length);

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > o.maxWords) s = words.slice(0, o.maxWords).join(" ");

  if (!/[\p{L}\p{N}]/u.test(s)) return "";

  const needsSpace = before !== "" && !/\s$/.test(before) && !/^[,.;:!?)\]}%]/.test(s);
  return needsSpace ? " " + s : s;
}

// ── advanceSuggestion ──────────────────────────────────────────────

/** The part of the suggestion still to come after the user typed `typed`, or null. */
export function advanceSuggestion(suggestion: string, typed: string): string | null {
  if (typed.length >= suggestion.length || !suggestion.startsWith(typed)) return null;
  return suggestion.slice(typed.length);
}

// ── fetchCompletion ────────────────────────────────────────────────

export interface FetchCompletionArgs {
  before: string;
  model: string;
  ollamaUrl: string;
  opts?: Partial<GhostOptions>;
  signal?: AbortSignal;
  /** The fetch to use. Defaults to the global one. Tests and the plugin pass their own. */
  fetchFn?: typeof fetch;
}

const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === "AbortError";

/** Ask Ollama for a suggestion. Returns the cleaned text, or "" if the request was aborted. */
export async function fetchCompletion(args: FetchCompletionArgs): Promise<string> {
  const o = withDefaults(args.opts);
  if (args.signal?.aborted) return "";
  const doFetch = args.fetchFn ?? fetch;
  const url = `${args.ollamaUrl.replace(/\/+$/, "")}/api/generate`;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: args.signal,
      body: JSON.stringify({
        model: args.model,
        prompt: buildPrompt(args.before, o),
        stream: false,
        // qwen models return an empty answer unless thinking is switched off
        think: false,
        keep_alive: "10m",
        options: { temperature: 0.2, num_predict: Math.min(40, Math.max(1, Math.round(o.maxTokens))), stop: ["\n"] },
      }),
    });
  } catch (e) {
    if (isAbort(e)) return "";
    throw new Error(`Could not reach Ollama at ${args.ollamaUrl}. Is it running?`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama generate failed (${res.status}): ${body.slice(0, 200)}`);
  }

  let data: { response?: unknown };
  try {
    data = await res.json();
  } catch (e) {
    if (isAbort(e)) return "";
    throw new Error("Ollama sent a reply that could not be read");
  }
  return cleanCompletion(String(data?.response ?? ""), args.before, o);
}

// ── Editor extension ───────────────────────────────────────────────

const setGhost = StateEffect.define<Ghost | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "notecheck-ghost";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    if (!value) return null;

    if (tr.docChanged) {
      // the only change that keeps the ghost: one insertion exactly at the ghost that matches its start
      const inserts: { from: number; to: number; text: string }[] = [];
      tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
        inserts.push({ from, to, text: inserted.toString() });
      });
      if (inserts.length !== 1) return null;
      const { from, to, text } = inserts[0];
      if (from !== value.pos || to !== value.pos || text === "") return null;
      const rest = advanceSuggestion(value.text, text);
      if (rest === null) return null;
      const pos = value.pos + text.length;
      const head = tr.newSelection.main;
      if (!head.empty || head.head !== pos) return null;
      return { pos, text: rest };
    }

    if (tr.selection) {
      const head = tr.newSelection.main;
      if (!head.empty || head.head !== value.pos) return null;
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (g): DecorationSet =>
      g ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)]) : Decoration.none,
    ),
});

// Tab and Esc only do something while a ghost is showing, so Tab still indents otherwise
const ghostKeys = Prec.highest(
  keymap.of([
    { key: "Tab", run: (view) => acceptGhost(view) },
    { key: "Escape", run: (view) => dismissGhost(view) },
  ]),
);

/** Register once with plugin.registerEditorExtension. */
export function ghostTextExtension(): Extension {
  return [ghostField, ghostKeys];
}

/** Show `text` as grey text at the cursor. Ignored when empty or when text is selected. */
export function showGhost(view: EditorView, text: string): void {
  const sel = view.state.selection.main;
  if (text === "" || !sel.empty) return;
  if (view.state.field(ghostField, false) === undefined) return;
  view.dispatch({ effects: setGhost.of({ pos: sel.head, text }) });
}

export function currentGhost(view: EditorView): Ghost | null {
  return view.state.field(ghostField, false) ?? null;
}

/** Insert the suggestion and put the cursor after it. Returns false when there is none. */
export function acceptGhost(view: EditorView): boolean {
  const g = currentGhost(view);
  if (!g) return false;
  view.dispatch({
    changes: { from: g.pos, insert: g.text },
    selection: { anchor: g.pos + g.text.length },
    effects: setGhost.of(null),
    userEvent: "input.notecheck-ghost",
  });
  return true;
}

/** Clear the suggestion without touching the note. Returns false when there is none. */
export function dismissGhost(view: EditorView): boolean {
  if (!currentGhost(view)) return false;
  view.dispatch({ effects: setGhost.of(null) });
  return true;
}
