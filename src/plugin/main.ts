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
 *   5. Dispatches fact-check requests to the pipeline (currently using mock cards)
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
} from "obsidian";
import type { FactCheckRequest } from "../contract/claimCard.js";
import { DEFAULT_SETTINGS, type NoteCheckSettings } from "./types.js";
import { NoteCheckSettingTab } from "./settingsTab.js";
import { NoteCheckResultView, VIEW_TYPE_NOTECHECK } from "./resultView.js";
import { ALL_MOCK_CARDS } from "./mockData.js";

export default class NoteCheckPlugin extends Plugin {
  settings: NoteCheckSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    console.log("Loading NoteCheck plugin...");

    // 1. Load persisted settings
    await this.loadSettings();

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
  }

  onunload(): void {
    console.log("Unloading NoteCheck plugin.");
  }

  // ── Settings management ──────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
      return leaf.view as NoteCheckResultView;
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

      // ─────────────────────────────────────────────────────────────
      // TODO: Replace mock data with real orchestrator pipeline call
      // when Jonathan Ho's orchestrator (src/orchestrator/) is ready.
      //
      // Expected integration:
      //   import { runFactCheckPipeline } from "../orchestrator/pipeline.js";
      //   const response = await runFactCheckPipeline(request, {
      //     ollamaUrl: this.settings.ollamaUrl,
      //     model: this.settings.modelName,
      //     userAgent: this.settings.wikiUserAgent,
      //   });
      //   view.renderCards(response.cards);
      // ─────────────────────────────────────────────────────────────

      // Simulating slight async processing time with contract mock cards
      setTimeout(() => {
        view.renderCards(ALL_MOCK_CARDS);
        new Notice("NoteCheck: Fact-check complete!");
      }, 400);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(`NoteCheck error: ${errorMsg}`);
      const view = await this.activateResultsView();
      view.showError(errorMsg);
    }
  }
}

