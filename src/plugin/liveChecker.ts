/**
 * Live fact-checking engine.
 *
 * Uses polling to detect editor changes, then debounces and checks the current paragraph/section.
 * Refuted claims show up as inline suggestions (see inlineDecorations.ts).
 *
 * Each sentence is sent to the model once. Its result is cached by its text, so typing a new
 * sentence only checks that sentence, and moving a paragraph around costs nothing. The sentence
 * still being typed is left alone until it is finished. A check that is running when the user
 * types more is allowed to finish (its results stay valid, because they are keyed by text), and
 * the new sentences are checked straight after.
 */

import { MarkdownView, Notice, Plugin, type App, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { factCheck, type FactCheckRequest } from "../orchestrator/index";
import { extractSmartContext } from "./paragraphExtractor";
import { clearFindings, findingFor, setSuggestionHandlers, showFindings, type Finding } from "./inlineDecorations";
import { checkableUnits, type Unit } from "./liveText";
import type { ClaimCard, Evidence } from "../contract/claimCard";
import { openEvidence } from "./evidence";

interface LiveCheckerState {
  /** Debounce timer ID. */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** True while a check is running. */
  running: boolean;
  /** An editor that changed while a check was running, to check next. */
  pendingEditor: Editor | null;
  /** Abort controller for the in-flight check, used when live checking is switched off. */
  abortController: AbortController | null;
  /** Last known content for change detection. */
  lastContent: Map<Editor, string>;
  /** Whether live checking is currently enabled. */
  enabled: boolean;
  /** Debounce milliseconds. */
  debounceMs: number;
  /** Polling interval ID. */
  pollTimer: ReturnType<typeof setInterval> | null;
}

/** Global state for the live checker. */
const state: LiveCheckerState = {
  debounceTimer: null,
  running: false,
  pendingEditor: null,
  abortController: null,
  lastContent: new Map(),
  enabled: false,
  debounceMs: 1500,
  pollTimer: null,
};

/** Claim cards per sentence text. Oldest entries go first once it is full. */
const checkedUnits = new Map<string, ClaimCard[]>();
const MAX_CACHED_UNITS = 1000;
/** Suggestions the user dismissed, by finding id, so they do not come back. */
const dismissed = new Set<string>();

function remember(text: string, cards: ClaimCard[]): void {
  checkedUnits.delete(text);
  checkedUnits.set(text, cards);
  while (checkedUnits.size > MAX_CACHED_UNITS) checkedUnits.delete(checkedUnits.keys().next().value!);
}

/**
 * Initialize the live checker with plugin settings.
 */
export function initLiveChecker(plugin: Plugin, enabled: boolean, debounceMs: number): void {
  state.enabled = enabled;
  state.debounceMs = debounceMs;
  setSuggestionHandlers(suggestionHandlers(plugin.app));

  if (enabled) {
    startPolling(plugin);
  }
}

/**
 * Enable or disable live checking.
 */
export function setLiveCheckEnabled(plugin: Plugin, enabled: boolean): void {
  state.enabled = enabled;

  if (enabled) {
    setSuggestionHandlers(suggestionHandlers(plugin.app));
    startPolling(plugin);
    new Notice("NoteCheck: Live fact-checking enabled");
  } else {
    stopPolling();
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    state.abortController?.abort();
    // Clear suggestions from all editors
    clearAllHighlights();
    new Notice("NoteCheck: Live fact-checking disabled");
  }
}

/**
 * Update the debounce delay.
 */
export function setLiveCheckDebounce(debounceMs: number): void {
  state.debounceMs = Math.max(200, debounceMs);
  // Restart polling with new interval if enabled
  if (state.enabled) {
    stopPolling();
    const plugin = (window as any).noteCheckPlugin;
    if (plugin) startPolling(plugin);
  }
}

/** What Accept, Dismiss and the evidence link do. */
function suggestionHandlers(app: App) {
  return {
    // the accepted wording is known to be right, so it is not sent to the model again
    onAccept: (_f: Finding, newText: string) => remember(newText, []),
    onDismiss: (f: Finding) => {
      dismissed.add(f.id);
    },
    openEvidence: (ev: Evidence) => {
      openEvidence(app, ev);
    },
  };
}

/**
 * Start polling for editor changes.
 */
function startPolling(plugin: Plugin): void {
  if (state.pollTimer) return;

  const workspace = (plugin as any).app?.workspace;
  if (!workspace) return;

  // Initial attachment to current editors
  attachToCurrentEditors(workspace);

  // Poll for changes every 500ms
  state.pollTimer = setInterval(() => {
    if (!state.enabled) return;
    pollEditors(workspace);
  }, 500);

  // Also listen for layout changes to catch new editors
  workspace.on("layout-change", () => {
    if (!state.enabled) return;
    attachToCurrentEditors(workspace);
  });
}

/**
 * Stop polling.
 */
function stopPolling(): void {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/**
 * Attach to all currently open markdown editors.
 */
function attachToCurrentEditors(workspace: any): void {
  const leaves = workspace.getLeavesOfType("markdown");
  for (const leaf of leaves) {
    const view = leaf.view as MarkdownView;
    if (view && view.editor) {
      trackEditor(view.editor);
    }
  }
}

/**
 * Start tracking an editor for changes.
 */
function trackEditor(editor: Editor): void {
  if (state.lastContent.has(editor)) return;
  state.lastContent.set(editor, editor.getValue());
}

/**
 * Poll all tracked editors for changes.
 */
function pollEditors(workspace: any): void {
  // Update tracked editors list
  attachToCurrentEditors(workspace);

  // Check each tracked editor for changes
  for (const [editor, lastContent] of state.lastContent) {
    // Skip if editor is no longer active
    const currentContent = editor.getValue();
    if (currentContent !== lastContent) {
      state.lastContent.set(editor, currentContent);
      onEditorChange(editor);
    }
  }
}

/** The CodeMirror 6 view behind an Obsidian editor. */
function editorView(editor: Editor): EditorView | undefined {
  return (editor as any).cm as EditorView | undefined;
}

/**
 * Clear suggestions from all editors.
 */
function clearAllHighlights(): void {
  for (const editor of state.lastContent.keys()) {
    const view = editorView(editor);
    if (view) clearFindings(view);
  }
}

/**
 * Handle editor content change - debounce and trigger check.
 */
function onEditorChange(editor: Editor): void {
  if (!state.enabled) return;

  // Clear existing debounce timer
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  // Debounce the fact-check
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    runLiveCheck(editor);
  }, state.debounceMs);
}

