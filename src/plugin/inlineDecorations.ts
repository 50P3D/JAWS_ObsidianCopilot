/**
 * Inline suggestions in the editor, like tracked changes.
 *
 * A refuted claim gets a wavy underline. The wrong words are struck through and the suggested
 * words appear right after them, so "signed in ~~1920~~ 1919" reads at a glance. Clicking either
 * opens a card with the explanation, the evidence and Accept / Dismiss buttons.
 *
 * Obsidian's editor is CodeMirror 6, so this is a CM6 state field registered with
 * registerEditorExtension. The field maps every suggestion through each edit, so suggestions stay
 * on the right words while the user types elsewhere, and a suggestion is dropped as soon as its
 * own sentence is edited (the live checker then checks the new wording).
 */

import { StateEffect, StateField, type ChangeDesc, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { ClaimCard, Evidence } from "../contract/claimCard";
import { minimalEdit, type TextEdit, type Unit } from "./liveText";

/** One suggestion on screen. All positions are document offsets. */
export interface Finding {
  /** Sentence text plus claim, so the same suggestion keeps its id across re-renders. */
  id: string;
  /** The refuted text. */
  from: number;
  to: number;
  /** The whole sentence it sits in. Editing anywhere in it drops the suggestion. */
  unitFrom: number;
  unitTo: number;
  /** The inline change, or null when the fix could not be placed word by word. */
  edit: TextEdit | null;
  card: ClaimCard;
}

export interface SuggestionHandlers {
  /** After Accept. `newText` is the sentence as it reads after the edit. */
  onAccept(finding: Finding, newText: string): void;
  onDismiss(finding: Finding): void;
  openEvidence(evidence: Evidence): void;
}

let handlers: SuggestionHandlers | null = null;

export function setSuggestionHandlers(h: SuggestionHandlers | null): void {
  handlers = h;
}

/** The suggestion for one refuted card in a sentence, or null when the card is not refuted. */
export function findingFor(card: ClaimCard, unit: Unit): Finding | null {
  if (card.verdict !== "Refuted") return null;
  const original = card.original_text?.trim() ?? "";
  const at = original ? unit.text.indexOf(original) : -1;
  const from = at >= 0 ? unit.from + at : unit.from;
  const text = at >= 0 ? original : unit.text;
  const edit = card.suggested_fix ? minimalEdit(text, card.claim, card.suggested_fix) : null;
  return {
    id: `${unit.text}\u0000${card.claim}`,
    from,
    to: from + text.length,
    unitFrom: unit.from,
    unitTo: unit.to,
    edit: edit && { from: from + edit.from, to: from + edit.to, insert: edit.insert },
    card,
  };
}

// ── State ──────────────────────────────────────────────────────────

const replaceFindings = StateEffect.define<{ from: number; to: number; findings: Finding[] }>();
const removeFinding = StateEffect.define<string>();
const clearAll = StateEffect.define<null>();

function mapFinding(f: Finding, changes: ChangeDesc): Finding | null {
  let touched = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA < f.unitTo && toA > f.unitFrom) touched = true;
  });
  if (touched) return null;
  const m = (pos: number, assoc: number) => changes.mapPos(pos, assoc);
  return {
    ...f,
    from: m(f.from, 1),
    to: m(f.to, -1),
    unitFrom: m(f.unitFrom, 1),
    unitTo: m(f.unitTo, -1),
    edit: f.edit && { from: m(f.edit.from, 1), to: m(f.edit.to, -1), insert: f.edit.insert },
  };
}

const findingsField = StateField.define<Finding[]>({
  create: () => [],
  update(value, tr) {
    let out = tr.docChanged
      ? value.map((f) => mapFinding(f, tr.changes)).filter((f): f is Finding => f !== null)
      : value;
    for (const e of tr.effects) {
      if (e.is(replaceFindings)) {
        const { from, to, findings } = e.value;
        out = [...out.filter((f) => f.unitTo <= from || f.unitFrom >= to), ...findings];
      } else if (e.is(removeFinding)) {
        out = out.filter((f) => f.id !== e.value);
      } else if (e.is(clearAll)) {
        out = [];
      }
    }
    return out;
  },
  provide: (field) => EditorView.decorations.from(field, buildDecorations),
});

// ── Decorations ────────────────────────────────────────────────────

const removedMark = Decoration.mark({ class: "notecheck-live-remove" });

class SuggestionWidget extends WidgetType {
  constructor(readonly finding: Finding) {
    super();
  }

  eq(other: SuggestionWidget): boolean {
    return other.finding.id === this.finding.id && other.finding.edit?.insert === this.finding.edit?.insert;
  }

  toDOM(view: EditorView): HTMLElement {
    const { edit, id } = this.finding;
    const el = document.createElement("span");
    el.className = edit && edit.insert ? "notecheck-live-insert" : "notecheck-live-chip";
    el.textContent = edit ? edit.insert || "remove" : "check";
    el.setAttribute("aria-label", "NoteCheck suggestion, click to review");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep the cursor where it is
      e.stopPropagation();
      openPopover(view, id, el);
    });
    // the widget can sit inside the underline, whose click handler would open the popover again
    el.addEventListener("click", (e) => e.stopPropagation());
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(findings: Finding[]): DecorationSet {
  const ranges = [];
  for (const f of findings) {
    if (f.to > f.from) {
      ranges.push(
        Decoration.mark({ class: "notecheck-live-refuted", attributes: { "data-notecheck-id": f.id } }).range(f.from, f.to),
      );
    }
    if (f.edit && f.edit.to > f.edit.from) ranges.push(removedMark.range(f.edit.from, f.edit.to));
    const at = f.edit ? f.edit.to : f.to;
    ranges.push(Decoration.widget({ widget: new SuggestionWidget(f), side: 1 }).range(at));
  }
  return Decoration.set(ranges, true);
}

