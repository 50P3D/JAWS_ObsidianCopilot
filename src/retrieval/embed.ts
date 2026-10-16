/**
 * Turn text into embeddings (lists of numbers that capture meaning) using Ollama.
 * The model is nomic-embed-text. It works best when queries and documents carry a short prefix.
 */

import { OLLAMA_URL, EMBED_MODEL } from "./config";

const BATCH_SIZE = 32;

async function embedRaw(inputs: string[]): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/embed`, {
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

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => `search_document: ${t}`);
    out.push(...(await embedRaw(batch)));
  }
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
