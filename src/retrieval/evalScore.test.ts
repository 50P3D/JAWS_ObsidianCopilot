import { test } from "node:test";
import assert from "node:assert/strict";
import type { Evidence } from "../contract/claimCard";
import { scoreClaim, summarise, type TestClaim } from "./evalScore";

const ev = (title: string, passage: string): Evidence => ({
  passage,
  page_title: title,
  revision_id: 1,
  url: "https://example.org",
});

const ITEM: TestClaim = {
  claim: "The Treaty of Versailles was signed in 1920.",
  expected_pages: ["Treaty of Versailles"],
  must_contain: "1919",
};

test("a correct top result counts for page@1, page@3 and fact", () => {
  const r = scoreClaim([ev("Treaty of Versailles", "Signed on 28 June 1919.")], ITEM);
  assert.deepEqual(r, { page_hit_1: true, page_hit_3: true, support_hit: true });
});

test("a correct page lower down counts for page@3 only", () => {
  const r = scoreClaim(
    [ev("Little Treaty of Versailles", "x"), ev("Treaty of Versailles", "Signed 1919")],
    ITEM,
  );
  assert.equal(r.page_hit_1, false);
  assert.equal(r.page_hit_3, true);
});

test("title matching ignores case and spaces", () => {
  const r = scoreClaim([ev("  treaty of versailles ", "1919")], ITEM);
  assert.equal(r.page_hit_1, true);
});

test("a result beyond the top three does not count", () => {
  const r = scoreClaim(
    [ev("A", "x"), ev("B", "x"), ev("C", "x"), ev("Treaty of Versailles", "1919")],
    ITEM,
  );
  assert.equal(r.page_hit_3, false);
  assert.equal(r.support_hit, false);
});

test("no evidence is a clean miss", () => {
  const r = scoreClaim([], ITEM);
  assert.deepEqual(r, { page_hit_1: false, page_hit_3: false, support_hit: false });
});

test("a claim without must_contain has no fact score", () => {
  const r = scoreClaim([ev("Treaty of Versailles", "x")], { ...ITEM, must_contain: undefined });
  assert.equal(r.support_hit, null);
});

test("summarise gives percentages and ignores claims without a fact check for fact@3", () => {
  const s = summarise([
    { page_hit_1: true, page_hit_3: true, support_hit: true },
    { page_hit_1: false, page_hit_3: true, support_hit: false },
    { page_hit_1: false, page_hit_3: false, support_hit: null },
    { page_hit_1: true, page_hit_3: true, support_hit: true },
  ]);
  assert.deepEqual(s, { count: 4, page_at_1: 50, page_at_3: 75, support_at_3: 66.7 });
});
