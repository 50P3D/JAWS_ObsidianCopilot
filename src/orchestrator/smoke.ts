import { runFactCheckPipeline } from "./pipeline";

const text = "The Treaty of Versailles was signed in 1920. Albert Einstein was born in Ulm. The Eiffel Tower is in Berlin.";
const t0 = Date.now();
const res = await runFactCheckPipeline({ text, note_title: "Revision notes" }, { log: (m) => console.log(`  ... ${m}`) });

for (const c of res.cards) {
  console.log(`\n${c.claim_id}: ${c.claim}\n  verdict: ${c.verdict}\n  why: ${c.explanation}`);
  if (c.suggested_fix) console.log(`  fix: ${c.suggested_fix}`);
  for (const e of c.evidence ?? []) console.log(`  source: ${e.page_title}  ${e.url}`);
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
