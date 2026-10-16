/**
 * Adjust a passage's score based on how well its article title matches what the claim is about.
 *
 *   "Treaty of Versailles"         exactly matches a named thing in the claim    -> boost
 *   "Treaty of Versailles (1756)"  same name, but the bracket is not in the claim -> penalty
 *   "Mercury (planet)"             same name, and "planet" is in the claim        -> boost
 *   "Little Treaty of Versailles"  different title                                -> no change
 *
 * Known weakness: "Mercury (planet)" is penalised if the claim never says "planet".
 */

import { TITLE_MATCH_BOOST, TITLE_QUALIFIER_PENALTY } from "./config";

export function titleAdjustment(title: string, entities: string[], claim: string): number {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(title);
  const base = (m ? m[1] : title).trim().toLowerCase();
  const qualifier = m ? m[2].trim().toLowerCase() : null;

  const nameMatches = entities.some((e) => e.toLowerCase() === base);
  if (!nameMatches) return 0;

  if (qualifier === null) return TITLE_MATCH_BOOST;
  return claim.toLowerCase().includes(qualifier) ? TITLE_MATCH_BOOST : -TITLE_QUALIFIER_PENALTY;
}
