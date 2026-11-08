/**
 * Ghost text: a short grey suggestion after the cursor, from a small local model.
 * Tab accepts it, Esc dismisses it. The suggestion is never part of the note until accepted.
 *
 * STUB. The tests in ghostText.test.ts were written first and fail on purpose.
 * The behaviour each function must have is in GHOST-TEXT.md.
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

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

const todo = (): never => {
  throw new Error("not implemented");
};

export function shouldSuggest(_input: SuggestInput, _opts?: Partial<GhostOptions>): boolean {
  return todo();
}

export function buildPrompt(_before: string, _opts?: Partial<GhostOptions>): string {
  return todo();
}

export function cleanCompletion(_raw: string, _before: string, _opts?: Partial<GhostOptions>): string {
  return todo();
}

export function advanceSuggestion(_suggestion: string, _typed: string): string | null {
  return todo();
}

export interface FetchCompletionArgs {
  before: string;
  model: string;
  ollamaUrl: string;
  opts?: Partial<GhostOptions>;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export async function fetchCompletion(_args: FetchCompletionArgs): Promise<string> {
  return todo();
}

export function ghostTextExtension(): Extension {
  return [];
}

export function showGhost(_view: EditorView, _text: string): void {
  todo();
}

export function currentGhost(_view: EditorView): Ghost | null {
  return todo();
}

export function acceptGhost(_view: EditorView): boolean {
  return todo();
}

export function dismissGhost(_view: EditorView): boolean {
  return todo();
}
