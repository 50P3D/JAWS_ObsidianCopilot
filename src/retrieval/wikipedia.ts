/**
 * Talking to the MediaWiki Action API: search for pages and fetch an article
 * together with the exact revision it came from.
 */

import { WIKI_API, USER_AGENT } from "./config";

export interface SearchHit {
  title: string;
  pageid: number;
  /** Short plain-text snippet from the search engine. */
  snippet: string;
}

export interface WikiPage {
  title: string;
  pageid: number;
  /** The exact version of the article. This is what makes a verdict reproducible. */
  revision_id: number;
  revision_timestamp: string;
  /** Link to that exact revision. */
  url: string;
  /** Plain text of the whole article. Section headings look like "== History ==". */
  text: string;
}

// Optional in-memory cache, off by default. A long-running plugin should not keep old articles forever.
// The evaluation script turns it on so repeated runs do not hit Wikipedia again.
let cacheOn = false;
const cache = new Map<string, Promise<any>>();

// Custom fetch function that can be overridden (e.g., for Obsidian's requestUrl)
let customFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

export function setCustomFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): void {
  customFetch = fn;
}

export function clearCustomFetch(): void {
  customFetch = null;
}

async function wikiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (customFetch) {
    return customFetch(url, init);
  }
  // Fallback to global fetch (for Node.js / tests)
  return fetch(url, init);
}

async function wikiGet(params: Record<string, string>): Promise<any> {
  const url = new URL(WIKI_API);
  const all: Record<string, string> = { format: "json", formatversion: "2", ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);

  const key = url.toString();
  if (cacheOn && cache.has(key)) return cache.get(key);

  const request = (async () => {
    const res = await wikiFetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Wikipedia API returned ${res.status} ${res.statusText}`);
    return res.json();
  })();

  if (cacheOn) {
    cache.set(key, request);
    request.catch(() => cache.delete(key));
  }
  return request;
}

/** Remove the <span> tags Wikipedia puts around matched words, and decode common entities. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export async function searchPages(query: string, limit = 3): Promise<SearchHit[]> {
  const data = await wikiGet({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    srprop: "snippet",
  });
  const hits: any[] = data?.query?.search ?? [];
  return hits.map((h) => ({ title: h.title, pageid: h.pageid, snippet: stripHtml(h.snippet ?? "") }));
}

/** Fetch the full article text and its revision in one call. Returns null if the page does not exist. */
export async function fetchPage(title: string): Promise<WikiPage | null> {
  const data = await wikiGet({
    action: "query",
    prop: "extracts|revisions",
    titles: title,
    redirects: "1",
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids|timestamp",
  });
  const page = data?.query?.pages?.[0];
  if (!page || page.missing) return null;

  const rev = page.revisions?.[0];
  const text: string = page.extract ?? "";
  if (!rev || !text) return null;

  const slug = encodeURIComponent(String(page.title).replace(/ /g, "_"));
  return {
    title: page.title,
    pageid: page.pageid,
    revision_id: rev.revid,
    revision_timestamp: rev.timestamp,
    url: `https://en.wikipedia.org/w/index.php?title=${slug}&oldid=${rev.revid}`,
    text,
  };
}

/**
 * Simple check for disambiguation pages ("Mercury may refer to: ...").
 * TODO (Aadhavan): replace with proper disambiguation handling. For now such pages are skipped.
 */
export function isDisambiguation(page: WikiPage): boolean {
  return /\bmay (also )?refer to\b/i.test(page.text.slice(0, 400));
}
