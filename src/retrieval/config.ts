/**
 * Settings for retrieval. Change them with environment variables, not by editing this file.
 */

export const WIKI_API = "https://en.wikipedia.org/w/api.php";

/** Wikimedia asks every client to say who it is. Set NOTECHECK_CONTACT to your email or the repo URL. */
const CONTACT = process.env.NOTECHECK_CONTACT ?? "https://github.com/50P3D/JAWS_ObsidianCopilot";
export const USER_AGENT = `NoteCheck/0.1 (SE201 student project; ${CONTACT})`;

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

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
