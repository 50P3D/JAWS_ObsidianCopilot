/**
 * Turn a claim into Wikipedia search queries.
 *
 * Wikipedia search needs every word to match, so a whole sentence often finds nothing.
 * We try short queries instead: named things first ("Treaty of Versailles"),
 * then the main content words.
 */

import { tokens } from "./score";

const CONNECTORS = new Set(["of", "the", "de", "von", "van", "and", "for", "la", "le", "da", "del"]);
const LEADING_NOISE = new Set(["the", "a", "an", "in", "on", "at", "of", "and", "but", "after", "before", "when"]);

/** Groups of capitalised words, such as "Treaty of Versailles" or "Marie Curie". */
export function extractEntities(claim: string): string[] {
  const words = claim.match(/[\p{L}\p{N}'’.-]+/gu) ?? [];
  const groups: string[][] = [];
  let current: string[] = [];

  const isCapital = (w: string) => /^\p{Lu}/u.test(w);

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.,;:]+$/, "");
    const next = words[i + 1];
    if (isCapital(w)) {
      current.push(w);
    } else if (current.length > 0 && CONNECTORS.has(w.toLowerCase()) && next && isCapital(next)) {
      current.push(w);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  const entities: string[] = [];
  for (const g of groups) {
    const trimmed = [...g];
    while (trimmed.length > 0 && LEADING_NOISE.has(trimmed[0].toLowerCase())) trimmed.shift();
    while (trimmed.length > 0 && CONNECTORS.has(trimmed[trimmed.length - 1].toLowerCase())) trimmed.pop();
    if (trimmed.length > 0) entities.push(trimmed.join(" "));
  }
  return [...new Set(entities)];
}

/** Search queries to try, best first. */
export function buildQueries(claim: string): string[] {
  const queries: string[] = [];
  queries.push(...extractEntities(claim));
  const content = tokens(claim).slice(0, 8).join(" ");
  if (content) queries.push(content);
  return [...new Set(queries)];
}
