/**
 * Small JSON client for Wikimedia requests made by the reliability scorer.
 * Every request carries the project User-Agent, has its own timeout and goes through an
 * in-process cache that keeps only successful responses (Requirements 7.1, 7.2, 7.4, 7.5).
 */

import { REQUEST_TIMEOUT_MS, USER_AGENT } from "./config";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** Injected fetch, for tests. Defaults to the global fetch. */
  fetch?: FetchLike;
  /** Abort the request after this many milliseconds. Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Custom fetch function that can be overridden (e.g., for Obsidian's requestUrl) */
let customFetch: FetchLike | null = null;

export function setCustomFetch(fn: FetchLike): void {
  customFetch = fn;
}

export function clearCustomFetch(): void {
  customFetch = null;
}

function getFetchFn(opts?: HttpOptions): FetchLike {
  return opts?.fetch ?? customFetch ?? ((u, init) => fetch(u, init));
}

/** Keyed by method, URL and body. Rejected promises are removed, so only successes stay. */
const cache = new Map<string, Promise<any>>();

/** Empties the response cache. Tests call this between runs. */
export function clearCache(): void {
  cache.clear();
}

export async function getJson(url: URL | string, opts: HttpOptions = {}): Promise<any> {
  return cached("GET", String(url), undefined, opts);
}

export async function postJson(url: URL | string, body: unknown, opts: HttpOptions = {}): Promise<any> {
  return cached("POST", String(url), JSON.stringify(body), opts);
}

function cached(method: "GET" | "POST", url: string, body: string | undefined, opts: HttpOptions): Promise<any> {
  const key = `${method} ${url} ${body ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const promise = request(method, url, body, opts);
  cache.set(key, promise);
  promise.catch(() => {
    // Only drop our own entry; clearCache() may have replaced it in the meantime.
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

async function request(
  method: "GET" | "POST",
  url: string,
  body: string | undefined,
  opts: HttpOptions,
): Promise<any> {
  const fetchFn: FetchLike = getFetchFn(opts);
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutMessage = `timeout after ${timeoutMs} ms`;

  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (method === "POST") headers["Content-Type"] = "application/json";

  const signal = AbortSignal.timeout(timeoutMs);

  // Node unrefs the AbortSignal.timeout timer, so a fetch that only waits on the signal could let
  // the process exit before the abort fires. This ref'd timer keeps the loop alive and also enforces
  // the deadline if a fetch ignores the signal.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  const run = async (): Promise<any> => {
    const res = await fetchFn(url, { method, headers, body, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trimEnd());
    return res.json();
  };

  try {
    return await Promise.race([run(), deadline]);
  } catch (err) {
    if (signal.aborted || isAbortError(err)) throw new Error(timeoutMessage);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
