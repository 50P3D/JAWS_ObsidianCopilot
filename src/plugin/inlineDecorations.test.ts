import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ClaimCard } from "../contract/claimCard";
import { acceptAtCursor, countFindings, findingFor, liveSuggestionsExtension, setSuggestionHandlers, showFindings } from "./inlineDecorations";
import { checkableUnits } from "./liveText";

// Just enough of an EditorView for the state logic: the state and dispatch
function fakeView(doc: string, cursor = 0) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: liveSuggestionsExtension() }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as typeof view & EditorView;
}

const DOC = "Notes. The Treaty of Versailles was signed in 1920. Paris is in France.";
const card: ClaimCard = {
  claim_id: "c1",
  original_text: "The Treaty of Versailles was signed in 1920.",
  claim: "The Treaty of Versailles was signed in 1920.",
  verdict: "Refuted",
  suggested_fix: "The Treaty of Versailles was signed in 1919.",
};

function withSuggestion(cursor = 0) {
  const view = fakeView(DOC, cursor);
  const unit = checkableUnits(DOC, 0, -1).find((u) => u.text === card.original_text)!;
  showFindings(view, 0, DOC.length, [findingFor(card, unit)!]);
  return view;
}

test("findingFor places the edit on the wrong word only", () => {
  const unit = checkableUnits(DOC, 0, -1).find((u) => u.text === card.original_text)!;
  const f = findingFor(card, unit)!;
  assert.equal(DOC.slice(f.edit!.from, f.edit!.to), "1920");
  assert.equal(f.edit!.insert, "1919");
  assert.equal(findingFor({ ...card, verdict: "Supported" }, unit), null);
});

test("findingFor exposes a full rewritten suggestion when word matching is unsafe", () => {
  const original = "He signed it that year.";
  const unit = { text: original, from: 0, to: original.length };
  const f = findingFor(
    {
      ...card,
      original_text: original,
      claim: "Wilson signed the Treaty of Versailles in 1920.",
      suggested_fix: "Wilson signed the Treaty of Versailles in 1919.",
    },
    unit,
  )!;
  assert.deepEqual(f.edit, { from: 0, to: original.length, insert: "Wilson signed the Treaty of Versailles in 1919." });
});

test("accepting a suggestion edits only the wrong word and reports the new sentence", () => {
  let accepted = "";
  setSuggestionHandlers({ onAccept: (_f, text) => (accepted = text), onDismiss: () => {}, openEvidence: () => {} });
  const view = withSuggestion(DOC.indexOf("signed"));
  assert.equal(acceptAtCursor(view), true);
  assert.equal(view.state.doc.toString(), DOC.replace("1920", "1919"));
  assert.equal(accepted, "The Treaty of Versailles was signed in 1919.");
  assert.equal(countFindings(view), 0);
  setSuggestionHandlers(null);
});

test("a suggestion follows its words when text is typed before it", () => {
  const view = withSuggestion();
  view.dispatch({ changes: { from: 0, insert: "More notes here. " } });
  assert.equal(countFindings(view), 1);
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("signed") } });
  assert.equal(acceptAtCursor(view), true);
  assert.equal(view.state.doc.toString(), "More notes here. " + DOC.replace("1920", "1919"));
});

test("a suggestion survives typing right after its sentence", () => {
  const view = withSuggestion();
  const end = DOC.indexOf("1920.") + 5;
  view.dispatch({ changes: { from: end, insert: " Also" } });
  assert.equal(countFindings(view), 1);
});

test("editing the sentence itself drops its suggestion", () => {
  const view = withSuggestion();
  view.dispatch({ changes: { from: DOC.indexOf("signed"), to: DOC.indexOf("signed") + 6, insert: "ratified" } });
  assert.equal(countFindings(view), 0);
});

test("showFindings replaces suggestions only inside the checked block", () => {
  const view = withSuggestion();
  showFindings(view, DOC.indexOf("Paris"), DOC.length, []);
  assert.equal(countFindings(view), 1);
  showFindings(view, 0, DOC.length, []);
  assert.equal(countFindings(view), 0);
});

test("acceptAtCursor does nothing outside a suggested sentence", () => {
  const view = withSuggestion(DOC.indexOf("Paris"));
  assert.equal(acceptAtCursor(view), false);
  assert.equal(view.state.doc.toString(), DOC);
});