/**
 * Check new sentences around the cursor, then keep going while more edits came in meanwhile.
 */
async function runLiveCheck(editor: Editor): Promise<void> {
  if (state.running) {
    state.pendingEditor = editor;
    return;
  }
  state.running = true;

  let next: Editor | null = editor;
  try {
    while (next && state.enabled) {
      state.pendingEditor = null;
      await checkNewSentences(next);
      next = state.pendingEditor;
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      console.error("[NoteCheck Live] Fact-check failed:", err);
      showCheckingStatus(editor, false, "Check failed");
    }
  } finally {
    state.running = false;
    state.abortController = null;
  }
}

/** The block around the cursor, with its true start in the document (the extracted text is trimmed). */
function locateContext(editor: Editor): { text: string; base: number; headings: string[] } | null {
  const context = extractSmartContext(editor);
  if (!context) return null;
  const base = editor.getValue().indexOf(context.text, context.startOffset);
  return base < 0 ? null : { text: context.text, base, headings: context.headings };
}

/** Which unit each card came from: the one containing its original text, else the most similar one. */
function assignCards(units: Unit[], cards: ClaimCard[]): ClaimCard[][] {
  const out: ClaimCard[][] = units.map(() => []);
  const wordsOf = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const card of cards) {
    const original = card.original_text?.trim() ?? "";
    let i = original ? units.findIndex((u) => u.text.includes(original)) : -1;
    if (i < 0) {
      const target = wordsOf(original || card.claim);
      let best = 0;
      units.forEach((u, j) => {
        const overlap = [...wordsOf(u.text)].filter((w) => target.has(w)).length;
        if (overlap > best) {
          best = overlap;
          i = j;
        }
      });
    }
    if (i >= 0) out[i].push(card);
  }
  return out;
}

