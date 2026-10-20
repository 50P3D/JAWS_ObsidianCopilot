/**
 * Plugin-specific type definitions for NoteCheck.
 *
 * These types configure how the plugin talks to the local Ollama instance
 * and the Wikipedia API. They are separate from the shared ClaimCard contract
 * because they only matter inside the Obsidian plugin layer.
 */

/**
 * User-configurable settings stored by Obsidian's `loadData` / `saveData`.
 */
export interface NoteCheckSettings {
  /** Base URL for the Ollama REST API. */
  ollamaUrl: string;

  /** Which Ollama model to use for claim extraction and verification. */
  modelName: string;

  /**
   * User-Agent string sent with Wikimedia API requests.
   * Wikimedia asks for a contact email so they can reach out if our
   * traffic causes problems. Empty means the default will be used.
   * @see https://meta.wikimedia.org/wiki/User-Agent_policy
   */
  wikiUserAgent: string;

  /**
   * When true, a Claude-based review pass runs after the local LLM verdict.
   * This is an optional quality gate — it costs API credits.
   */
  enableClaudeReview: boolean;

  /**
   * When true, NoteCheck runs fact-checking automatically as you type.
   * Checks the current paragraph/section on each change (debounced).
   */
  enableLiveCheck: boolean;

  /**
   * Milliseconds to wait after typing stops before running a live check.
   * Higher values reduce API calls but increase latency.
   */
  liveCheckDebounceMs: number;
}

/**
 * Sensible defaults for a first-time user.
 * Ollama's default port is 11434; qwen3.5:9b is the project's baseline model.
 */
export const DEFAULT_SETTINGS: NoteCheckSettings = {
  ollamaUrl: "http://localhost:11434",
  modelName: "qwen3.5:9b",
  wikiUserAgent: "",
  enableClaudeReview: false,
  enableLiveCheck: false,
  liveCheckDebounceMs: 1500,
};
