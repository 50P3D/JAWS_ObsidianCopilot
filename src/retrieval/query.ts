/**
 * Turn a claim into Wikipedia search queries.
 *
 * Wikipedia search needs every word to match, so a whole sentence often finds nothing.
 * We try short queries instead, best first:
 *
 *   1. Titles with a bracket written in the claim:  "Dreamer (2005 film)"
 *   2. The subject, everything before the main verb: "Dub music", "A View to a Kill"
 *   3. Named things:                                 "Treaty of Versailles"
 *   4. The main content words.
 *
 * retrieve.ts reads the articles from the first queries' hits first, so order matters.
 * 1 and 2 come first because they are the most specific. Without them, "Dub music is a
 * genre..." searched "Dub" and read "Rub-a-dub-dub", and "A View to a Kill is..." searched
 * "View" and "Kill".
 */

import { tokens } from "./score";

const CONNECTORS = new Set(["of", "the", "de", "von", "van", "and", "for", "la", "le", "da", "del"]);
const LEADING_NOISE = new Set(["the", "a", "an", "in", "on", "at", "of", "and", "but", "after", "before", "when"]);
/** Capitalised only because they start the sentence: "There were 3 million members in 1971." */
const SENTENCE_START_WORDS = new Set(["there", "here", "it", "this", "these", "those", "they", "he", "she", "we", "its"]);

/**
 * Words that usually end the subject of a claim. Only the common ones; a claim whose verb is
 * not here just gets no subject query.
 */
const SUBJECT_ENDS = new Set([
  "is", "are", "was", "were", "has", "have", "had", "became", "becomes", "remains", "remained",
  "will", "would", "can", "could", "may", "might", "must", "should", "does", "did", "do",
  "stars", "starred", "starring", "features", "featured", "plays", "played", "won", "wins",
  "began", "begins", "grew", "came", "comes", "served", "serves", "produces", "produced",
  "directed", "wrote", "written", "released", "received", "includes", "included", "contains",
  "lives", "lived", "died", "born", "founded", "landed", "made", "makes", "originated",
]);
const MAX_SUBJECT_WORDS = 6;

const WORD = /[\p{L}\p{N}'’.-]+/gu;
const isCapital = (w: string) => /^\p{Lu}/u.test(w);
// "Apollo 11", "Windows 95": a short number after a name belongs to it. Years do not ("March 2012").
const isShortNumber = (w: string) => /^\d{1,3}$/.test(w);

/** Groups of capitalised words, such as "Treaty of Versailles", "Marie Curie" or "Apollo 11". */
export function extractEntities(claim: string): string[] {
  const words = claim.match(WORD) ?? [];
  const groups: string[][] = [];
  let current: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.,;:]+$/, "");
    const next = words[i + 1];
    if (isCapital(w)) {
      current.push(w);
    } else if (current.length > 0 && isShortNumber(w)) {
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
    if (g.length === 1 && SENTENCE_START_WORDS.has(g[0].toLowerCase())) continue;
    const trimmed = [...g];
    while (trimmed.length > 0 && LEADING_NOISE.has(trimmed[0].toLowerCase())) trimmed.shift();
    while (trimmed.length > 0 && CONNECTORS.has(trimmed[trimmed.length - 1].toLowerCase())) trimmed.pop();
    // a group that is only a number after trimming ("The 100" -> "100") is too vague to search
    if (trimmed.length > 0 && !trimmed.every(isShortNumber)) entities.push(trimmed.join(" "));
  }
  return [...new Set(entities)];
}

/**
 * Wikipedia-style titles written in the claim: a name followed by a bracket,
 * "Dreamer (2005 film)" or "Mercury (planet)".
 */
export function bracketTitles(claim: string): string[] {
  const out: string[] = [];
  for (const m of claim.matchAll(/\(([^()]{1,40})\)/g)) {
    const before = claim.slice(0, m.index);
    // the capitalised name right before the bracket, connectors allowed inside ("Lord of the Rings")
    const name = /((?:\p{Lu}[\p{L}\p{N}'’.-]*)(?:\s+(?:(?:of|the|a|an|to|and|in|on|de|von|van|la|le|da|del)\s+)*[\p{Lu}\p{N}][\p{L}\p{N}'’.-]*)*)\s*$/u.exec(before);
    if (name) out.push(`${name[1]} (${m[1].trim()})`);
  }
  return [...new Set(out)];
}

/**
 * What the claim is about: the words before its main verb, when that is a short phrase that
 * starts with a capital. "Dub music is a genre..." -> "Dub music". Brackets are dropped
 * (bracketTitles handles them). Returns null when there is no clear subject.
 */
export function subjectPhrase(claim: string): string | null {
  const text = claim.replace(/\([^()]*\)/g, " ");
  const matches = [...text.matchAll(WORD)];
  const end = matches.findIndex((m) => SUBJECT_ENDS.has(m[0].toLowerCase()));
  if (end < 1 || end > MAX_SUBJECT_WORDS) return null;
  // an introductory clause ("In March of 2012, The Raven...") is not the subject
  if (/[,;:]/.test(text.slice(0, matches[end].index))) return null;
  const subject = matches.slice(0, end).map((m) => m[0].replace(/[.,;:]+$/, ""));
  if (!isCapital(subject[0])) return null;
  if (LEADING_NOISE.has(subject[0].toLowerCase()) && !/^(the|a|an)$/i.test(subject[0])) return null; // "In 1969 ..."
  if (subject.length === 1 && SENTENCE_START_WORDS.has(subject[0].toLowerCase())) return null;
  // "An example of a seaport is..." is not a name; "A View to a Kill" and "The 100" are
  if (/^(the|a|an)$/i.test(subject[0]) && !(subject[1] && (isCapital(subject[1]) || /^\d/.test(subject[1])))) return null;
  // "Fabian Nicieza's date of birth" is about Fabian Nicieza, which the entity query covers
  if (subject.some((w) => /['’]s?$|['’]s\b/.test(w))) return null;
  return subject.join(" ");
}

/** Search queries to try, best first. */
export function buildQueries(claim: string): string[] {
  const entities = extractEntities(claim);
  const queries: string[] = [...bracketTitles(claim)];

  const subject = subjectPhrase(claim);
  // skip the subject when it is just a named thing we already search for ("The Treaty of Versailles")
  const bare = (s: string) => s.toLowerCase().replace(/^(the|a|an)\s+/, "");
  if (subject && !entities.some((e) => bare(e) === bare(subject))) queries.push(subject);

  queries.push(...entities);
  const content = tokens(claim).slice(0, 8).join(" ");
  if (content) queries.push(content);

  // case-insensitive dedupe, keeping the first spelling
  const seen = new Set<string>();
  return queries.filter((q) => {
    const k = q.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
