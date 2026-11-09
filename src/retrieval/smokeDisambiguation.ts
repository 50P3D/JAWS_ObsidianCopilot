/**
 * Live check of disambiguation against real Wikipedia (no Ollama needed).
 * Run with: npm run smoke:disambiguation
 *
 * For each claim, fetch the ambiguous page, read the meanings it links to and print the one chosen.
 */

import { chooseSenses } from "./disambiguate";
import { fetchPage, fetchSenses, isDisambiguation } from "./wikipedia";

const CASES: { page: string; claim: string; expect: string }[] = [
  { page: "Mercury", claim: "Mercury is the closest planet to the Sun.", expect: "Mercury (planet)" },
  { page: "Mercury", claim: "Mercury is a metal that is liquid at room temperature.", expect: "Mercury (element)" },
  { page: "Mercury", claim: "Mercury was the messenger of the gods in Roman religion.", expect: "Mercury (mythology)" },
  { page: "Apollo", claim: "Apollo was the Greek god of music and the sun.", expect: "Apollo" },
];

async function main(): Promise<void> {
  for (const c of CASES) {
    const page = await fetchPage(c.page);
    if (!page) {
      console.log(`${c.page}: page not found`);
      continue;
    }
    if (!isDisambiguation(page)) {
      console.log(`${c.page}: not a disambiguation page, nothing to choose (it is the article itself)`);
      continue;
    }
    const senses = await fetchSenses(c.page);
    const chosen = chooseSenses(c.claim, senses);
    const ok = chosen.includes(c.expect) ? "OK  " : "CHECK";
    console.log(`${ok} ${c.claim}\n      meanings found: ${senses.length}, chosen: ${chosen.join(", ") || "(none)"}, expected: ${c.expect}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
