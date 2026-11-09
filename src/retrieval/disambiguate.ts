/**
 * Disambiguation: when a search lands on a page like "Mercury may refer to: ...", pick the
 * meaning the claim is about instead of dropping the page.
 *
 * "Mercury is the closest planet to the Sun"  ->  Mercury (planet)
 * "Mercury is liquid at room temperature"     ->  Mercury (element)
 *
 * The choice is by word overlap between the claim and each meaning's title and introduction, with a
 * bonus when the claim names the bracketed qualifier. When two meanings score almost the same,
 * both are kept so the verifier can see both. When none fits, none is kept rather than guessing.
 */

import { keywordScore } from "./score";
import { isDisambiguation, type Sense, type WikiPage } from "./wikipedia";

export type { Sense } from "./wikipedia";

/** Added to a meaning's score when the claim contains the word in its brackets, as in "(planet)". */
const QUALIFIER_BONUS = 0.3;

export interface ChooseOptions {
  /** Most meanings to keep. */
  max?: number;
  /** A meaning must score at least this much to be kept (the score is mostly 0 to 1). */
  minScore?: number;
  /** A second meaning is kept only when it is within this much of the best. */
  margin?: number;
}

export function rankSenses(claim: string, senses: Sense[]): { title: string; score: number }[] {
  const lower = claim.toLowerCase();
  return senses
    .map((s) => {
      const qualifier = /\(([^)]+)\)\s*$/.exec(s.title)?.[1].trim().toLowerCase();
      const bonus = qualifier && lower.includes(qualifier) ? QUALIFIER_BONUS : 0;
      return { title: s.title, score: keywordScore(claim, `${s.title} ${s.intro}`) + bonus };
    })
    .sort((a, b) => b.score - a.score);
}

/** Titles of the meanings that fit the claim, best first. Empty when none fits. */
export function chooseSenses(claim: string, senses: Sense[], opts: ChooseOptions = {}): string[] {
  const max = opts.max ?? 2;
  const minScore = opts.minScore ?? 0.25;
  const margin = opts.margin ?? 0.1;
  const ranked = rankSenses(claim, senses);
  if (ranked.length === 0 || ranked[0].score < minScore) return [];
  const best = ranked[0].score;
  return ranked
    .filter((r) => r.score >= minScore && best - r.score <= margin)
    .slice(0, max)
    .map((r) => r.title);
}

export interface SenseDeps {
  fetchSenses(title: string): Promise<Sense[]>;
  fetchPage(title: string): Promise<WikiPage | null>;
}

/**
 * Go through fetched pages. Ordinary pages stay. A disambiguation page is replaced, in the same
 * position, by the article for the meaning the claim is about. A page already in the list is not
 * repeated, a meaning that cannot be fetched is skipped, and a failed lookup of the meanings drops
 * that page only, so retrieval carries on with the rest.
 */
export async function expandDisambiguations(
  claim: string,
  pages: (WikiPage | null)[],
  deps: SenseDeps,
  opts: ChooseOptions = {},
): Promise<WikiPage[]> {
  const out: WikiPage[] = [];
  const seen = new Set<number>();
  const add = (p: WikiPage | null) => {
    if (p && !isDisambiguation(p) && !seen.has(p.pageid)) {
      seen.add(p.pageid);
      out.push(p);
    }
  };

  for (const p of pages) {
    if (!p) continue;
    if (!isDisambiguation(p)) {
      add(p);
      continue;
    }
    try {
      const titles = chooseSenses(claim, await deps.fetchSenses(p.title), opts);
      // one meaning that cannot be fetched is skipped; the others are still used
      const fetched = await Promise.all(titles.map((t) => deps.fetchPage(t).catch(() => null)));
      fetched.forEach(add);
    } catch {
      // a failed lookup drops this page only
    }
  }
  return out;
}
