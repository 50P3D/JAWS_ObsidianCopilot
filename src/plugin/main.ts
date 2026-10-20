/**
 * NoteCheck Obsidian Plugin.
 *
 * Fact-checks user notes against Wikipedia with a local LLM.
 *
 * This is the main plugin entry point. It:
 *   1. Loads and manages plugin settings (Ollama URL, model name, etc.)
 *   2. Registers the "NoteCheck: Fact-check selection" command
 *   3. Registers the right-sidebar results view (`ItemView`)
 *   4. Provides a ribbon icon for quick access to the results panel
 *   5. Dispatches fact-check requests to the real orchestrator pipeline
 *   6. Runs live fact-checking as you type (when enabled)
 *
 * Owner: Medapati Williams Smith
 */

import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";
import type { ClaimCard, FactCheckRequest } from "../contract/claimCard.js";
import { factCheck } from "../orchestrator/index.js";
import { DEFAULT_SETTINGS, type NoteCheckSettings } from "./types.js";
import { NoteCheckSettingTab } from "./settingsTab.js";
import { NoteCheckResultView, VIEW_TYPE_NOTECHECK } from "./resultView.js";
import { initLiveChecker, setLiveCheckEnabled, setLiveCheckDebounce } from "./liveChecker.js";
import { setCustomFetch as setWikiFetch, clearCustomFetch as clearWikiFetch } from "../retrieval/wikipedia.js";
import { setCustomFetch as setEmbedFetch, clearCustomFetch as clearEmbedFetch } from "../retrieval/embed.js";
import { setCustomFetch as setOllamaFetch, clearCustomFetch as clearOllamaFetch } from "../llm/ollama.js";
import { setCustomFetch as setReliabilityFetch, clearCustomFetch as clearReliabilityFetch } from "../reliability/http.js";

export default class NoteCheckPlugin extends Plugin {
  settings: NoteCheckSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    console.log("Loading NoteCheck plugin...");

    // 1. Load persisted settings
    await this.loadSettings();

