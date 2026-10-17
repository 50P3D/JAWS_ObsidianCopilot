import { test } from "node:test";
import assert from "node:assert/strict";
import { preprocess } from "./extract";

test("removes frontmatter", () => {
  assert.equal(preprocess("---\ntags: history\n---\nParis is in France."), "Paris is in France.");
});

test("removes frontmatter with Windows line endings", () => {
  assert.equal(preprocess("---\r\ntags: x\r\n---\r\nParis is in France."), "Paris is in France.");
});

test("replaces code blocks with a placeholder", () => {
  const out = preprocess("Python was released in 1991.\n```python\nprint('born in 1879')\n```");
  assert.equal(out, "Python was released in 1991.\n[code]");
});

test("replaces inline code with a placeholder", () => {
  assert.equal(preprocess("Use `print()` to show output."), "Use [code] to show output.");
});

test("replaces block maths with a placeholder", () => {
  assert.equal(preprocess("Euler's identity:\n$$e^{i\\pi} + 1 = 0$$"), "Euler's identity:\n[formula]");
});

test("replaces inline maths but keeps the sentence", () => {
  assert.equal(
    preprocess("The theorem says $a^2 + b^2 = c^2$ for right triangles."),
    "The theorem says [formula] for right triangles.",
  );
});

test("keeps wikilink text", () => {
  assert.equal(preprocess("[[Napoleon Bonaparte|Napoleon]] met [[Wellington]]."), "Napoleon met Wellington.");
});

test("keeps dollar amounts", () => {
  assert.equal(preprocess("The book cost $5 and the pen cost $10."), "The book cost $5 and the pen cost $10.");
});
