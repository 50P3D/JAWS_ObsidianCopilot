import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueries, extractEntities } from "./query";
import { cosine, keywordScore, tokens } from "./score";
import { stripHtml } from "./wikipedia";

test("entities are pulled out with connecting words kept", () => {
  assert.deepEqual(extractEntities("The Treaty of Versailles was signed in 1920."), ["Treaty of Versailles"]);
  assert.deepEqual(extractEntities("Pluto was reclassified as a dwarf planet in 2006."), ["Pluto"]);
  assert.deepEqual(extractEntities("Marie Curie won two Nobel Prizes."), ["Marie Curie", "Nobel Prizes"]);
});

test("a claim with no capitalised words still gets a content query", () => {
  const q = buildQueries("water boils at 100 degrees");
  assert.equal(q.length, 1);
  assert.ok(q[0].includes("water"));
  assert.ok(q[0].includes("100"));
});

test("entity queries come before the content-words query", () => {
  const q = buildQueries("The Treaty of Versailles was signed in 1920.");
  assert.equal(q[0], "Treaty of Versailles");
  assert.ok(q.length >= 2);
});

test("stopwords are removed from tokens", () => {
  assert.deepEqual(tokens("The treaty was signed in 1919"), ["treaty", "signed", "1919"]);
});

test("keywordScore prefers the passage that shares more words", () => {
  const claim = "The Treaty of Versailles was signed in 1920.";
  const good = "The treaty was signed at Versailles on 28 June 1919.";
  const bad = "Rice is grown in warm wet climates.";
  assert.ok(keywordScore(claim, good) > keywordScore(claim, bad));
  assert.equal(keywordScore(claim, bad), 0);
});

test("a conflicting year still gets the year bonus", () => {
  const claim = "The treaty was signed in 1920.";
  const withYear = "The treaty was signed in 1919.";
  const noYear = "The treaty was signed in the summer.";
  assert.ok(keywordScore(claim, withYear) > keywordScore(claim, noYear));
});

test("cosine similarity", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("stripHtml removes search-match tags", () => {
  const raw = 'The <span class="searchmatch">Treaty</span> of Versailles &quot;ended&quot; the war &amp; more';
  assert.equal(stripHtml(raw), 'The Treaty of Versailles "ended" the war & more');
});
