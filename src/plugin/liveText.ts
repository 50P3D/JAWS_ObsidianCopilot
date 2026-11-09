/**
 * Text helpers for live checking. No Obsidian imports, so they can be unit tested.
 *
 *   checkableUnits  split a block of the note into sentences worth checking, with document offsets
 *   minimalEdit     turn a suggested fix into the smallest edit of the user's own sentence
 */

import { splitSentences } from "../retrieval/chunk";

/** One sentence (or bullet) of the note, with its position in the document. */
export interface Unit {
  text: string;
  from: number;
  to: number;
}

/** A replacement inside some text: text.slice(from, to) becomes insert. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?|\s*>\s*)/;
const MIN_UNIT_CHARS = 15;

/**
 * Sentences of `text` (which starts at document offset `base`) that are finished, so worth checking.
 * A sentence is finished when it ends in . ! or ?, or when the cursor is on another line (a bullet
 * without a full stop is finished once you move on). Headings, code blocks and very short bits are skipped.
 */
export function checkableUnits(text: string, base: number, cursor: number): Unit[] {
  const units: Unit[] = [];
  let inFence = false;
  let lineStart = 0;

  for (const line of text.split("\n")) {
    const start = lineStart;
    lineStart += line.length + 1;

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*#{1,6}\s/.test(line) || !line.trim()) continue;

    const marker = LIST_MARKER.exec(line)?.[0].length ?? 0;
    const content = line.slice(marker);
    const contentStart = base + start + marker;
    const cursorOnLine = cursor >= base + start && cursor <= base + start + line.length;

    for (const s of splitSentences(content)) {
      const raw = content.slice(s.start, s.end);
      const lead = raw.length - raw.trimStart().length;
      const sentence = raw.trim();
      if (sentence.length < MIN_UNIT_CHARS || !/\p{L}/u.test(sentence)) continue;

      const from = contentStart + s.start + lead;
      const to = from + sentence.length;
      const finished = /[.!?]["')\]]*$/.test(sentence) || !cursorOnLine;
      // A completed sentence can be checked even while the cursor is still inside it. Only
      // unfinished text is deferred, otherwise typing the final full stop never triggers a check.
      if (!finished) continue;
      units.push({ text: sentence, from, to });
    }
  }
  return units;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function words(s: string): Word[] {
  const out: Word[] = [];
  for (const m of s.matchAll(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu)) {
    out.push({ text: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Position of `needle` in `hay` as whole words, case-sensitive first. -1 if absent. */
function findWords(hay: string, needle: string): number {
  const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (const [h, n] of [[hay, needle], [hay.toLowerCase(), needle.toLowerCase()]]) {
    for (let at = h.indexOf(n); at >= 0; at = h.indexOf(n, at + 1)) {
      if (!isWordChar(h[at - 1]) && !isWordChar(h[at + n.length])) return at;
    }
  }
  return -1;
}

const MAX_CHANGED_WORDS = 6;

// The fix is written against the rewritten claim, where the word may sit mid-sentence
// ("The second normal form..."), so "Second" in the user's note would otherwise become "third".
function matchCase(replacedFirstChar: string, insert: string): string {
  const upper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
  return upper(replacedFirstChar) && !upper(insert[0]) ? insert[0].toUpperCase() + insert.slice(1) : insert;
}

/**
 * The smallest edit of `original` (the user's sentence) that applies `fix`.
 *
 * The verifier writes its fix against `claim`, the rewritten stand-alone version of the sentence
 * ("He was born in 1880" became "Albert Einstein was born in 1880"). Pasting the fix over the
 * user's sentence would also undo that rewrite, so instead the words that differ between claim and
 * fix are found and only those are changed in the original: "1880" becomes "1879".
 *
 * Returns null when the change cannot be placed safely, for example when the fix rewords the
 * whole sentence. The suggestion is then shown without an inline edit.
 */
export function minimalEdit(original: string, claim: string, fix: string): TextEdit | null {
  const a = words(claim);
  const b = words(fix);

  let p = 0;
  while (p < a.length && p < b.length && a[p].text === b[p].text) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s].text === b[b.length - 1 - s].text) s++;

  const removed = a.slice(p, a.length - s);
  const added = b.slice(p, b.length - s);
  if (removed.length === 0 && added.length === 0) return null; // nothing to change

  if (removed.length > 0 && removed.length <= MAX_CHANGED_WORDS && added.length <= MAX_CHANGED_WORDS) {
    const oldText = claim.slice(removed[0].start, removed[removed.length - 1].end);
    const at = findWords(original, oldText);
    if (at >= 0) {
      if (added.length > 0) {
        return { from: at, to: at + oldText.length, insert: matchCase(original[at], fix.slice(added[0].start, added[added.length - 1].end)) };
      }
      // a pure deletion also takes one neighbouring space, so no double space is left behind
      const end = at + oldText.length;
      return original[end] === " " ? { from: at, to: end + 1, insert: "" } : { from: Math.max(0, at - 1), to: end, insert: "" };
    }
  }

  if (removed.length === 0 && p > 0 && added.length <= MAX_CHANGED_WORDS) {
    // a pure insertion ("in Ulm" becomes "in Ulm, Germany"): anchor on the word before it
    const anchor = a[p - 1];
    const at = findWords(original, claim.slice(anchor.start, anchor.end));
    if (at >= 0) {
      const pos = at + (anchor.end - anchor.start);
      return { from: pos, to: pos, insert: fix.slice(b[p - 1].end, added[added.length - 1].end) };
    }
  }

  // the claim was not rewritten, so replacing the whole sentence loses nothing
  if (original.trim() === claim.trim()) return { from: 0, to: original.length, insert: fix };
  return null;
}
