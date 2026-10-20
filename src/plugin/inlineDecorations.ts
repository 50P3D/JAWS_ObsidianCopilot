/**
 * Inline decorations for NoteCheck fact-check results.
 *
 * Uses Obsidian's Editor.markText and Editor.setGutterMarker APIs
 * which work with the underlying CodeMirror instance.
 */

import { Editor, EditorRange } from "obsidian";
import type { ClaimCard } from "../contract/claimCard";

/** Unique class prefix for NoteCheck decorations. */
const NOTECHECK_DECO_CLASS = "notecheck-inline";

/** Decoration type for the red background highlight on refuted text. */
const HIGHLIGHT_CLASS = `${NOTECHECK_DECO_CLASS}-highlight`;

/** Gutter name for NoteCheck markers. */
const GUTTER_NAME = "notecheck-gutter";

/** Data stored on each decoration for click handling. */
interface DecorationData {
  claimId: string;
  card: ClaimCard;
  startOffset: number;
  endOffset: number;
  highlightRef?: any;  // markText return value
  gutterRef?: any;     // setGutterMarker return value
}

/** Map from editor to its active NoteCheck decorations. */
const editorDecorations = new WeakMap<Editor, Map<string, DecorationData>>();

/**
 * Apply inline highlights and gutter markers for refuted claims.
 *
 * @param editor The Obsidian editor instance.
 * @param cards Claim cards from the fact-check pipeline (only Refuted ones are highlighted).
 * @param plugin Plugin instance (for apply fix).
 */
export function applyInlineHighlights(
  editor: Editor,
  cards: ClaimCard[],
  _plugin: any
): void {
  // Clear existing highlights for this editor
  clearInlineHighlights(editor);

  const refutedCards = cards.filter((c) => c.verdict === "Refuted" && c.source_span);
  if (refutedCards.length === 0) return;

  const decorationMap = new Map<string, DecorationData>();

  for (const card of refutedCards) {
    const span = card.source_span!;
    // Convert character offsets to editor positions
    const startPos = editor.offsetToPos(span.start);
    const endPos = editor.offsetToPos(span.end);

    // Create a range for the highlight
    const range: EditorRange = { from: startPos, to: endPos };

    // Add highlight decoration (red background) using Obsidian's markText
    const highlightRef = (editor as any).markText?.(range.from, range.to, {
      className: HIGHLIGHT_CLASS,
      inclusiveLeft: false,
      inclusiveRight: false,
    });

    // Add gutter marker using Obsidian's setGutterMarker
    const gutterRef = (editor as any).setGutterMarker?.(range.from.line, GUTTER_NAME, createGutterElement(card));

    // Store decoration data for cleanup
    const decoId = `${card.claim_id}-${span.start}-${span.end}`;
    decorationMap.set(decoId, {
      claimId: card.claim_id,
      card,
      startOffset: span.start,
      endOffset: span.end,
      highlightRef,
      gutterRef,
    });
  }

  editorDecorations.set(editor, decorationMap);
}

/**
 * Create the gutter marker element for a refuted claim.
 */
