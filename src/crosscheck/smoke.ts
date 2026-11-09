/**
 * Live check of the Claude cross-check. Needs a real key and makes up to 4 small API calls.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx src/crosscheck/smoke.ts
 *
 * Expect: card 1 agree, card 2 agree (the local verdict is Refuted and the evidence supports that),
 * card 3 disagree or unsure, card 4 skipped (personal language, no request made).
 */

import type { ClaimCard } from "../contract/claimCard";
import { crossCheck, privacyNote, reviewLabel } from "./crosscheck";

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY first.");
  process.exit(1);
}

function card(id: string, claim: string, verdict: ClaimCard["verdict"], passage: string): ClaimCard {
  return {
    claim_id: id,
    original_text: claim,
    claim,
    verdict,
    explanation: "",
    evidence: [{ passage, page_title: "Test page", revision_id: 1, url: "https://example.invalid/" }],
  } as ClaimCard;
}

const cards = [
  card("1", "The Treaty of Versailles was signed in 1919.", "Supported", "The Treaty of Versailles was signed on 28 June 1919 in the Hall of Mirrors. It ended the state of war between Germany and the Allies."),
  card("2", "The Eiffel Tower is in Berlin.", "Refuted", "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France."),
  card("3", "The Eiffel Tower is in Berlin.", "Supported", "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France."),
  card("4", "My friend Sam says the Treaty of Versailles was signed in 1919.", "Supported", "The Treaty of Versailles was signed on 28 June 1919 in the Hall of Mirrors."),
];

for (const c of cards) {
  const r = await crossCheck(c, { apiKey });
  console.log(`${c.claim_id}: ${r ? reviewLabel(r) : "no result"}${privacyNote(c) ? `  (${privacyNote(c)})` : ""}`);
}
