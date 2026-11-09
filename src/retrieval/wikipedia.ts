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
  /** True when this is a disambiguation page ("Mercury may refer to: ..."), not an article. */
  disambiguation?: boolean;
}

/** One meaning of an ambiguous name: the linked article's title and its short introduction. */
export interface Sense {
  title: string;
  intro: string;
}

const MAY_REFER_TO = /\bmay (also )?refer to\b/i;

// Optional in-memory cache, off by default. The evaluation script turns it on so repeated runs do
// not hit Wikipedia again. The plugin turns it on with a time limit, so a long-running session
// still picks up new revisions, and the size cap stops it keeping old articles forever.
let cacheOn = false;
let cacheTtlMs = Infinity;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { at: number; value: Promise<any> }>();

export function enableCache(opts: { ttlMs?: number } = {}): void {
  cacheOn = true;
  cacheTtlMs = opts.ttlMs ?? Infinity;
}

export function disableCache(): void {
  cacheOn = false;
  cache.clear();
}

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
  const hit = cacheOn ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.at < cacheTtlMs) return hit.value;

  const request = (async () => {
    const res = await wikiFetch(key, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Wikipedia API returned ${res.status} ${res.statusText}`);
    return res.json();
  })();

  if (cacheOn) {
    cache.delete(key); // re-insert so the Map's order stays oldest first
    cache.set(key, { at: Date.now(), value: request });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
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
    prop: "extracts|revisions|pageprops",
    ppprop: "disambiguation",
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
    disambiguation: page.pageprops?.disambiguation !== undefined || MAY_REFER_TO.test(text.slice(0, 400)),
  };
}

/**
 * Chooses which linked pages of a disambiguation page to read. Titles that start with the page's
 * own name followed by a bracket ("Mercury (planet)") are the real senses, so they go first;
 * the other links follow in the order Wikipedia gave them. Leaves out the page itself,
 * "(disambiguation)" pages and repeats.
 */
export function pickSenseTitles(name: string, links: string[], limit: number): string[] {
  const lower = name.toLowerCase();
  const seen = new Set<string>();
  const qualified: string[] = [];
  const rest: string[] = [];
  for (const link of links) {
    const key = link.toLowerCase();
    if (key === lower || key.includes("(disambiguation)") || seen.has(key)) continue;
    seen.add(key);
    (key.startsWith(`${lower} (`) ? qualified : rest).push(link);
  }
  return [...qualified, ...rest].slice(0, limit);
}

/**
 * Reads the senses listed on a disambiguation page: first the page's links, then the
 * introductions of the chosen ones (Wikipedia returns at most 20 introductions per request).
 * Pages that are missing, have no introduction or are disambiguation pages themselves (flagged, or
 * saying "may refer to" near the top) are left out.
 */
export async function fetchSenses(title: string, limit = 40): Promise<Sense[]> {
  const linkData = await wikiGet({
    action: "query",
    prop: "links",
    titles: title,
    plnamespace: "0",
    pllimit: "max",
    redirects: "1",
  });
  const linkPages: any[] = linkData?.query?.pages ?? [];
  const links: string[] = linkPages.flatMap((p) => (p.links ?? []).map((l: any) => String(l.title)));
  const titles = pickSenseTitles(title, links, limit);
  const batches: string[][] = [];
  for (let i = 0; i < titles.length; i += 20) batches.push(titles.slice(i, i + 20));
  const results = await Promise.all(
    batches.map((batch) =>
      wikiGet({
        action: "query",
        titles: batch.join("|"),
        prop: "extracts|pageprops",
        exintro: "1",
        explaintext: "1",
        exlimit: "max",
        ppprop: "disambiguation",
        redirects: "1",
      }),
    ),
  );
  const pages: any[] = results.flatMap((d) => d?.query?.pages ?? []);
  return pages
    .filter((p) => !p.missing && p.title !== title && p.pageprops?.disambiguation === undefined)
    .map((p) => ({ title: String(p.title), intro: String(p.extract ?? "").trim() }))
    .filter((p) => p.intro !== "" && !MAY_REFER_TO.test(p.intro.slice(0, 400)));
}

/**
 * True for a disambiguation page. Uses Wikipedia's own flag, and falls back to the words
 * "may refer to" near the top of the text when the flag is not there.
 */
export function isDisambiguation(page: WikiPage): boolean {
  return page.disambiguation ?? MAY_REFER_TO.test(page.text.slice(0, 400));
}
