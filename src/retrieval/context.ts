/**
 * Text shown around a passage in the source viewer.
 *
 * Context must never cross into another section (so reference lists do not leak in),
 * and must not start or end in the middle of a word.
 */

const tidy = (s: string) => s.replace(/\n{2,}/g, "\n").trim();

const isHeading = (line: string) => /^={2,6}.*={2,6}$/.test(line.trim());

/** `slice` is the text just before a passage. `startsMidText` is true if it was cut from the middle of the article. */
export function contextBefore(slice: string, startsMidText: boolean): string {
  let s = slice;
  if (startsMidText) {
    const i = s.search(/\s/);
    s = i >= 0 ? s.slice(i) : "";
  }
  const lines = s.split("\n");
  let last = -1;
  lines.forEach((l, i) => {
    if (isHeading(l)) last = i;
  });
  return tidy(lines.slice(last + 1).join("\n"));
}

/** `slice` is the text just after a passage. `endsMidText` is true if it was cut from the middle of the article. */
export function contextAfter(slice: string, endsMidText: boolean): string {
  let s = slice;
  if (endsMidText) {
    const i = s.search(/\s\S*$/);
    s = i >= 0 ? s.slice(0, i) : "";
  }
  const lines = s.split("\n");
  const idx = lines.findIndex(isHeading);
  return tidy((idx >= 0 ? lines.slice(0, idx) : lines).join("\n"));
}
