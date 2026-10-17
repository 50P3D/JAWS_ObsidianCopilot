import { readFileSync } from "node:fs";
import type { ClaimCard, Evidence } from "../contract/claimCard";
import { DEFAULT_MODEL } from "./ollama";
import { verifyClaim } from "./verify";

const ev = (passage: string, page_title: string): Evidence => ({
  passage, page_title, revision_id: 0, url: "https://en.wikipedia.org/w/index.php?oldid=0",
});

const cases: { name: string; expected: string; card: ClaimCard }[] = [];

// the three shared example cards, with their answers removed
for (const f of ["supported", "refuted", "not-enough-info"]) {
  const full: ClaimCard = JSON.parse(readFileSync(new URL(`../contract/examples/${f}.json`, import.meta.url), "utf8"));
  const { verdict, explanation, suggested_fix, ...input } = full;
  cases.push({ name: `example: ${f}`, expected: verdict ?? "?", card: input });
}

// harder cases
cases.push({
  name: "paraphrase", expected: "Supported",
  card: { claim_id: "x1", original_text: "", claim: "Water boils at 100 degrees Celsius at sea level.",
    evidence: [ev("At standard atmospheric pressure, the boiling point of water is 100 °C (212 °F).", "Water")] },
});
cases.push({
  name: "off-topic evidence", expected: "Not Enough Info",
  card: { claim_id: "x2", original_text: "", claim: "Marie Curie won two Nobel Prizes.",
    evidence: [ev("Pierre Curie was a French physicist, born in Paris in 1859.", "Pierre Curie")] },
});

let correct = 0;
for (const c of cases) {
  const out = await verifyClaim(c.card);
  const ok = out.verdict === c.expected;
  if (ok) correct++;
  console.log(`\n=== ${c.name} ${ok ? "PASS" : "FAIL"}\nexpected: ${c.expected}  got: ${out.verdict}`);
  console.log(`  why: ${out.explanation}`);
  if (out.suggested_fix) console.log(`  fix: ${out.suggested_fix}`);
}
console.log(`\n${correct}/${cases.length} correct on ${process.env.OLLAMA_MODEL ?? DEFAULT_MODEL}`);