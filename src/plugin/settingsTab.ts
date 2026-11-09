/**
 * Settings tab for the NoteCheck plugin.
 *
 * Provides a UI in Obsidian's Settings → Community Plugins section where
 * users can configure the Ollama endpoint, model name, Wikimedia User-Agent,
 * and the optional Claude review toggle. Settings are persisted via
 * Obsidian's `saveData` / `loadData` mechanism.
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type NoteCheckPlugin from "./main.js";

export class NoteCheckSettingTab extends PluginSettingTab {
  plugin: NoteCheckPlugin;

  constructor(app: App, plugin: NoteCheckPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "NoteCheck Settings" });

    // ── Ollama URL ─────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Ollama URL")
      .setDesc(
        "Base URL for the Ollama REST API. The default (http://localhost:11434) " +
        "works if Ollama is running locally."
      )
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Model name ─────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Model name")
      .setDesc(
        "Which Ollama model to use for claim extraction and verification. " +
        "Must be already pulled (run `ollama pull <model>` first)."
      )
      .addText((text) =>
        text
          .setPlaceholder("qwen3.5:9b")
          .setValue(this.plugin.settings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.modelName = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Wikimedia User-Agent ───────────────────────────────────
    new Setting(containerEl)
      .setName("Wikimedia User-Agent")
      .setDesc(
        "Contact string sent with Wikipedia API requests. Wikimedia policy " +
        "requires a way to reach you if your traffic causes issues. " +
        "Format: AppName/Version (contact-email)"
      )
      .addText((text) =>
        text
          .setPlaceholder("NoteCheck/0.1.0 (you@example.com)")
          .setValue(this.plugin.settings.wikiUserAgent)
          .onChange(async (value) => {
            this.plugin.settings.wikiUserAgent = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Claude review toggle ───────────────────────────────────
    new Setting(containerEl)
      .setName("Enable Claude review")
      .setDesc(
        "Run an additional Claude-based review pass after the local LLM verdict. " +
        "This improves accuracy but requires an Anthropic API key and uses credits."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableClaudeReview)
          .onChange(async (value) => {
            this.plugin.settings.enableClaudeReview = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Live fact-checking toggle ────────────────────────────────
    new Setting(containerEl)
      .setName("Enable live fact-checking")
      .setDesc(
        "Automatically fact-check the current paragraph as you type. " +
        "Results appear as inline highlights in the editor. " +
        "Requires Ollama to be running."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableLiveCheck)
          .onChange(async (value) => {
            this.plugin.settings.enableLiveCheck = value;
            await this.plugin.saveSettings();
            // Notify plugin to start/stop live checker
            this.plugin.onLiveCheckSettingChange(value);
          })
      );

    // ── Live check debounce ──────────────────────────────────────
    new Setting(containerEl)
      .setName("Live check debounce (ms)")
      .setDesc(
        "Wait this many milliseconds after typing stops before running a live check. " +
        "Higher values reduce API calls but increase latency."
      )
      .addText((text) =>
        text
          .setPlaceholder("1500")
          .setValue(String(this.plugin.settings.liveCheckDebounceMs))
          .onChange(async (value) => {
            const ms = parseInt(value, 10);
            if (!isNaN(ms) && ms >= 200) {
              this.plugin.settings.liveCheckDebounceMs = ms;
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: "Course materials" });

    // ── Course folder ────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Course materials folder")
      .setDesc(
        "Vault folder with your lecture notes, slides (as markdown) and readings. " +
        "Claims are checked against these first, and Wikipedia is only used when " +
        "the course does not cover a claim. Leave empty to use Wikipedia only."
      )
      .addText((text) =>
        text
          .setPlaceholder("Courses/SE201")
          .setValue(this.plugin.settings.courseFolder)
          .onChange(async (value) => {
            this.plugin.settings.courseFolder = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Index now").onClick(async () => {
          if (!this.plugin.settings.courseFolder.trim()) {
            new Notice("NoteCheck: Set a course materials folder first.");
            return;
          }
          btn.setDisabled(true).setButtonText("Indexing…");
          try {
            const r = await this.plugin.syncCourseIndex();
            new Notice(`NoteCheck: Course index has ${r.passages} passages.`);
          } catch (err) {
            new Notice(`NoteCheck: Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            btn.setDisabled(false).setButtonText("Index now");
          }
        })
      );

    // ── Course only ──────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Course materials only")
      .setDesc(
        "Never search Wikipedia. Claims the course does not cover come back as Not Enough Info. " +
        "Faster, and nothing leaves your machine."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.courseOnly)
          .onChange(async (value) => {
            this.plugin.settings.courseOnly = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Ghost text" });

    // ── Ghost text toggle ────────────────────────────────────────
    new Setting(containerEl)
      .setName("Enable ghost text")
      .setDesc(
        "Show a short grey suggestion after the cursor when you pause after typing a space. " +
        "Press Tab to accept it or Esc to dismiss it. Uses a small local model through Ollama."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableGhostText)
          .onChange(async (value) => {
            this.plugin.settings.enableGhostText = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Ghost model ──────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Ghost text model")
      .setDesc(
        "A small, fast Ollama model, for example qwen3.5:2b. Run `ollama pull` for it first. " +
        "It is separate from the model used for fact-checking."
      )
      .addText((text) =>
        text
          .setPlaceholder("qwen3.5:2b")
          .setValue(this.plugin.settings.ghostModel)
          .onChange(async (value) => {
            this.plugin.settings.ghostModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Ghost debounce ───────────────────────────────────────────
    new Setting(containerEl)
      .setName("Ghost text delay (ms)")
      .setDesc("Wait this long after you stop typing before asking for a suggestion.")
      .addText((text) =>
        text
          .setPlaceholder("400")
          .setValue(String(this.plugin.settings.ghostDebounceMs))
          .onChange(async (value) => {
            const ms = parseInt(value, 10);
            if (!isNaN(ms) && ms >= 100) {
              this.plugin.settings.ghostDebounceMs = ms;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
