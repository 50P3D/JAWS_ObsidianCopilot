/**
 * Runs the red-team set through the real verifier (needs Ollama running).
 *
 *   npx tsx eval/redteam/run.ts --label baseline
 *   npx tsx eval/redteam/run.ts --label hardened --repeat 3
 *
 * Writes eval/redteam/results-<label>.json and prints one line per case.
 * Keep the same label for the same verifier version, so runs can be compared.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { verifyClaim } from "../../src/llm/verify";
import { parseArgs, flagNumber } from "../harness/cli";
import { scoreCase, summarise, type Outcome, type RedTeamCase } from "./score";

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const label = flags.label ?? "run";
  const repeat = flagNumber(flags, "repeat", 1);
  const cases: RedTeamCase[] = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));

  const rows: { c: RedTeamCase; outcome: Outcome; verdicts: string[] }[] = [];
  for (const c of cases) {
    const verdicts: string[] = [];
    let worst: Outcome = "held";
    for (let i = 0; i < repeat; i++) {
      let outcome: Outcome;
      try {
        const card = await verifyClaim({
          claim_id: c.id,
          original_text: c.claim,
          claim: c.claim,
          evidence: c.passages.map((passage, n) => ({
            passage,
            page_title: `Test page ${n + 1}`,
            revision_id: 1,
            url: "https://example.invalid/",
          })),
        } as any);
        verdicts.push(String(card.verdict));
        outcome = scoreCase(c, card);
      } catch {
        verdicts.push("error");
        outcome = "error";
      }
      // across repeats, keep the worst result: steered beats wrong beats error beats held
      const rank: Record<Outcome, number> = { held: 0, error: 1, wrong: 2, steered: 3 };
      if (rank[outcome] > rank[worst]) worst = outcome;
    }
    rows.push({ c, outcome: worst, verdicts });
    console.log(`${worst.padEnd(8)} ${c.id}  [${verdicts.join(", ")}]`);
  }

  const s = summarise(rows);
  console.log(`\nattacks steered: ${s.steered}/${s.attacks}  attacks answered wrongly: ${s.attackWrong}  controls held: ${s.controlsHeld}/${s.controls}  errors: ${s.errors}`);
  writeFileSync(new URL(`./results-${label}.json`, import.meta.url), JSON.stringify({ label, repeat, summary: s, rows: rows.map((r) => ({ id: r.c.id, outcome: r.outcome, verdicts: r.verdicts })) }, null, 2));
}

main();
