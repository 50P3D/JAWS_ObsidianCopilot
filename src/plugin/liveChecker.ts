/**
 * Live fact-checking engine.
 *
 * Uses polling to detect editor changes, then debounces and runs fact-check
 * on the current paragraph/section. Applies inline highlights for refuted claims.
 */

import { Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { factCheck, type FactCheckRequest } from "../orchestrator/index";
import { extractSmartContext, type ExtractedParagraph } from "./paragraphExtractor";
import { applyInlineHighlights, clearInlineHighlights } from "./inlineDecorations";
import type { ClaimCard } from "../contract/claimCard";

interface LiveCheckerState {
  /** Debounce timer ID. */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Currently checking editor (to prevent concurrent checks). */
  activeEditor: Editor | null;
  /** Abort controller for in-flight check. */
  abortController: AbortController | null;
  /** Last checked text hash (to skip redundant checks). */
  lastTextHash: string | null;
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
  activeEditor: null,
  abortController: null,
  lastTextHash: null,
  lastContent: new Map(),
  enabled: false,
  debounceMs: 1500,
  pollTimer: null,
};

/**
 * Initialize the live checker with plugin settings.
 */
export function initLiveChecker(plugin: Plugin, enabled: boolean, debounceMs: number): void {
  state.enabled = enabled;
  state.debounceMs = debounceMs;

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
    startPolling(plugin);
    new Notice("NoteCheck: Live fact-checking enabled");
  } else {
    stopPolling();
    // Clear highlights from all editors
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
    const view = workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.editor !== editor) continue;

    const currentContent = editor.getValue();
    if (currentContent !== lastContent) {
      state.lastContent.set(editor, currentContent);
      onEditorChange(editor);
    }
  }
}

/**
 * Clear highlights from all editors.
 */
function clearAllHighlights(): void {
  for (const editor of state.lastContent.keys()) {
    clearInlineHighlights(editor);
  }
}

/**
 * Simple hash function for text comparison.
 */
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
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
    runLiveCheck(editor);
  }, state.debounceMs);
}

/**
 * Run the live fact-check on the current paragraph/section.
 */
async function runLiveCheck(editor: Editor): Promise<void> {
  // Prevent concurrent checks
  if (state.activeEditor && state.activeEditor !== editor) {
    return;
  }

  // Abort any in-flight check
  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();

  state.activeEditor = editor;

  try {
    // Extract context around cursor
    const context = extractSmartContext(editor);
    if (!context) {
      clearInlineHighlights(editor);
      return;
    }

    // Skip if text hasn't changed significantly
    const textHash = hashText(context.text);
    if (textHash === state.lastTextHash) {
      return;
    }
    state.lastTextHash = textHash;

    // Skip non-checkable text
    const trimmed = context.text.trim();
    if (trimmed.length < 50) {
      clearInlineHighlights(editor);
      return;
    }

    // Get note title for decontextualization
    const view = (editor as any).view as MarkdownView | undefined;
    const noteTitle = view?.file?.basename;

    // Build fact-check request
    const request: FactCheckRequest = {
      text: context.text,
      note_title: noteTitle,
      headings: context.headings,
    };

    // Show subtle status
    showCheckingStatus(editor, true);

    // Run fact-check pipeline with abort signal
    const response = await factCheck(request, {
      ollamaUrl: getOllamaUrl(),
      model: getModelName(),
      userAgent: getWikiUserAgent(),
      signal: state.abortController.signal,
      log: (msg) => console.log(`[NoteCheck Live] ${msg}`),
    });

    // Check if aborted
    if (state.abortController.signal.aborted) return;

    // Apply inline highlights for refuted claims
    // Adjust source_spans to be relative to full document
    const adjustedCards = adjustCardSpans(response.cards, context.startOffset);
    applyInlineHighlights(editor, adjustedCards, (window as any).noteCheckPlugin);

    // Update status
    const refutedCount = adjustedCards.filter((c) => c.verdict === "Refuted").length;
    if (refutedCount > 0) {
      showCheckingStatus(editor, false, `${refutedCount} issue${refutedCount > 1 ? "s" : ""} found`);
    } else {
      showCheckingStatus(editor, false, "No issues");
    }

  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    console.error("[NoteCheck Live] Fact-check failed:", err);
    showCheckingStatus(editor, false, "Check failed");
  } finally {
    state.activeEditor = null;
    state.abortController = null;
  }
}

/**
 * Adjust claim card source_spans from paragraph-relative to document-relative.
 */
function adjustCardSpans(cards: ClaimCard[], paragraphStartOffset: number): ClaimCard[] {
  return cards.map((card) => {
    if (!card.source_span) return card;

    return {
      ...card,
      source_span: {
        start: card.source_span.start + paragraphStartOffset,
        end: card.source_span.end + paragraphStartOffset,
      },
    };
  });
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
    statusEl.textContent = "NoteCheck: Checking…";
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
  return state.activeEditor !== null;
}