/**
 * Citation coverage signal (pure, Requirement 4).
 *
 * Coverage is the share of prose paragraphs in a revision's wikitext that contain at least one
 * citation (`<ref`, `{{sfn` or `{{harvnb` markup). Headings, lists, tables, templates, file,
 * image and category links, comments and short paragraphs are not prose and are ignored.
 */

import { unavailable, type CitationSignal, type Unavailable } from "./types";

/** Paragraphs shorter than this (after trimming) are not counted as prose. */
export const MIN_PROSE_CHARS = 200;

/**
 * Paragraph openings that mark a block as non-prose: headings (`=`), lists (`*`, `#`, `:`, `;`),
 * tables (`{|`, `|`, `!`), templates (`{{`), file, image and category links, and comments.
 * Namespace prefixes are matched without regard to case.
 */
const NON_PROSE_START = /^(?:=|\*|#|:|;|\{\||\||!|\{\{|\[\[\s*(?:file|image|category)\s*:|<!--)/i;

/** A `<ref` opening (`<ref>`, `<ref name=...>`, `<ref name=x />`), not `</ref>` or `<references`. */
const REF_OPEN = /<ref(?=[\s>/])/gi;

/** Citation markup that makes a paragraph count as cited. */
const CITATION = /<ref(?=[\s>/])|\{\{\s*sfn|\{\{\s*harvnb/i;

/** Splits wikitext on blank lines and keeps only the prose paragraphs (trimmed). */
export function proseParagraphs(wikitext: string): string[] {
  return wikitext
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_PROSE_CHARS && !NON_PROSE_START.test(p));
}

/** Citation coverage over the prose paragraphs, or Unavailable when there are none. */
export function citationCoverage(wikitext: string): CitationSignal | Unavailable {
  const prose = proseParagraphs(wikitext);
  if (prose.length === 0) return unavailable("no prose paragraphs");
  const cited = prose.filter((p) => CITATION.test(p)).length;
  const refCount = wikitext.match(REF_OPEN)?.length ?? 0;
  return { coverage: cited / prose.length, prose: prose.length, cited, refCount };
}
