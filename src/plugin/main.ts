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
 *   7. Keeps the course index (RAG over the user's course folder) up to date
 *
 * Owner: Medapati Williams Smith
 */

import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
} from "obsidian";
import type { ClaimCard, FactCheckRequest } from "../contract/claimCard.js";
import { factCheck, type PipelineOptions } from "../orchestrator/index.js";
import { CourseIndex, type CourseFile, type IndexStore } from "../course/index.js";
import { enableCache as enableWikiCache } from "../retrieval/wikipedia.js";
import { DEFAULT_SETTINGS, type NoteCheckSettings } from "./types.js";
import { NoteCheckSettingTab } from "./settingsTab.js";
import { NoteCheckResultView, VIEW_TYPE_NOTECHECK } from "./resultView.js";
import { initLiveChecker, setLiveCheckEnabled, setLiveCheckDebounce } from "./liveChecker.js";
import { acceptAtCursor, findingFor, liveSuggestionsExtension, showFindings, type Finding } from "./inlineDecorations.js";
import { minimalEdit } from "./liveText.js";
import type { EditorView } from "@codemirror/view";
import { setCustomFetch as setWikiFetch, clearCustomFetch as clearWikiFetch } from "../retrieval/wikipedia.js";
import { setCustomFetch as setEmbedFetch, clearCustomFetch as clearEmbedFetch } from "../retrieval/embed.js";
import { setCustomFetch as setOllamaFetch, clearCustomFetch as clearOllamaFetch } from "../llm/ollama.js";
import { setCustomFetch as setReliabilityFetch, clearCustomFetch as clearReliabilityFetch } from "../reliability/http.js";

export default class NoteCheckPlugin extends Plugin {
  settings: NoteCheckSettings = DEFAULT_SETTINGS;
  courseIndex!: CourseIndex;
  /** The editor of the last "Fact-check selection", so "Apply fix" in the sidebar knows where to edit. */
  private lastCheckedEditor: Editor | null = null;

