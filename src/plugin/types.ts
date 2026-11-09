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
   * Anthropic API key for the Claude review. Obsidian keeps plugin settings in plain text
   * in the vault's plugin data file, so anyone who can read that file can read the key.
   */
  claudeApiKey: string;

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

  /**
   * Vault folder holding course materials (lecture notes, readings), for example "Courses/SE201".
   * Claims are checked against these files before Wikipedia. Empty turns course checking off.
   */
  courseFolder: string;

  /** When true, only the course folder is used and Wikipedia is never searched. */
  courseOnly: boolean;

  /** When true, a short grey suggestion appears after the cursor as you type. Tab accepts it. */
  enableGhostText: boolean;

  /** Small Ollama model for ghost text. Kept separate so it can be much smaller than modelName. */
  ghostModel: string;

  /** Milliseconds to wait after typing stops before asking for a ghost suggestion. */
  ghostDebounceMs: number;
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
  claudeApiKey: "",
  enableLiveCheck: false,
  liveCheckDebounceMs: 1500,
  courseFolder: "",
  courseOnly: false,
  enableGhostText: false,
  ghostModel: "qwen3.5:2b",
  ghostDebounceMs: 400,
};
