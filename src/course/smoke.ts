/**
 * Live check of course RAG: index the sample course, then fact-check a note against it.
 * Needs Ollama running with the chat model and nomic-embed-text.
 *
 *   npm run smoke:course
 *   NOTECHECK_COURSE_DIR=path/to/your/course npm run smoke:course
 *
 * Expected on the sample course: the 2NF claim is Refuted, the isolation-level claim is
 * Supported, and the Versailles claim is not in the course and falls back to Wikipedia.
 * If course verification is inconclusive, that claim also falls back to Wikipedia.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFactCheckPipeline } from "../orchestrator/pipeline";
import { CourseIndex } from "./index";
import { jsonFileStore, readCourseFolder } from "./node";

const dir = process.env.NOTECHECK_COURSE_DIR ?? fileURLToPath(new URL("./testdata/sample-course", import.meta.url));
const index = new CourseIndex(jsonFileStore(join(tmpdir(), "notecheck-smoke-course-index.json")));

let t0 = Date.now();
const report = await index.sync(await readCourseFolder(dir), (m) => console.log(`  ... ${m}`));
console.log(`course index: ${report.passages} passages, ${report.added + report.updated} file(s) embedded, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const text =
  "Second normal form removes transitive dependencies. " +
  "Read Committed prevents dirty reads. " +
  "The Treaty of Versailles was signed in 1920.";

t0 = Date.now();
const res = await runFactCheckPipeline(
  { text, note_title: "Databases revision" },
  { course: { search: (claim) => index.search(claim) }, log: (m) => console.log(`  ... ${m}`) },
);

for (const c of res.cards) {
  console.log(`\n${c.claim_id}: ${c.claim}\n  verdict: ${c.verdict}\n  why: ${c.explanation}`);
  if (c.suggested_fix) console.log(`  fix: ${c.suggested_fix}`);
  for (const e of c.evidence ?? []) {
    console.log(`  ${e.source === "course" ? "course" : "wikipedia"}: ${e.page_title}${e.section ? ` § ${e.section}` : ""} (score ${e.retrieval_score})`);
  }
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