    // Set up custom fetch using Obsidian's requestUrl (handles CORS)
    const obsidianFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const urlString = typeof url === 'string' ? url : url.toString();
      const response = await requestUrl({
        url: urlString,
        method: init?.method ?? "GET",
        headers: init?.headers as Record<string, string> ?? {},
        body: init?.body as string ?? undefined,
        throw: false, // Don't throw on non-2xx, let us handle it
      });
      // Convert to fetch-like Response
      return new Response(response.text, {
        status: response.status,
        statusText: response.status === 200 ? "OK" : "Error",
        headers: { "Content-Type": "application/json" },
      });
    };

    // Inject custom fetch into all network modules
    setWikiFetch(obsidianFetch);
    setEmbedFetch(obsidianFetch);
    setOllamaFetch(obsidianFetch);
    setReliabilityFetch(obsidianFetch);

    // Expose plugin instance globally for liveChecker access to settings
    (window as any).noteCheckPlugin = this;

    // 2. Register the custom ItemView for the results sidebar
    this.registerView(
      VIEW_TYPE_NOTECHECK,
      (leaf: WorkspaceLeaf) => new NoteCheckResultView(leaf)
    );

    // 3. Register the command palette action
    this.addCommand({
      id: "fact-check-selection",
      name: "Fact-check selection",
      editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const selection = editor.getSelection().trim();

        if (!selection) {
          new Notice("NoteCheck: Please select some text to fact-check.");
          return;
        }

        const request: FactCheckRequest = {
          text: selection,
          note_title: ctx.file?.basename,
          headings: this.extractHeadings(editor, ctx),
        };

        await this.runFactCheck(request);
      },
    });

    // 4. Add ribbon icon (magnifying glass) to toggle/open results panel
    this.addRibbonIcon("search", "NoteCheck Results", async () => {
      await this.activateResultsView();
    });

    // 5. Register settings tab
    this.addSettingTab(new NoteCheckSettingTab(this.app, this));

    // 6. Initialize live fact-checking if enabled
    if (this.settings.enableLiveCheck) {
      initLiveChecker(this, true, this.settings.liveCheckDebounceMs);
    }
  }

  onunload(): void {
    console.log("Unloading NoteCheck plugin.");
    // Clean up custom fetch
    clearWikiFetch();
    clearEmbedFetch();
    clearOllamaFetch();
    clearReliabilityFetch();

    // Clean up global reference
    (window as any).noteCheckPlugin = undefined;
    // Disable live checker to clean up listeners
    setLiveCheckEnabled(this, false);
  }

  // ── Settings management ──────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Called when the live check setting is toggled from the settings tab.
   */
  onLiveCheckSettingChange(enabled: boolean): void {
    setLiveCheckEnabled(this, enabled);
  }

  /**
   * Called when the live check debounce setting is changed.
   */
  onLiveCheckDebounceChange(debounceMs: number): void {
    setLiveCheckDebounce(debounceMs);
  }

  // ── Sidebar view activation ──────────────────────────────────────

  /**
   * Reveals the results view in the right sidebar, or creates it if not yet open.
   */
  async activateResultsView(): Promise<NoteCheckResultView> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_NOTECHECK)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({
          type: VIEW_TYPE_NOTECHECK,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      const view = leaf.view as NoteCheckResultView;
      view.onApplyFix = (card) => this.applyFix(card);
      return view;
    }

    throw new Error("Failed to activate NoteCheck results view in sidebar.");
  }

  // ── Fact-checking dispatch ───────────────────────────────────────

  /**
   * Executes the fact-checking workflow for the provided request.
   *
   * @param request The text selection and note context.
   */
  async runFactCheck(request: FactCheckRequest): Promise<void> {
    try {
      const view = await this.activateResultsView();
      view.showLoading();

      new Notice(`NoteCheck: Checking claims for "${request.note_title ?? "selection"}"...`);

      const response = await factCheck(request, {
        ollamaUrl: this.settings.ollamaUrl,
        model: this.settings.modelName,
        userAgent: this.settings.wikiUserAgent,
      });

      view.renderCards(response.cards);
      new Notice("NoteCheck: Fact-check complete!");
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(`NoteCheck error: ${errorMsg}`);
      const view = await this.activateResultsView();
      view.showError(errorMsg);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Extract markdown headings from the note content above the current cursor
   * position, so the claim extractor has context for decontextualisation.
   */
  private extractHeadings(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): string[] {
    const cursor = editor.getCursor("from");
    const lines = editor.getRange({ line: 0, ch: 0 }, cursor).split("\n");
    const headings: string[] = [];
    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) {
        headings.push(match[2].trim());
      }
    }
    return headings;
  }

  /**
   * Apply a suggested fix to the note by replacing the original text at the
   * given source span with the corrected text.
   */
  async applyFix(card: ClaimCard): Promise<void> {
    if (!card.source_span || !card.suggested_fix) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("NoteCheck: No active editor to apply fix.");
      return;
    }

    const editor = view.editor;
    const { start, end } = card.source_span;

    // Convert character positions to line/ch
    const doc = editor.getValue();
    let lineStart = 0;
    let startLine = 0, startCh = 0, endLine = 0, endCh = 0;
    let pos = 0;
    const docLines = doc.split("\n");

    for (let i = 0; i < docLines.length; i++) {
      const lineEnd = pos + docLines[i].length;
      if (pos <= start && start <= lineEnd) {
        startLine = i;
        startCh = start - pos;
      }
      if (pos <= end && end <= lineEnd) {
        endLine = i;
        endCh = end - pos;
        break;
      }
      pos = lineEnd + 1; // +1 for newline
    }

    editor.replaceRange(card.suggested_fix, { line: startLine, ch: startCh }, { line: endLine, ch: endCh });
    new Notice("NoteCheck: Fix applied.");
  }
}