  async onload(): Promise<void> {
    console.log("Loading NoteCheck plugin...");

    // 1. Load persisted settings
    await this.loadSettings();

    // The course index lives next to data.json in the plugin folder, outside the user's notes
    this.courseIndex = new CourseIndex(this.vaultStore("course-index.json"));

    // Reuse fetched Wikipedia articles for an hour, so re-checking a note does not fetch them again
    enableWikiCache({ ttlMs: 60 * 60 * 1000 });

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
        const raw = editor.getSelection();
        const selection = raw.trim();

        if (!selection) {
          new Notice("NoteCheck: Please select some text to fact-check.");
          return;
        }

        const request: FactCheckRequest = {
          text: selection,
          note_title: ctx.file?.basename,
          headings: this.extractHeadings(editor, ctx),
        };

        // where the trimmed selection starts in the note, so claim positions can be mapped back
        const offset = editor.posToOffset(editor.getCursor("from")) + (raw.length - raw.trimStart().length);
        await this.runFactCheck(request, ctx.file?.path, { editor, offset });
      },
    });

    // Inline suggestions (tracked-changes style) for live checks and selection checks
    this.registerEditorExtension(liveSuggestionsExtension());

    this.addCommand({
      id: "accept-suggestion",
      name: "Accept suggestion at cursor",
      editorCallback: (editor: Editor) => {
        const cm = (editor as any).cm as EditorView | undefined;
        if (!cm || !acceptAtCursor(cm)) new Notice("NoteCheck: No suggestion in this sentence.");
      },
    });

    this.addCommand({
      id: "index-course-materials",
      name: "Index course materials",
      callback: async () => {
        if (!this.settings.courseFolder.trim()) {
          new Notice("NoteCheck: Set a course materials folder in the settings first.");
          return;
        }
        try {
          const r = await this.syncCourseIndex();
          new Notice(
            `NoteCheck: Course index has ${r.passages} passages ` +
            `(${r.added} new, ${r.updated} updated, ${r.removed} removed files).`
          );
        } catch (err) {
          new Notice(`NoteCheck: Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    // 4. Add ribbon icon (magnifying glass) to toggle/open results panel
    this.addRibbonIcon("search", "NoteCheck Results", async () => {
      await this.activateResultsView();
    });

    // 5. Register settings tab
    this.addSettingTab(new NoteCheckSettingTab(this.app, this));

    // 6. Initialize live fact-checking. Always run, because it also wires up the suggestion
    //    buttons used by selection checks; it only watches the editor when enabled.
    initLiveChecker(this, this.settings.enableLiveCheck, this.settings.liveCheckDebounceMs);
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
  async runFactCheck(
    request: FactCheckRequest,
    notePath?: string,
    target?: { editor: Editor; offset: number },
  ): Promise<void> {
    try {
      const view = await this.activateResultsView();
      view.showLoading();

      new Notice(`NoteCheck: Checking claims for "${request.note_title ?? "selection"}"...`);

      // the user selected exactly this text, so a short sentence is checked even if extraction drops it
      const response = await factCheck(request, { ...(await this.pipelineOptions(notePath)), fallbackToText: true });

      // claim positions come back relative to the selection; make them positions in the note
      const cards = target
        ? response.cards.map((c) =>
            c.source_span
              ? { ...c, source_span: { start: c.source_span.start + target.offset, end: c.source_span.end + target.offset } }
              : c
          )
        : response.cards;

      if (target) {
        this.lastCheckedEditor = target.editor;
        this.showSelectionSuggestions(target.editor, cards, target.offset, target.offset + request.text.length);
      }
      view.renderCards(cards);
      new Notice("NoteCheck: Fact-check complete!");
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      new Notice(`NoteCheck error: ${errorMsg}`);
      const view = await this.activateResultsView();
      view.showError(errorMsg);
    }
  }

  /**
   * Options for one pipeline run, shared by the command and the live checker.
   * With a course folder set, the course index is synced first (only changed files are
   * re-embedded) and the note being checked is left out, so a note never confirms itself.
   */
  async pipelineOptions(notePath?: string): Promise<PipelineOptions> {
    const opts: PipelineOptions = {
      ollamaUrl: this.settings.ollamaUrl,
      model: this.settings.modelName,
      userAgent: this.settings.wikiUserAgent,
    };
    if (!this.settings.courseFolder.trim()) return opts;

    await this.syncCourseIndex();
    const exclude = notePath ? [notePath] : [];
    opts.course = {
      search: (claim) => this.courseIndex.search(claim, { exclude }),
      only: this.settings.courseOnly,
    };
    return opts;
  }

  // ── Course index ─────────────────────────────────────────────────

  syncCourseIndex() {
    return this.courseIndex.sync(this.courseFiles(), (msg) => console.log(`[NoteCheck course] ${msg}`));
  }

  /** Markdown files inside the configured course folder (and its subfolders). */
  private courseFiles(): CourseFile[] {
    const folder = normalizePath(this.settings.courseFolder.trim());
    const prefix = folder === "/" ? "" : `${folder}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((f: TFile) => f.path.startsWith(prefix))
      .map((f: TFile) => ({ path: f.path, mtime: f.stat.mtime, read: () => this.app.vault.cachedRead(f) }));
  }

  /** An IndexStore backed by a JSON file in this plugin's folder. */
  private vaultStore(fileName: string): IndexStore {
    const adapter = this.app.vault.adapter;
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const path = normalizePath(`${dir}/${fileName}`);
    return {
      load: async () => {
        try {
          return (await adapter.exists(path)) ? JSON.parse(await adapter.read(path)) : null;
        } catch {
          return null; // a broken index file is rebuilt rather than blocking checks
        }
      },
      save: (data) => adapter.write(path, JSON.stringify(data)),
    };
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

  /** Show refuted claims from a selection check as inline suggestions in the note. */
  private showSelectionSuggestions(editor: Editor, cards: ClaimCard[], from: number, to: number): void {
    const cm = (editor as any).cm as EditorView | undefined;
    if (!cm) return;
    const doc = editor.getValue();
    const findings: Finding[] = [];
    for (const card of cards) {
      if (!card.source_span) continue;
      const { start, end } = card.source_span;
      if (doc.slice(start, end) !== card.original_text) continue; // the note changed while checking
      const f = findingFor(card, { text: card.original_text, from: start, to: end });
      if (f) findings.push(f);
    }
    showFindings(cm, from, to, findings);
  }

  /**
   * Apply a suggested fix from the results panel. Only the words that differ are changed
   * (see minimalEdit), so the user's own wording of the sentence is kept.
   */
  async applyFix(card: ClaimCard): Promise<void> {
    if (!card.source_span || !card.suggested_fix) return;

    // the sidebar has focus when its button is clicked, so fall back to the editor that was checked
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? this.lastCheckedEditor;
    if (!editor) {
      new Notice("NoteCheck: No editor to apply the fix to.");
      return;
    }

    const { start, end } = card.source_span;
    if (editor.getValue().slice(start, end) !== card.original_text) {
      new Notice("NoteCheck: The sentence has changed since it was checked. Check it again.");
      return;
    }

    const edit = minimalEdit(card.original_text, card.claim, card.suggested_fix);
    if (!edit) {
      await navigator.clipboard.writeText(card.suggested_fix);
      new Notice("NoteCheck: Could not place the fix word by word, so the suggested wording was copied.");
      return;
    }

    editor.replaceRange(edit.insert, editor.offsetToPos(start + edit.from), editor.offsetToPos(start + edit.to));
    new Notice("NoteCheck: Fix applied.");
  }
}
