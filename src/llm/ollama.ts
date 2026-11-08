// Helper for talking to local model through ollama
// In our case, qwen3.5 4b or 9b
export interface LlmOptions{
ollamaUrl?: string;
model?: string;
}
// The default Ollama URL and model can be overridden by environment variables
const env = (globalThis as any).process?.env ?? {};
export const DEFAULT_OLLAMA_URL = env.OLLAMA_URL ?? "http://localhost:11434"; // default ollama url
export const DEFAULT_MODEL = env.OLLAMA_MODEL ?? "qwen3.5:4b"; // default model

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

// Helper function to send a chat message to the Ollama API and get a JSON response
export async function chatJson<T>(system: string, user: string, schema: object, opts: LlmOptions = {}): 
Promise<T> {
    // url and model from opts or defaults
    const url = opts.ollamaUrl ?? DEFAULT_OLLAMA_URL;
    const model = opts.model ?? DEFAULT_MODEL;

    // Make a POST request to the Ollama API    
    let res: Response;
    // Fetch the response from Ollama
    try {
        res = await ollamaFetch(`${url}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                format: schema,  // specify the expected output format/schema
                stream: false, // we want the full response, not a stream
                think: false, // qwen3.5 thinks before answering by default, which can leave the JSON answer empty
                options: { temperature: 0}, // deterministic output
                keep_alive: "10m", // keep the model loaded in memory between calls, so later calls are fast
            }),
        });
    // If the fetch fails (e.g., network error), throw an error
    } catch {
        throw new Error (`Could not connect to Ollama at ${url}. Is the Ollama server running?`);
    }
    // If the response is not OK, throw an error with the status and a hint to pull the model
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama API request failed with status ${res.status}: ${body.slice (0, 200)} Did you run: ollama pull ${model} ?`);
    }
    // Parse the JSON response
    const data: any = await res.json();
    const text: string = data.message?.content ??  "";
    if (!text.trim()) {
        throw new Error(`Ollama returned an empty answer (done_reason: ${data.done_reason ?? "unknown"}).`);
    }
    try {
        return JSON.parse(text) as T;
    } catch{
        throw new Error(`Failed to parse JSON from Ollama response: ${text.slice(0, 200)}`);
    }
}