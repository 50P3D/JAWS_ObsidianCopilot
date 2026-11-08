import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMarkdown } from "./chunk";
import { CourseIndex, hashText, type CourseFile, type CourseIndexData, type Embedder, type IndexStore } from "./index";
import { tokens } from "../retrieval/score";

// Bag-of-words vectors: texts sharing words point the same way, which is enough to test ranking
// without Ollama. Words are hashed into 64 buckets.
function fakeEmbedder(model = "fake-embed"): Embedder & { embedded: number } {
  const vec = (text: string) => {
    const v = new Array(64).fill(0);
    for (const t of tokens(text)) v[hashText(t) % 64] += 1;
    return v;
  };
  const e = {
    embedded: 0,
    model: () => model,
    query: async (t: string) => vec(t),
    documents: async (ts: string[]) => {
      e.embedded += ts.length;
      return ts.map(vec);
    },
  };
  return e;
}

function memoryStore(): IndexStore & { saved: CourseIndexData | null; saves: number } {
  const s = {
    saved: null as CourseIndexData | null,
    saves: 0,
    load: async () => (s.saved ? structuredClone(s.saved) : null),
    save: async (d: CourseIndexData) => {
      s.saved = structuredClone(d);
      s.saves++;
    },
  };
  return s;
}

const file = (path: string, text: string, mtime = 1): CourseFile => ({ path, mtime, read: async () => text });

const NORMALISATION = `# Normalisation
## Second normal form
- A relation is in 2NF when it is in 1NF and has no partial dependencies.
## Third normal form
- A relation is in 3NF when it is in 2NF and has no transitive dependencies.`;

const TRANSACTIONS = `# Transactions
## ACID
- Durability: once committed, a transaction survives a crash.`;

test("chunkMarkdown keeps headings as sections and drops frontmatter", () => {
  const out = chunkMarkdown(`---\ntags: x\n---\n${NORMALISATION}`);
  assert.deepEqual(
    out.map((p) => p.section),
    ["Second normal form", "Third normal form"],
  );
  assert.ok(!out.some((p) => p.text.includes("tags:")));
});

test("chunkMarkdown keeps passages under maxChars and drops tiny ones", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `- Fact number ${i} about relational database design.`);
  const out = chunkMarkdown(`## Facts\n${lines.join("\n")}\n## Empty\n[[x.png]]`, { maxChars: 200 });
  assert.ok(out.length > 1);
  assert.ok(out.every((p) => p.text.length <= 200));
  assert.ok(out.every((p) => p.section === "Facts"));
});

test("chunkMarkdown drops embedded images", () => {
  const out = chunkMarkdown("## Diagram\n![[er-diagram.png]]\n![alt](pic.png)\nThe ER diagram shows three entities and two relations.");
  assert.equal(out.length, 1);
  assert.ok(!out[0].text.includes("png"));
});

test("sync embeds new files once and skips unchanged ones", async () => {
  const embedder = fakeEmbedder();
  const store = memoryStore();
  const index = new CourseIndex(store, embedder);

  const first = await index.sync([file("db/norm.md", NORMALISATION), file("db/tx.md", TRANSACTIONS)]);
  assert.equal(first.added, 2);
  const embeddedAfterFirst = embedder.embedded;
  assert.ok(embeddedAfterFirst > 0);

  const second = await index.sync([file("db/norm.md", NORMALISATION), file("db/tx.md", TRANSACTIONS)]);
  assert.equal(second.unchanged, 2);
  assert.equal(embedder.embedded, embeddedAfterFirst);
  assert.equal(store.saves, 1);
});

test("sync re-embeds only the changed file and removes deleted ones", async () => {
  const embedder = fakeEmbedder();
  const index = new CourseIndex(memoryStore(), embedder);
  await index.sync([file("norm.md", NORMALISATION), file("tx.md", TRANSACTIONS)]);
  const before = embedder.embedded;

  const r = await index.sync([file("norm.md", NORMALISATION + "\n- BCNF is stricter than 3NF.", 2)]);
  assert.equal(r.updated, 1);
  assert.equal(r.removed, 1);
  assert.equal(embedder.embedded - before, chunkMarkdown(NORMALISATION + "\n- BCNF is stricter than 3NF.").length);
  assert.deepEqual(await index.stats(), { files: 1, passages: r.passages });
});

test("a touched but unedited file keeps its vectors", async () => {
  const embedder = fakeEmbedder();
  const index = new CourseIndex(memoryStore(), embedder);
  await index.sync([file("norm.md", NORMALISATION, 1)]);
  const before = embedder.embedded;
  const r = await index.sync([file("norm.md", NORMALISATION, 99)]);
  assert.equal(r.unchanged, 1);
  assert.equal(embedder.embedded, before);
});

test("the index is reloaded from the store and rebuilt when the embedding model changes", async () => {
  const store = memoryStore();
  await new CourseIndex(store, fakeEmbedder("model-a")).sync([file("norm.md", NORMALISATION)]);

  const sameModel = fakeEmbedder("model-a");
  await new CourseIndex(store, sameModel).sync([file("norm.md", NORMALISATION)]);
  assert.equal(sameModel.embedded, 0);

  const newModel = fakeEmbedder("model-b");
  const r = await new CourseIndex(store, newModel).sync([file("norm.md", NORMALISATION)]);
  assert.equal(r.added, 1);
  assert.ok(newModel.embedded > 0);
});

test("search returns the matching course passage as course evidence", async () => {
  const index = new CourseIndex(memoryStore(), fakeEmbedder());
  await index.sync([file("db/norm.md", NORMALISATION), file("db/tx.md", TRANSACTIONS)]);

  const [best] = await index.search("3NF has no transitive dependencies", { minScore: 0.3 });
  assert.equal(best.source, "course");
  assert.equal(best.url, "db/norm.md");
  assert.equal(best.page_title, "norm");
  assert.equal(best.section, "Third normal form");
  assert.equal(best.revision_id, hashText(NORMALISATION));
});

test("search leaves out excluded files, so a note cannot confirm itself", async () => {
  const index = new CourseIndex(memoryStore(), fakeEmbedder());
  await index.sync([file("db/norm.md", NORMALISATION), file("db/tx.md", TRANSACTIONS)]);
  const hits = await index.search("3NF has no transitive dependencies", { minScore: 0, exclude: ["db/norm.md"] });
  assert.ok(hits.every((h) => h.url !== "db/norm.md"));
});

test("search returns nothing when no passage is close enough", async () => {
  const index = new CourseIndex(memoryStore(), fakeEmbedder());
  await index.sync([file("db/norm.md", NORMALISATION)]);
  assert.deepEqual(await index.search("The Eiffel Tower is in Paris", { minScore: 0.5 }), []);
});

test("parallel syncs do not embed the same file twice", async () => {
  const embedder = fakeEmbedder();
  const index = new CourseIndex(memoryStore(), embedder);
  const files = [file("norm.md", NORMALISATION)];
  await Promise.all([index.sync(files), index.sync(files)]);
  assert.equal(embedder.embedded, chunkMarkdown(NORMALISATION).length);
});
