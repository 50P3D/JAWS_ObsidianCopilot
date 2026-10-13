/**
 * Cut an article into passages of roughly one paragraph each.
 *
 * Every passage remembers where it sits in the article (start and end positions)
 * and which section it is under. The source viewer needs that later.
 */

export interface Chunk {
  /** Exactly article.slice(start, end). */
  text: string;
  section: string;
  start: number;
  end: number;
}

export interface Span {
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Aim for passages at most this long. A single very long sentence can still exceed it. */
  maxChars?: number;
  /** Drop passages shorter than this. */
  minChars?: number;
}

/** Sections that never hold facts we want to cite. */
const SKIP_SECTIONS = new Set([
  "references", "see also", "external links", "notes", "further reading",
  "bibliography", "citations", "footnotes", "sources",
]);

const HEADING = /^(={2,6})\s*(.+?)\s*\1\s*$/;

/** Split text into sentences. Positions are relative to `text`, shifted by `base`. */
export function splitSentences(text: string, base = 0): Span[] {
  const spans: Span[] = [];
  const re = /[.!?]+["')\]]*\s+(?=[\p{Lu}\p{N}"'(\[])/gu;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].trimEnd().length;
    spans.push({ start: base + start, end: base + end });
    start = m.index + m[0].length;
  }
  if (start < text.length) spans.push({ start: base + start, end: base + text.length });
  return spans;
}

export function chunkArticle(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 800;
  const minChars = opts.minChars ?? 40;

  const chunks: Chunk[] = [];
  let section = "Introduction";
  let skipping = false;
  let units: Span[] = [];
  let paraStart = -1;
  let paraEnd = -1;

  const closeParagraph = () => {
    if (paraStart < 0) return;
    if (paraEnd - paraStart <= maxChars) {
      units.push({ start: paraStart, end: paraEnd });
    } else {
      units.push(...splitSentences(text.slice(paraStart, paraEnd), paraStart));
    }
    paraStart = -1;
    paraEnd = -1;
  };

  const flush = () => {
    let cur: Span | null = null;
    const emit = () => {
      if (cur && cur.end - cur.start >= minChars) {
        chunks.push({ text: text.slice(cur.start, cur.end), section, start: cur.start, end: cur.end });
      }
    };
    for (const u of units) {
      if (cur && u.end - cur.start > maxChars) {
        emit();
        cur = { start: u.start, end: u.end };
      } else if (cur) {
        cur.end = u.end;
      } else {
        cur = { start: u.start, end: u.end };
      }
    }
    emit();
    units = [];
  };

  let offset = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();

    const heading = HEADING.exec(trimmed);
    if (heading) {
      closeParagraph();
      flush();
      section = heading[2];
      skipping = SKIP_SECTIONS.has(section.toLowerCase());
      continue;
    }
    if (trimmed === "") {
      closeParagraph();
      continue;
    }
    if (skipping) continue;

    const s = lineStart + (line.length - line.trimStart().length);
    if (paraStart < 0) paraStart = s;
    paraEnd = s + trimmed.length;
  }
  closeParagraph();
  flush();

  return chunks;
}
