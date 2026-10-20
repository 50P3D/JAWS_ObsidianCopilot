/**
 * Extract the current paragraph or section around the cursor position.
 *
 * Used by the live checker to fact-check only the relevant portion of the note
 * instead of the entire document.
 */

import { Editor } from "obsidian";

export interface ExtractedParagraph {
  /** The text content of the paragraph/section. */
  text: string;
  /** Character offset of the paragraph start in the full document. */
  startOffset: number;
  /** Character offset of the paragraph end in the full document. */
  endOffset: number;
  /** Line number where the paragraph starts (0-indexed). */
  startLine: number;
  /** Line number where the paragraph ends (0-indexed). */
  endLine: number;
  /** Headings above this paragraph for context. */
  headings: string[];
}

/**
 * Extract the paragraph containing the cursor position.
 *
 * A paragraph is defined as text separated by blank lines (two or more newlines).
 * If the cursor is on a blank line, returns the previous paragraph.
 *
 * @param editor The Obsidian editor instance.
 * @param cursorLine Optional line number (defaults to cursor position).
 * @returns Extracted paragraph with offsets and context headings.
 */
export function extractParagraphAtCursor(
  editor: Editor,
  cursorLine?: number
): ExtractedParagraph | null {
  const doc = editor.getValue();
  if (!doc.trim()) return null;

  const lines = doc.split("\n");
  const totalLines = lines.length;

  // Determine cursor line
  let line = cursorLine ?? editor.getCursor("from").line;
  line = Math.max(0, Math.min(line, totalLines - 1));

  // Find paragraph boundaries (blank lines = paragraph separators)
  let startLine = line;
  let endLine = line;

  // Scan backward for paragraph start
  while (startLine > 0) {
    const prevLine = lines[startLine - 1];
    if (prevLine.trim() === "") break; // Blank line = paragraph boundary
    startLine--;
  }

  // Scan forward for paragraph end
  while (endLine < totalLines - 1) {
    const nextLine = lines[endLine + 1];
    if (nextLine.trim() === "") break; // Blank line = paragraph boundary
    endLine++;
  }

  // Extract paragraph text
  const paragraphLines = lines.slice(startLine, endLine + 1);
  const text = paragraphLines.join("\n").trim();

  if (! text) return null;

  // Calculate character offsets
  let startOffset = 0;
  for (let i = 0; i < startLine; i++) {
    startOffset += lines[i].length + 1; // +1 for newline
  }

  let endOffset = startOffset;
  for (let i = startLine; i <= endLine; i++) {
    endOffset += lines[i].length + 1; // +1 for newline
  }
  // Adjust for last line not having trailing newline
  endOffset = Math.min(endOffset, doc.length);

  // Get headings above this paragraph
  const headings = extractHeadingsAbove(editor, startLine);

  return {
    text,
    startOffset,
    endOffset,
    startLine,
    endLine,
    headings,
  };
}

/**
 * Extract the section containing the cursor (bounded by headings).
 *
 * A section is the content between two headings of the same or higher level.
 * More inclusive than a paragraph - better for fact-checking context.
 *
 * @param editor The Obsidian editor instance.
 * @param cursorLine Optional line number (defaults to cursor position).
 * @returns Extracted section with offsets and context headings.
 */
export function extractSectionAtCursor(
  editor: Editor,
  cursorLine?: number
): ExtractedParagraph | null {
  const doc = editor.getValue();
  if (!doc.trim()) return null;

  const lines = doc.split("\n");
  const totalLines = lines.length;

  let line = cursorLine ?? editor.getCursor("from").line;
  line = Math.max(0, Math.min(line, totalLines - 1));

  // Find the heading level at or above the cursor line
  let currentHeadingLevel = 0;
  let sectionStartLine = 0;

  // Scan backward to find the heading that starts this section
  for (let i = line; i >= 0; i--) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (level <= currentHeadingLevel || currentHeadingLevel === 0) {
        currentHeadingLevel = level;
        sectionStartLine = i + 1; // Content starts after heading
      }
    }
  }

  // Scan forward to find the next heading of same or higher level
  let sectionEndLine = totalLines - 1;
  for (let i = line + 1; i < totalLines; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (level <= currentHeadingLevel) {
        sectionEndLine = i - 1;
        break;
      }
    }
  }

  // Extract section text
  const sectionLines = lines.slice(sectionStartLine, sectionEndLine + 1);
  const text = sectionLines.join("\n").trim();

  if (!text) return null;

  // Calculate character offsets
  let startOffset = 0;
  for (let i = 0; i < sectionStartLine; i++) {
    startOffset += lines[i].length + 1;
  }

  let endOffset = startOffset;
  for (let i = sectionStartLine; i <= sectionEndLine; i++) {
    endOffset += lines[i].length + 1;
  }
  endOffset = Math.min(endOffset, doc.length);

  // Get headings above this section (including the section's heading)
  const headings = extractHeadingsAbove(editor, sectionStartLine);

  return {
    text,
    startOffset,
    endOffset,
    startLine: sectionStartLine,
    endLine: sectionEndLine,
    headings,
  };
}

/**
 * Extract headings above a given line for decontextualization context.
 */
function extractHeadingsAbove(editor: Editor, line: number): string[] {
  const doc = editor.getValue();
  const lines = doc.split("\n");
  const headings: string[] = [];

  for (let i = 0; i < line; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push(match[2].trim());
    }
  }

  return headings;
}

/**
 * Get the note title from the active file.
 */
export function getNoteTitle(editor: Editor): string | undefined {
  const view = (editor as any).view as { file?: { basename?: string } } | undefined;
  if (view?.file?.basename) {
    return view.file.basename;
  }
  return undefined;
}

/**
 * Determine if a paragraph/section is worth fact-checking.
 *
 * Skips very short text, code blocks, math, frontmatter, etc.
 */
export function isCheckableText(text: string): boolean {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < 50) return false;

  // Only code/math placeholders
  if (/^(\[code\]|\[formula\]|\s)*$/.test(trimmed)) return false;

  // Frontmatter
  if (trimmed.startsWith("---") && trimmed.endsWith("---")) return false;

  // Only bullet points or list items without substantial content
  const lines = trimmed.split("\n");
  const contentLines = lines.filter((l) => l.trim() && !l.trim().startsWith("- ") && !l.trim().startsWith("* "));
  if (contentLines.length === 0) return false;

  return true;
}

/**
 * Smart extraction: tries section first, falls back to paragraph.
 * Returns the larger context that's still reasonably sized.
 */
export function extractSmartContext(
  editor: Editor,
  cursorLine?: number,
  maxChars: number = 3000
): ExtractedParagraph | null {
  // Try section first (more context)
  const section = extractSectionAtCursor(editor, cursorLine);
  if (section && section.text.length <= maxChars && isCheckableText(section.text)) {
    return section;
  }

  // Fall back to paragraph
  const paragraph = extractParagraphAtCursor(editor, cursorLine);
  if (paragraph && isCheckableText(paragraph.text)) {
    return paragraph;
  }

  // If section was too large but checkable, return truncated section
  if (section && isCheckableText(section.text)) {
    const truncatedText = section.text.substring(0, maxChars);
    return {
      ...section,
      text: truncatedText,
      endOffset: section.startOffset + truncatedText.length,
    };
  }

  return null;
}