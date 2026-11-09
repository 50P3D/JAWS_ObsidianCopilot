import { test } from "node:test";
import assert from "node:assert/strict";
import { checkableUnits, minimalEdit, type TextEdit } from "./liveText";

const apply = (s: string, e: TextEdit) => s.slice(0, e.from) + e.insert + s.slice(e.to);

test("minimalEdit changes only the wrong word", () => {
  const original = "The Treaty of Versailles was signed in 1920.";
  const e = minimalEdit(original, original, "The Treaty of Versailles was signed in 1919.")!;
  assert.deepEqual(e, { from: 39, to: 43, insert: "1919" });
  assert.equal(apply(original, e), "The Treaty of Versailles was signed in 1919.");
});

test("minimalEdit keeps the user's wording when the claim was rewritten to stand alone", () => {
  const original = "He was born in 1880 in Ulm.";
  const e = minimalEdit(original, "Albert Einstein was born in 1880.", "Albert Einstein was born in 1879.")!;
  assert.equal(apply(original, e), "He was born in 1879 in Ulm.");
});

test("minimalEdit handles a changed phrase", () => {
  const original = "Second normal form removes transitive dependencies.";
  const e = minimalEdit(original, original, "Third normal form removes transitive dependencies.")!;
  assert.equal(apply(original, e), "Third normal form removes transitive dependencies.");
});

test("minimalEdit keeps a capital letter the claim rewrite lowercased", () => {
  const original = "Second normal form removes transitive dependencies";
  const e = minimalEdit(original, "The second normal form removes transitive dependencies.", "The third normal form removes transitive dependencies.")!;
  assert.equal(apply(original, e), "Third normal form removes transitive dependencies");
});

test("minimalEdit handles an insertion", () => {
  const original = "Einstein was born in Ulm.";
  const e = minimalEdit(original, original, "Einstein was born in Ulm, Germany.")!;
  assert.equal(apply(original, e), "Einstein was born in Ulm, Germany.");
});

test("minimalEdit handles a deletion without leaving a double space", () => {
  const original = "The Eiffel Tower is in central Berlin.";
  const e = minimalEdit(original, original, "The Eiffel Tower is in Berlin.")!;
  assert.equal(apply(original, e), "The Eiffel Tower is in Berlin.");
});

test("minimalEdit matches case-insensitively and on whole words", () => {
  const original = "in 2019 the population of berlin was 3.6 million.";
  const e = minimalEdit(original, "In 2019 the population of Berlin was 3.6 million.", "In 2019 the population of Berlin was 3.7 million.")!;
  assert.equal(apply(original, e), "in 2019 the population of berlin was 3.7 million.");
});

test("minimalEdit replaces the whole sentence when the fix rewords it and the claim is the sentence", () => {
  const original = "The Treaty of Versailles was signed in 1920.";
  const fix = "Germany and the Allies signed it on 28 June 1919.";
  assert.deepEqual(minimalEdit(original, original, fix), { from: 0, to: original.length, insert: fix });
});

test("minimalEdit gives up rather than guess when the change cannot be placed", () => {
  const original = "He signed it that year.";
  assert.equal(minimalEdit(original, "Wilson signed the Treaty of Versailles in 1920.", "Wilson signed the Treaty of Versailles in 1919."), null);
});

test("minimalEdit returns null when the fix is the same as the claim", () => {
  assert.equal(minimalEdit("Paris is in France.", "Paris is in France.", "Paris is in France."), null);
});

test("checkableUnits returns finished sentences with document offsets", () => {
  const text = "Paris is the capital of France. Berlin is the capital of Germany.";
  const units = checkableUnits(text, 100, 1000);
  assert.deepEqual(units.map((u) => u.text), ["Paris is the capital of France.", "Berlin is the capital of Germany."]);
  assert.equal(units[1].from, 100 + text.indexOf("Berlin"));
  assert.equal(units[1].to, 100 + text.length);
});

test("checkableUnits skips the sentence still being typed", () => {
  const text = "Paris is the capital of France. Berlin is the capital of";
  const units = checkableUnits(text, 0, text.length);
  assert.deepEqual(units.map((u) => u.text), ["Paris is the capital of France."]);
});

test("checkableUnits checks a completed sentence while the cursor is inside it", () => {
  const text = "Paris is the capital of France. Berlin is the capital of Germany.";
  const cursor = text.indexOf("capital");
  assert.deepEqual(checkableUnits(text, 0, cursor).map((u) => u.text), [
    "Paris is the capital of France.",
    "Berlin is the capital of Germany.",
  ]);
});

test("checkableUnits keeps a bullet without a full stop once the cursor moves on", () => {
  const text = "- 2NF removes partial dependencies\n- 3NF removes transitive";
  const units = checkableUnits(text, 0, text.length);
  assert.deepEqual(units.map((u) => u.text), ["2NF removes partial dependencies"]);
  assert.equal(text.slice(units[0].from, units[0].to), "2NF removes partial dependencies");
});

test("checkableUnits skips headings, code blocks and short fragments", () => {
  const text = "## Dates\n```\nborn in 1879 in Ulm.\n```\nOk.\nThe Berlin Wall fell in 1989.";
  const units = checkableUnits(text, 0, -1);
  assert.deepEqual(units.map((u) => u.text), ["The Berlin Wall fell in 1989."]);
});
