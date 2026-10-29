/**
 * Cut a markdown course file (lecture notes, readings) into passages of at most ~800 characters.
 *
 * Course notes are mostly headings and bullet lists, not prose, so each line is one unit.
 * Units are merged until the passage would get too long, and a heading always starts a new passage.
 * Lines longer than the limit are split into sentences.
 */

import { preprocess } from "../llm/extract";
import { splitSentences } from "../retrieval/chunk";

export interface CoursePassage {
  /** The nearest heading above the passage, or "" before the first heading. */
  section: string;
  text: string;
}

export interface CourseChunkOptions {
  maxChars?: number;
  /** Drop passages shorter than this, such as a lone "[code]" placeholder. */
  minChars?: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;

export function chunkMarkdown(markdown: string, opts: CourseChunkOptions = {}): CoursePassage[] {
  const maxChars = opts.maxChars ?? 800;
  const minChars = opts.minChars ?? 40;

  // embedded images and files carry no text, so drop them before preprocess turns ![[x.png]] into !x.png
  const text = preprocess(markdown.replace(/!\[\[[^\]]*\]\]/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, ""));

  const out: CoursePassage[] = [];
  let section = "";
  let parts: string[] = [];
  let size = 0;

  const emit = () => {
    const passage = parts.join("\n").trim();
    if (passage.length >= minChars) out.push({ section, text: passage });
    parts = [];
    size = 0;
  };
  const add = (unit: string) => {
    if (size > 0 && size + 1 + unit.length > maxChars) emit();
    size += (size > 0 ? 1 : 0) + unit.length;
    parts.push(unit);
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      emit();
      section = heading[2];
      continue;
    }
    if (!line) continue;
    if (line.length <= maxChars) add(line);
    else for (const s of splitSentences(line)) add(line.slice(s.start, s.end));
  }
  emit();
  return out;
}
