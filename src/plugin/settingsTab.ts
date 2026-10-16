/**
 * Settings tab for the NoteCheck plugin.
 *
 * Provides a UI in Obsidian's Settings → Community Plugins section where
 * users can configure the Ollama endpoint, model name, Wikimedia User-Agent,
 * and the optional Claude review toggle. Settings are persisted via
 * Obsidian's `saveData` / `loadData` mechanism.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
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
  }
}
