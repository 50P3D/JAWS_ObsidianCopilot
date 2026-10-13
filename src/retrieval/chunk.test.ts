import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkArticle, splitSentences } from "./chunk";

const ARTICLE = [
  "The Treaty of Versailles was a peace treaty signed on 28 June 1919. It ended the state of war between Germany and the Allies.",
  "",
  "",
  "== Background ==",
  "Germany had asked for an armistice in November 1918. The war had lasted four years.",
  "",
  "A second paragraph in the same section follows here with enough words to count as a passage.",
  "",
  "== References ==",
  "Smith, J. (2001). A long list of citations that should never be returned as evidence.",
].join("\n");

test("every chunk is an exact slice of the article", () => {
  const chunks = chunkArticle(ARTICLE);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.equal(ARTICLE.slice(c.start, c.end), c.text);
  }
});

test("sections are tracked and the introduction is named", () => {
  const chunks = chunkArticle(ARTICLE);
  assert.equal(chunks[0].section, "Introduction");
  assert.ok(chunks.some((c) => c.section === "Background"));
});

test("reference sections are skipped", () => {
  const chunks = chunkArticle(ARTICLE);
  assert.ok(!chunks.some((c) => c.text.includes("citations")));
  assert.ok(!chunks.some((c) => c.section === "References"));
});

test("long paragraphs are split on sentence boundaries and nothing is lost", () => {
  const sentence = "This is one fairly ordinary sentence about history. ";
  const long = sentence.repeat(30).trim();
  const chunks = chunkArticle(long, { maxChars: 300 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.text.length <= 300 + sentence.length);
    assert.equal(long.slice(c.start, c.end), c.text);
  }
});

test("splitSentences keeps positions exact and handles abbreviations like U.S.", () => {
  const text = "The U.S. army arrived in 1917. It stayed until 1919.";
  const spans = splitSentences(text);
  assert.equal(spans.length, 2);
  assert.equal(text.slice(spans[0].start, spans[0].end), "The U.S. army arrived in 1917.");
  assert.equal(text.slice(spans[1].start, spans[1].end), "It stayed until 1919.");
});