async function checkNewSentences(editor: Editor): Promise<void> {
  const view = editorView(editor);
  const context = locateContext(editor);
  if (!view || !context) return;

  const cursor = editor.posToOffset(editor.getCursor());
  const fresh = checkableUnits(context.text, context.base, cursor).filter((u) => !checkedUnits.has(u.text));

  if (fresh.length > 0) {
    showCheckingStatus(editor, true, `Checking ${fresh.length} sentence${fresh.length > 1 ? "s" : ""}…`);
    const plugin = (window as any).noteCheckPlugin;
    const file = plugin?.app?.workspace.getActiveViewOfType(MarkdownView)?.file;

    const request: FactCheckRequest = {
      text: fresh.map((u) => u.text).join("\n"),
      note_title: file?.basename,
      headings: context.headings,
    };

    // Same options as the command (including the course index), when the plugin is loaded
    const base = plugin?.pipelineOptions
      ? await plugin.pipelineOptions(file?.path, { noteTitle: file?.basename, headings: context.headings, fast: true })
      : { ollamaUrl: getOllamaUrl(), model: getModelName(), userAgent: getWikiUserAgent() };
    state.abortController = new AbortController();
    const response = await factCheck(request, {
      ...base,
      directClaims: true,
      maxRetries: 0,
      retrieval: { pages: 1, candidates: 8, mode: "keyword" },
      signal: state.abortController.signal,
      log: (msg) => console.log(`[NoteCheck Live] ${msg}`),
    });
    if (state.abortController.signal.aborted || !state.enabled) return;

    assignCards(fresh, response.cards).forEach((cards, i) => {
      // a claim that could not be checked (Wikipedia or Ollama not answering) is tried again next time
      if (cards.some((c) => c.explanation?.startsWith("Could not check"))) return;
      remember(fresh[i].text, cards);
    });
  }

  render(editor, view);
}

/** Show the cached suggestions for the block around the cursor, at their current positions. */
function render(editor: Editor, view: EditorView): void {
  // positions are worked out again from the current text, because the user may have typed meanwhile
  const context = locateContext(editor);
  if (!context) return;

  const findings: Finding[] = [];
  for (const unit of checkableUnits(context.text, context.base, -1)) {
    for (const card of checkedUnits.get(unit.text) ?? []) {
      const f = findingFor(card, unit);
      if (f && !dismissed.has(f.id)) findings.push(f);
    }
  }
  showFindings(view, context.base, context.base + context.text.length, findings);

  if (findings.length > 0) {
    showCheckingStatus(editor, false, `${findings.length} suggestion${findings.length > 1 ? "s" : ""}`);
  } else {
    showCheckingStatus(editor, false, "No issues");
  }
}

/**
 * Show/hide checking status in the editor.
 */
function showCheckingStatus(editor: Editor, checking: boolean, message?: string): void {
  const container = (editor as any).containerEl as HTMLElement;
  if (!container) return;

  let statusEl = container.querySelector(".notecheck-live-status") as HTMLElement;
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "notecheck-live-status";
    statusEl.style.cssText = `
      position: absolute;
      bottom: 8px;
      right: 8px;
      z-index: 100;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.75em;
      color: var(--text-muted);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    container.style.position = "relative";
    container.appendChild(statusEl);
  }

  if (checking) {
    statusEl.textContent = `NoteCheck: ${message ?? "Checking…"}`;
    statusEl.style.color = "var(--text-accent)";
    statusEl.style.borderColor = "var(--interactive-accent)";
  } else {
    statusEl.textContent = message || "NoteCheck: Ready";
    statusEl.style.color = "var(--text-muted)";
    statusEl.style.borderColor = "var(--background-modifier-border)";
    setTimeout(() => {
      if (statusEl.textContent === message) {
        statusEl.textContent = "NoteCheck: Ready";
      }
    }, 3000);
  }
}

/**
 * Get Ollama URL from plugin settings.
 */
function getOllamaUrl(): string {
  return (window as any).noteCheckPlugin?.settings?.ollamaUrl ?? "http://localhost:11434";
}

/**
 * Get model name from plugin settings.
 */
function getModelName(): string {
  return (window as any).noteCheckPlugin?.settings?.modelName ?? "qwen3.5:9b";
}

/**
 * Get Wikimedia User-Agent from plugin settings.
 */
function getWikiUserAgent(): string {
  return (window as any).noteCheckPlugin?.settings?.wikiUserAgent ?? "";
}

/**
 * Manually trigger a live check on the active editor (for testing).
 */
export function triggerLiveCheckOnActiveEditor(): void {
  const workspace = (window as any).noteCheckPlugin?.app?.workspace;
  if (!workspace) return;

  const view = workspace.getActiveViewOfType(MarkdownView);
  if (view?.editor) {
    runLiveCheck(view.editor);
  }
}

/**
 * Check if live checking is currently running.
 */
export function isLiveChecking(): boolean {
  return state.running;
}
