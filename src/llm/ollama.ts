// Helper for talking to a local model through Ollama.
export interface LlmOptions {
  ollamaUrl?: string;
  model?: string;
}

const env = (globalThis as any).process?.env ?? {};
export const DEFAULT_OLLAMA_URL = env.OLLAMA_URL ?? "http://localhost:11434";
export const DEFAULT_MODEL = env.OLLAMA_MODEL ?? "qwen3.5:4b";

let customFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

export function setCustomFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): void {
  customFetch = fn;
  responseCache.clear();
}

export function clearCustomFetch(): void {
  customFetch = null;
  responseCache.clear();
}

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

async function ollamaFetch(url: string, init?: RequestInit): Promise<Response> {
  return customFetch ? customFetch(url, init) : fetch(url, init);
}

function cacheKey(url: string, model: string, system: string, user: string, schema: object): string {
  return JSON.stringify([url, model, system, user, schema]);
}

export async function chatJson<T>(system: string, user: string, schema: object, opts: LlmOptions = {}): Promise<T> {
  const url = opts.ollamaUrl ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  const key = cacheKey(url, model, system, user, schema);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) responseCache.delete(key);
  const existing = inFlight.get(key);
  if (existing) return (await existing) as T;

  const request = (async (): Promise<T> => {
    let res: Response;
    try {
      res = await ollamaFetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          format: schema,
          stream: false,
          think: false,
          options: { temperature: 0 },
          keep_alive: "10m",
        }),
      });
    } catch {
      throw new Error(`Could not connect to Ollama at ${url}. Is the Ollama server running?`);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama API request failed with status ${res.status}: ${body.slice(0, 200)} Did you run: ollama pull ${model} ?`);
    }
    const data: any = await res.json();
    const text: string = data.message?.content ?? "";
    if (!text.trim()) {
      throw new Error(`Ollama returned an empty answer (done_reason: ${data.done_reason ?? "unknown"}).`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Failed to parse JSON from Ollama response: ${text.slice(0, 200)}`);
    }
  })();

  inFlight.set(key, request);
  try {
    const value = await request;
    responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    while (responseCache.size > MAX_CACHE_ENTRIES) responseCache.delete(responseCache.keys().next().value!);
    return value;
  } finally {
    inFlight.delete(key);
  }
}