const clickHandler = EditorView.domEventHandlers({
  click(e, view) {
    const el = (e.target as HTMLElement).closest?.("[data-notecheck-id]") as HTMLElement | null;
    if (el?.dataset.notecheckId) openPopover(view, el.dataset.notecheckId, el);
    return false; // the click still places the cursor
  },
});

/** Register once with plugin.registerEditorExtension. */
export function liveSuggestionsExtension(): Extension {
  return [findingsField, clickHandler];
}

// ── Public API ─────────────────────────────────────────────────────

/** Replace the suggestions between `from` and `to` (the block just checked). Others stay. */
export function showFindings(view: EditorView, from: number, to: number, findings: Finding[]): void {
  view.dispatch({ effects: replaceFindings.of({ from, to, findings }) });
}

export function clearFindings(view: EditorView): void {
  view.dispatch({ effects: clearAll.of(null) });
}

export function countFindings(view: EditorView): number {
  return view.state.field(findingsField, false)?.length ?? 0;
}

/** Accept the suggestion in the sentence under the cursor. Returns false when there is none. */
export function acceptAtCursor(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const f = view.state.field(findingsField, false)?.find((x) => x.edit && pos >= x.unitFrom && pos <= x.unitTo);
  if (!f) return false;
  accept(view, f.id);
  return true;
}

function accept(view: EditorView, id: string): void {
  const f = view.state.field(findingsField).find((x) => x.id === id);
  if (!f?.edit) return;
  const doc = view.state.doc;
  const newText = doc.sliceString(f.unitFrom, f.edit.from) + f.edit.insert + doc.sliceString(f.edit.to, f.unitTo);
  view.dispatch({
    changes: { from: f.edit.from, to: f.edit.to, insert: f.edit.insert },
    effects: removeFinding.of(id),
    userEvent: "input.notecheck",
  });
  handlers?.onAccept(f, newText);
}

function dismiss(view: EditorView, id: string): void {
  const f = view.state.field(findingsField).find((x) => x.id === id);
  if (!f) return;
  view.dispatch({ effects: removeFinding.of(id) });
  handlers?.onDismiss(f);
}

// ── Popover ────────────────────────────────────────────────────────

let popover: HTMLElement | null = null;
let closeListeners: (() => void) | null = null;

function closePopover(): void {
  popover?.remove();
  popover = null;
  closeListeners?.();
  closeListeners = null;
}

function openPopover(view: EditorView, id: string, anchor: HTMLElement): void {
  closePopover();
  const f = view.state.field(findingsField).find((x) => x.id === id);
  if (!f) return;
  const { card, edit } = f;
  const ev = card.evidence?.[0];

  const el = document.createElement("div");
  el.className = "notecheck-live-popover";

  const head = el.createDiv({ cls: "notecheck-live-popover-head" });
  head.createSpan({ text: "Refuted", cls: "notecheck-verdict-badge notecheck-verdict-refuted" });
  if (ev) head.createSpan({ text: ev.source === "course" ? "by your course notes" : "by Wikipedia", cls: "notecheck-live-popover-source" });

  const change = el.createDiv({ cls: "notecheck-live-popover-change" });
  if (edit) {
    const old = view.state.doc.sliceString(edit.from, edit.to);
    if (old) change.createEl("del", { text: old });
    if (old && edit.insert) change.appendText(" → ");
    if (edit.insert) change.createEl("ins", { text: edit.insert });
  } else if (card.suggested_fix) {
    change.createSpan({ text: "Suggested wording: " });
    change.createEl("ins", { text: card.suggested_fix });
  }

  if (card.explanation) el.createEl("p", { text: card.explanation, cls: "notecheck-explanation" });

  if (ev) {
    const quote = ev.passage.length > 280 ? `${ev.passage.slice(0, 280)}…` : ev.passage;
    el.createEl("blockquote", { text: quote, cls: "notecheck-evidence-passage" });
    const link = el.createEl("a", {
      text: `${ev.page_title}${ev.section ? ` § ${ev.section}` : ""} →`,
      href: "#",
      cls: "notecheck-evidence-link",
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      handlers?.openEvidence(ev);
    });
  }

  const buttons = el.createDiv({ cls: "notecheck-live-popover-buttons" });
  if (edit) {
    const ok = buttons.createEl("button", { text: "Accept", cls: "mod-cta" });
    ok.addEventListener("click", () => {
      accept(view, id);
      closePopover();
      view.focus();
    });
  } else if (card.suggested_fix) {
    const copy = buttons.createEl("button", { text: "Copy wording" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(card.suggested_fix!);
      closePopover();
    });
  }
  const no = buttons.createEl("button", { text: "Dismiss" });
  no.addEventListener("click", () => {
    dismiss(view, id);
    closePopover();
    view.focus();
  });

  document.body.appendChild(el);
  const rect = anchor.getBoundingClientRect();
  el.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - el.offsetHeight - 8)}px`;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8))}px`;
  popover = el;

  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && e.target !== anchor) closePopover();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closePopover();
  };
  // registered on the next tick, so the click that opened the popover does not close it
  const timer = window.setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  closeListeners = () => {
    window.clearTimeout(timer);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}
