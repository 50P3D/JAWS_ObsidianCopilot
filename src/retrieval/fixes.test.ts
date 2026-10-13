import { test } from "node:test";
import assert from "node:assert/strict";
import { titleAdjustment } from "./title";
import { contextAfter, contextBefore } from "./context";
import { TITLE_MATCH_BOOST, TITLE_QUALIFIER_PENALTY } from "./config";

const CLAIM = "The Treaty of Versailles was signed in 1920.";
const ENTITIES = ["Treaty of Versailles"];

test("exact title match gets a boost", () => {
  assert.equal(titleAdjustment("Treaty of Versailles", ENTITIES, CLAIM), TITLE_MATCH_BOOST);
});

test("same name with a bracket that the claim does not mention gets a penalty", () => {
  assert.equal(titleAdjustment("Treaty of Versailles (1756)", ENTITIES, CLAIM), -TITLE_QUALIFIER_PENALTY);
});

test("a different title is left alone", () => {
  assert.equal(titleAdjustment("Little Treaty of Versailles", ENTITIES, CLAIM), 0);
});

test("a bracket that the claim does mention is fine", () => {
  const claim = "Mercury is the closest planet to the Sun.";
  assert.equal(titleAdjustment("Mercury (planet)", ["Mercury"], claim), TITLE_MATCH_BOOST);
  assert.equal(titleAdjustment("Mercury (element)", ["Mercury"], claim), -TITLE_QUALIFIER_PENALTY);
});

test("context after stops at the next section heading", () => {
  const slice = "Some closing words.\n\n== References ==\nSmith, J. ISBN 123";
  assert.equal(contextAfter(slice, false), "Some closing words.");
});

test("context before starts after the last section heading", () => {
  const slice = "old text\n== History ==\nThe part that belongs to this section.";
  assert.equal(contextBefore(slice, false), "The part that belongs to this section.");
});

test("context does not start or end in the middle of a word", () => {
  assert.equal(contextBefore("ty text here", true), "text here");
  assert.equal(contextAfter("some text in the orbi", true), "some text in the");
});

test("context is kept whole when it was not cut from the middle", () => {
  assert.equal(contextBefore("whole text here", false), "whole text here");
  assert.equal(contextAfter("whole text here", false), "whole text here");
});
