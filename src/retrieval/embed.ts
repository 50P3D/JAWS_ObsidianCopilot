/**
 * Turn text into embeddings (lists of numbers that capture meaning) using Ollama.
 * The model is nomic-embed-text. It works best when queries and documents carry a short prefix.
 */

import { OLLAMA_URL, EMBED_MODEL } from "./config";

const BATCH_SIZE = 32;

// Custom fetch function that can be overridden (e.g., for Obsidian's requestUrl)
let customFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

export function setCustomFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): void {
  customFetch = fn;
}

export function clearCustomFetch(): void {
  customFetch = null;
}

async function ollamaFetch(url: string, init?: RequestInit): Promise<Response> {
  if (customFetch) {
    return customFetch(url, init);
  }
  // Fallback to global fetch (for Node.js / tests)
  return fetch(url, init);
}

async function embedRaw(inputs: string[]): Promise<number[][]> {
  let res: Response;
  try {
    res = await ollamaFetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keep_alive stops Ollama unloading the model between calls, which avoids the slow first request
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs, keep_alive: "10m" }),
    });
  } catch {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}. Is it running?`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embed failed (${res.status}): ${body.slice(0, 200)}. Did you run: ollama pull ${EMBED_MODEL} ?`);
  }
  const data: any = await res.json();
  return data.embeddings as number[][];
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedRaw([`search_query: ${text}`]);
  return v;
}

// Passage embeddings, so checking another claim against an article already read does not embed
// it again. Keyed by model and text. Least recently used entries go first once it is full.
const MAX_CACHED_VECTORS = 5000;
const vectorCache = new Map<string, number[]>();

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const keys = texts.map((t) => `${EMBED_MODEL}\u0000${t}`);
  const missing = [...new Set(keys.filter((k) => !vectorCache.has(k)))];

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const vectors = await embedRaw(batch.map((k) => `search_document: ${k.slice(k.indexOf("\u0000") + 1)}`));
    batch.forEach((k, j) => vectorCache.set(k, vectors[j]));
  }

  const out = keys.map((k) => {
    const v = vectorCache.get(k)!;
    vectorCache.delete(k); // move to the newest end
    vectorCache.set(k, v);
    return v;
  });
  while (vectorCache.size > MAX_CACHED_VECTORS) vectorCache.delete(vectorCache.keys().next().value!);
  return out;
}

/** Check Ollama is running and has the embedding model. Returns a problem description, or null if fine. */
export async function checkOllama(): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return `Ollama answered with status ${res.status}`;
    const data: any = await res.json();
    const names: string[] = (data.models ?? []).map((m: any) => String(m.name));
    if (!names.some((n) => n.startsWith(EMBED_MODEL))) {
      return `Model ${EMBED_MODEL} is not installed. Run: ollama pull ${EMBED_MODEL}`;
    }
    return null;
  } catch {
    return `Could not reach Ollama at ${OLLAMA_URL}. Is it running?`;
  }
}
