/**
 * Minimal Ollama chat client for the baselines. Uses the native /api/chat endpoint so we
 * can pass a JSON schema (`format`) and turn off thinking for reasoning models.
 */

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  /** "json" or a JSON schema object. */
  format?: "json" | Record<string, unknown>;
  /** false skips the reasoning trace on models that have one (qwen3.x). */
  think?: boolean;
  temperature?: number;
  seed?: number;
  /** Maximum tokens to generate. */
  numPredict?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  /** Tokens generated, if Ollama reported it. */
  evalCount?: number;
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
    keep_alive: "10m",
    options: {
      temperature: opts.temperature ?? 0,
      seed: opts.seed ?? 201,
      ...(opts.numPredict ? { num_predict: opts.numPredict } : {}),
    },
  };
  if (opts.format) body.format = opts.format;
  if (opts.think !== undefined) body.think = opts.think;

  const send = async (payload: Record<string, unknown>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
    try {
      return await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw new Error(`Ollama timed out after ${opts.timeoutMs ?? 120_000} ms`);
      throw new Error(`Could not reach Ollama at ${OLLAMA_URL}. Is it running?`);
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await send(body);
  // Models without a thinking mode reject the `think` field. Retry once without it.
  if (res.status === 400 && "think" in body) {
    const text = await res.text();
    if (/think/i.test(text)) {
      delete body.think;
      res = await send(body);
    } else {
      throw new Error(`Ollama chat failed (400): ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama chat failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return { content: String(data?.message?.content ?? ""), evalCount: data?.eval_count };
}

/** Returns a problem description, or null if the model is installed. */
export async function checkModel(model: string): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return `Ollama answered with status ${res.status}`;
    const data: any = await res.json();
    const names: string[] = (data.models ?? []).map((m: any) => String(m.name));
    const want = model.includes(":") ? model : `${model}:latest`;
    if (!names.includes(want) && !names.includes(model)) {
      return `Model ${model} is not installed in Ollama. Run: ollama pull ${model}`;
    }
    return null;
  } catch {
    return `Could not reach Ollama at ${OLLAMA_URL}. Is it running?`;
  }
}

/** "qwen3.5:9b" -> "qwen", "bespoke-minicheck" -> "bespoke-minicheck", "claude-sonnet-5" -> "claude". */
export function modelFamily(model: string): string {
  const base = model.toLowerCase().split("/").pop()!.split(":")[0];
  const known = ["qwen", "llama", "gemma", "mistral", "phi", "deepseek", "claude", "gpt"];
  return known.find((k) => base.startsWith(k)) ?? base;
}
