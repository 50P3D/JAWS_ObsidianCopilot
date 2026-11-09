/**
 * Which vault files count as course materials, and how PDF text is pulled out of them.
 *
 * Kept free of the "obsidian" import so it can be checked outside Obsidian.
 *
 * Owner: Medapati Williams Smith
 */

/** File types the course index reads. Obsidian stores the extension without the dot. */
export const COURSE_EXTENSIONS = ["md", "pdf"];

export function isCourseExtension(extension: string): boolean {
  return COURSE_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * Turn the "Course materials folder" setting into a vault-relative path in lower case.
 *
 * Accepts what people paste in practice: a vault folder ("Courses/SE201"), a single file
 * ("Courses/SE201/Lecture 1.pdf"), a path with backslashes or a leading "./" or "/", a path
 * wrapped in quotes (Windows "Copy as path"), and an absolute path inside the vault
 * ("D:\Vault\Courses\SE201") when the vault's base path is known.
 * Returns "" for the whole vault and null when the setting is empty.
 */
export function courseTarget(setting: string, vaultBasePath?: string): string | null {
  let p = setting.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!p) return null;
  p = slashes(p);

  if (vaultBasePath) {
    const base = slashes(vaultBasePath).replace(/\/+$/, "");
    if (base && (p.toLowerCase() === base.toLowerCase() || p.toLowerCase().startsWith(`${base.toLowerCase()}/`))) {
      p = p.slice(base.length);
    }
  }

  p = p
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  return p.toLowerCase();
}

/**
 * True when a vault path is the target file or sits inside the target folder.
 * Case-insensitive, because Windows and macOS file systems are, and the setting is typed by hand.
 */
export function inCourseTarget(path: string, target: string): boolean {
  if (target === "") return true;
  const p = path.toLowerCase();
  return p === target || p.startsWith(`${target}/`);
}

/** The part of `path` below the target folder, or "" when it is not inside it. */
export function relativeToTarget(path: string, target: string | null): string {
  if (!target) return ""; // off, or the whole vault, which has no course folder to name a topic after
  return path.toLowerCase().startsWith(`${target}/`) ? path.slice(target.length + 1) : "";
}

function slashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

/** The parts of pdf.js that pdfText uses. Obsidian's loadPdfJs() returns the full library. */
export interface PdfJs {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }> }>;
  destroy?(): Promise<void> | void;
}
interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

/**
 * The text of a PDF, one line per text line and a blank line between pages.
 * Scanned PDFs with no text layer come back empty, so they give no passages.
 */
export async function pdfText(data: ArrayBuffer, pdfjs: PdfJs): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue; // marked-content items carry no text
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push(text);
    }
    return pages.join("\n\n");
  } finally {
    await doc.destroy?.();
  }
}
