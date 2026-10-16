/**
 * Scoring for the retrieval test set. Pure functions, so they are easy to test.
 *
 * Three questions per claim:
 *   page_hit_1   is the top passage from a page we expected?
 *   page_hit_3   is any of the top three passages from a page we expected?
 *   support_hit  does any of the top three passages contain the expected fact (for example "1919")?
 */

import type { Evidence } from "../contract/claimCard";

export interface TestClaim {
  claim: string;
  /** Any of these article titles counts as a correct page. */
  expected_pages: string[];
  /** Text that a good passage should contain, such as the true year. Case does not matter. */
  must_contain?: string;
  note?: string;
}

export interface ClaimResult {
  page_hit_1: boolean;
  page_hit_3: boolean;
  /** null when the test claim has no must_contain. */
  support_hit: boolean | null;
}

export interface Summary {
  count: number;
  page_at_1: number;
  page_at_3: number;
  support_at_3: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function scoreClaim(evidence: Evidence[], item: TestClaim): ClaimResult {
  const expected = new Set(item.expected_pages.map(norm));
  const top3 = evidence.slice(0, 3);
  const needle = item.must_contain ? norm(item.must_contain) : null;

  return {
    page_hit_1: evidence.length > 0 && expected.has(norm(evidence[0].page_title)),
    page_hit_3: top3.some((e) => expected.has(norm(e.page_title))),
    support_hit: needle === null ? null : top3.some((e) => norm(e.passage).includes(needle)),
  };
}

/** Percentages (0 to 100, one decimal) across many claims. */
export function summarise(results: ClaimResult[]): Summary {
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  const withSupport = results.filter((r) => r.support_hit !== null);
  return {
    count: results.length,
    page_at_1: pct(results.filter((r) => r.page_hit_1).length, results.length),
    page_at_3: pct(results.filter((r) => r.page_hit_3).length, results.length),
    support_at_3: pct(withSupport.filter((r) => r.support_hit).length, withSupport.length),
  };
}