function createGutterElement(card: ClaimCard): HTMLElement {
  const el = document.createElement("div");
  el.className = `${NOTECHECK_DECO_CLASS}-gutter-marker`;
  el.setAttribute("aria-label", `NoteCheck: ${card.explanation || "Refuted claim"}`);
  el.title = "Click for details";

  // Red dot indicator
  const dot = el.createEl("div", { cls: `${NOTECHECK_DECO_CLASS}-gutter-dot` });
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff1744;
    margin: 2px auto;
    box-shadow: 0 0 4px rgba(255, 23, 68, 0.6);
  `;

  // Click handler - show popover with details
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    showClaimPopover(el, card);
  });

  return el;
}

/**
 * Show a popover with claim details when gutter marker is clicked.
 */
function showClaimPopover(anchor: HTMLElement, card: ClaimCard): void {
  // Remove any existing popover
  const existing = document.querySelector(`.${NOTECHECK_DECO_CLASS}-popover`);
  existing?.remove();

  const popover = document.createElement("div");
  popover.className = `${NOTECHECK_DECO_CLASS}-popover`;
  popover.style.cssText = `
    position: fixed;
    z-index: 1000;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    max-width: 360px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    font-size: 0.85em;
    line-height: 1.5;
  `;

  // Verdict badge
  const badge = popover.createEl("span", {
    text: "Refuted",
    cls: "notecheck-verdict-badge notecheck-verdict-refuted",
  });
  badge.style.marginBottom = "8px";

  // Explanation
  if (card.explanation) {
    popover.createEl("p", {
      text: card.explanation,
      cls: "notecheck-explanation",
    });
  }

  // Suggested fix
  if (card.suggested_fix) {
    const fixEl = popover.createEl("div", { cls: "notecheck-suggested-fix" });
    fixEl.createEl("strong", { text: "Suggested fix: " });
    fixEl.createEl("span", { text: card.suggested_fix });
  }

  // Evidence summary
  if (card.evidence && card.evidence.length > 0) {
    const ev = card.evidence[0];
    const evidenceEl = popover.createEl("details", { cls: "notecheck-evidence-section" });
    evidenceEl.createEl("summary", { text: `Evidence: ${ev.page_title}` });
    evidenceEl.createEl("blockquote", {
      text: ev.passage.substring(0, 300) + (ev.passage.length > 300 ? "..." : ""),
      cls: "notecheck-evidence-passage",
    });
    const link = evidenceEl.createEl("a", {
      text: "View on Wikipedia →",
      href: ev.url,
      cls: "notecheck-evidence-link",
    });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener noreferrer");
  }

  // Apply fix button
  if (card.suggested_fix && card.source_span) {
    const btn = popover.createEl("button", {
      text: "Apply fix",
      cls: "notecheck-apply-fix-btn",
    });
    btn.style.marginTop = "8px";
    btn.addEventListener("click", () => {
      applyFixInEditor(card);
      popover.remove();
    });
  }

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && e.target !== anchor) {
      popover.remove();
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler), 0);

  // Position popover near the gutter marker
  const rect = anchor.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${rect.right + 8}px`;

  document.body.appendChild(popover);
}

/**
 * Apply the suggested fix to the editor.
 */
function applyFixInEditor(card: ClaimCard): void {
  if (!card.source_span || !card.suggested_fix) return;

  const view = document.querySelector(".markdown-source-view.is-active") as HTMLElement;
  if (!view) return;

  const editor = (view as any).editor as Editor | undefined;
  if (!editor) return;

  const { start, end } = card.source_span;
  const startPos = editor.offsetToPos(start);
  const endPos = editor.offsetToPos(end);

  editor.replaceRange(card.suggested_fix, startPos, endPos);
}

/**
 * Remove all NoteCheck inline highlights from an editor.
 */
export function clearInlineHighlights(editor: Editor): void {
  const decorations = editorDecorations.get(editor);
  if (!decorations) return;

  for (const [, data] of decorations) {
    // Clear highlight
    if (data.highlightRef && typeof data.highlightRef.clear === "function") {
      try { data.highlightRef.clear(); } catch { }
    }
    // Clear gutter marker
    if (data.gutterRef && typeof data.gutterRef.clear === "function") {
      try { data.gutterRef.clear(); } catch { }
    }
  }

  decorations.clear();
  editorDecorations.delete(editor);
}

/**
 * Get all active decorations for an editor (for debugging/inspection).
 */
export function getActiveDecorations(editor: Editor): DecorationData[] {
  const decorations = editorDecorations.get(editor);
  return decorations ? Array.from(decorations.values()) : [];
}

/**
 * Update highlights when the editor content changes.
 * Re-positions highlights based on stored character offsets.
 */
export function updateHighlightsForEditorChange(editor: Editor): void {
  const decorations = editorDecorations.get(editor);
  if (!decorations || decorations.size === 0) return;

  for (const [decoId, data] of decorations) {
    try {
      // Verify the text at the stored offset still matches
      const currentText = editor.getRange(
        editor.offsetToPos(data.startOffset),
        editor.offsetToPos(data.endOffset)
      );
      if (currentText !== data.card.original_text) {
        // Text changed - mark for re-check
        data.card.source_span = undefined;
      }
    } catch {
      // Position invalid - will be cleaned up on next full check
    }
  }
}