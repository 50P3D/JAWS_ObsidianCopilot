/**
 * Settings for retrieval. Change them with environment variables or via
 * configureRetrieval() at runtime (used by the plugin and orchestrator).
 */

const env = (globalThis as any).process?.env ?? {};

export const WIKI_API = "https://en.wikipedia.org/w/api.php";

/** Wikimedia asks every client to say who it is. Set NOTECHECK_CONTACT to your email or the repo URL. */
const DEFAULT_CONTACT = "https://github.com/50P3D/JAWS_ObsidianCopilot";

let _contact = env.NOTECHECK_CONTACT ?? DEFAULT_CONTACT;
export let USER_AGENT = `NoteCheck/0.1 (SE201 student project; ${_contact})`;

let _ollamaUrl = env.OLLAMA_URL ?? "http://localhost:11434";
export let OLLAMA_URL = _ollamaUrl;

let _embedModel = env.EMBED_MODEL ?? "nomic-embed-text";
export let EMBED_MODEL = _embedModel;

/**
 * Runtime configuration for retrieval. Called by the orchestrator at the
 * start of each fact-check run so plugin settings take effect.
 */
export function configureRetrieval(config: {
  ollamaUrl?: string;
  embedModel?: string;
  userAgent?: string;
  contact?: string;
}): void {
  if (config.ollamaUrl) OLLAMA_URL = config.ollamaUrl;
  if (config.embedModel) EMBED_MODEL = config.embedModel;
  if (config.userAgent) USER_AGENT = config.userAgent;
  if (config.contact) {
    _contact = config.contact;
    USER_AGENT = `NoteCheck/0.1 (SE201 student project; ${_contact})`;
  }
}

/** Reset all runtime config back to env/default values. Used by tests. */
export function resetRetrievalConfig(): void {
  _contact = env.NOTECHECK_CONTACT ?? DEFAULT_CONTACT;
  USER_AGENT = `NoteCheck/0.1 (SE201 student project; ${_contact})`;
  _ollamaUrl = env.OLLAMA_URL ?? "http://localhost:11434";
  OLLAMA_URL = _ollamaUrl;
  _embedModel = env.EMBED_MODEL ?? "nomic-embed-text";
  EMBED_MODEL = _embedModel;
}

/**
 * Title adjustments, so the main article beats lookalikes.
 * Example: for "The Treaty of Versailles was signed in 1920", the article called exactly
 * "Treaty of Versailles" gets a boost and "Treaty of Versailles (1756)" gets a penalty.
 * These numbers were chosen by eye on a few claims. Tune them on the test set.
 */
export const TITLE_MATCH_BOOST = 0.05;
export const TITLE_QUALIFIER_PENALTY = 0.03;

/** In hybrid mode: how much of the final score comes from meaning (embeddings) and how much from keywords. */
export const HYBRID_EMBEDDING_WEIGHT = 0.7;
export const HYBRID_KEYWORD_WEIGHT = 0.3;
