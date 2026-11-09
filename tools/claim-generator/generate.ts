/**
 * Claim generator: turn true Wikipedia facts into believable false claims for the eval set.
 *
 * Reads tools/claim-generator/seeds.jsonl (one true fact per line, with the Wikipedia page
 * that states it), asks Claude to rewrite each fact as one plausible falsehood, and writes
 * eval/datasets/generated.jsonl in the harness format (source "generated", label "Refuted").
 *
 * Claude (not Qwen) writes the claims, so the system under test never marks its own family's
 * test data. Every item starts with human_checked: false. A teammate spot-checks them.
 *
 * Setup (once): npm i -D @anthropic-ai/sdk, and set ANTHROPIC_API_KEY.
 *
 * Usage (from the repo root):
 *   npx tsx tools/claim-generator/generate.ts
 *   npx tsx tools/claim-generator/generate.ts --with-originals   # also emit each true fact as Supported
 *   npx tsx tools/claim-generator/generate.ts --out eval/datasets/generated-v2.jsonl --model claude-opus-5-5
 *
 * Split: items 1, 3, 6, 8, 11, 13, ... (position % 5 is 1 or 3) go to dev, the rest to test.
 * With 50 seeds that is 20 dev and 30 test. A true/false pair always shares a split.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, flagBool } from "../../eval/harness/cli";
import { parseDataset } from "../../eval/harness/dataset";
import type { EvalItem } from "../../eval/harness/types";

interface Seed {
  id: string;
  fact: string;
  page: string;
}

interface Rewrite {
  claim: string;
  mutation: "date" | "number" | "place" | "entity" | "attribute";
  rationale: string;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const SYSTEM = `You build test data for a fact-checking system that checks claims against Wikipedia.
You get one true fact and the Wikipedia article that states it. Rewrite it as ONE false claim that:
- changes exactly one detail (a date, a number, a place, a person or thing, or an attribute) and keeps everything else;
- is believable: the wrong value should be one a student might really write (a nearby year, a neighbouring country, a related person), not an absurd one;
- is clearly and checkably false from that Wikipedia article, not merely unverifiable or debatable;
- is a single declarative sentence that stands alone, with no negation and no hedging.
In rationale, give the correct value and say in one sentence why the claim is false.`;

const SCHEMA = {
  type: "object",
  properties: {
    claim: { type: "string" },
    mutation: { type: "string", enum: ["date", "number", "place", "entity", "attribute"] },
    rationale: { type: "string" },
  },
  required: ["claim", "mutation", "rationale"],
  additionalProperties: false,
} as const;

function parseSeeds(text: string): Seed[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l, i) => {
      const s = JSON.parse(l);
      if (!s.id || !s.fact || !s.page) throw new Error(`seed line ${i + 1}: needs id, fact and page`);
      return s as Seed;
    });
}

async function rewrite(client: Anthropic, model: string, seed: Seed): Promise<Rewrite> {
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Wikipedia article: ${seed.page}\nTrue fact: ${seed.fact}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  if (response.stop_reason === "refusal") throw new Error(`${seed.id}: model declined`);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`${seed.id}: no text in the reply`);
  const out = JSON.parse(text.text) as Rewrite;
  if (out.claim.trim() === seed.fact.trim()) throw new Error(`${seed.id}: claim is unchanged`);
  return out;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const seedsPath = flags.seeds ?? here("./seeds.jsonl");
  const outPath = flags.out ?? here("../../eval/datasets/generated.jsonl");
  const model = flags.model ?? "claude-opus-5-5";
  const withOriginals = flagBool(flags, "with-originals");

  const seeds = parseSeeds(await readFile(seedsPath, "utf8"));
  const client = new Anthropic();
  const items: EvalItem[] = [];

  for (const [i, seed] of seeds.entries()) {
    const split = (i + 1) % 5 === 1 || (i + 1) % 5 === 3 ? "dev" : "test";
    const r = await rewrite(client, model, seed);
    console.log(`${seed.id} [${r.mutation}] ${r.claim}`);
    items.push({
      id: seed.id,
      claim: r.claim,
      label: "Refuted",
      source: "generated",
      split,
      evidence_pages: [seed.page],
      original_fact: seed.fact,
      rationale: r.rationale,
      human_checked: false,
      note: `mutation: ${r.mutation}`,
    });
    if (withOriginals) {
      items.push({
        id: `${seed.id}-true`,
        claim: seed.fact,
        label: "Supported",
        source: "generated",
        split,
        evidence_pages: [seed.page],
        human_checked: false,
        note: `true original of ${seed.id}`,
      });
    }
  }

  const header =
    `// Claude-generated claims (${model}), source=generated, from ${seedsPath.replace(/\\/g, "/").split("/").slice(-3).join("/")}.\n` +
    `// ${items.length} items. human_checked=false until a teammate confirms each against its evidence page.\n` +
    `// Regenerate: npx tsx tools/claim-generator/generate.ts${withOriginals ? " --with-originals" : ""}\n`;
  const body = header + items.map((x) => JSON.stringify(x)).join("\n") + "\n";
  parseDataset(body, outPath); // same checks the harness runs, so a bad file never lands
  await writeFile(outPath, body, "utf8");
  console.log(`Wrote ${items.length} items to ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
