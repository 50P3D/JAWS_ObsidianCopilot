/**
 * Course index: RAG over the user's own course materials instead of Wikipedia.
 *
 *   sync(files)    chunk and embed every course file once, then only files that changed
 *   search(claim)  the course passages closest to a claim, as contract Evidence
 *
 * The index is a plain JSON object (file path -> passages with their embeddings). Where it is
 * saved is up to the caller: the plugin keeps it in its own folder in the vault, Node scripts use
 * a JSON file (see node.ts). A whole course is a few hundred passages, so searching is a straight
 * loop over all of them and needs no vector database.
 */

import type { Evidence } from "../contract/claimCard";
import { splitSentences } from "../retrieval/chunk";
import { EMBED_MODEL, HYBRID_EMBEDDING_WEIGHT, HYBRID_KEYWORD_WEIGHT } from "../retrieval/config";
import { embedDocuments, embedQuery } from "../retrieval/embed";
import { cosine, keywordScore } from "../retrieval/score";
import { chunkMarkdown, type CoursePassage } from "./chunk";

/**
 * Passages scoring below this are treated as "the course does not cover this claim", so the
 * pipeline falls back to Wikipedia. Picked by eye on the sample course in testdata/.
 * Tune it on the dev set before trusting it.
 */
export const DEFAULT_MIN_SCORE = 0.5;

/** One course file as the caller sees it. `read` is only called when the file is new or changed. */
export interface CourseFile {
  /** Path relative to the vault or course folder, with forward slashes. Used as the key and the link. */
  path: string;
  /** Last modified time in milliseconds. */
  mtime: number;
  read: () => Promise<string>;
}

interface StoredPassage extends CoursePassage {
  vector: number[];
}

interface StoredFile {
  mtime: number;
  hash: number;
  passages: StoredPassage[];
}

export interface CourseIndexData {
  version: 1;
  /** Vectors from different embedding models cannot be compared, so a model change rebuilds the index. */
  embed_model: string;
  files: Record<string, StoredFile>;
}

/** Where the index is saved between sessions. */
export interface IndexStore {
  load(): Promise<CourseIndexData | null>;
  save(data: CourseIndexData): Promise<void>;
}

/** The embedding calls, swappable so tests run without Ollama. */
export interface Embedder {
  model(): string;
  query(text: string): Promise<number[]>;
  documents(texts: string[]): Promise<number[][]>;
}

const ollamaEmbedder: Embedder = {
  model: () => EMBED_MODEL,
  query: embedQuery,
  documents: embedDocuments,
};

export interface SyncReport {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Passages in the index after the sync. */
  passages: number;
}

export interface CourseSearchOptions {
  /** How many passages to return. */
  top?: number;
  minScore?: number;
  /** Paths to leave out, such as the note being checked, so a note never confirms itself. */
  exclude?: string[];
  /** Topic context from the note being checked, used to disambiguate local material. */
  context?: { noteTitle?: string; headings?: string[]; topics?: string[]; fast?: boolean };
}

export class CourseIndex {
  private data: CourseIndexData | null = null;
  // syncs run one at a time, so two checks started together do not embed the same file twice
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private store: IndexStore,
    private embedder: Embedder = ollamaEmbedder,
  ) {}

  /** Bring the index in line with `files`: embed new and changed files, drop files that are gone. */
  sync(files: CourseFile[], log?: (msg: string) => void): Promise<SyncReport> {
    const run = this.queue.then(() => this.syncNow(files, log));
    this.queue = run.catch(() => {});
    return run;
  }

  /** The course passages that best match a claim, best first. Empty when none reach minScore. */
  async search(claim: string, opts: CourseSearchOptions = {}): Promise<Evidence[]> {
    const top = opts.top ?? 3;
    const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
    const exclude = new Set(opts.exclude ?? []);
    const data = await this.loaded();

    const candidates: { path: string; file: StoredFile; passage: StoredPassage }[] = [];
    for (const [path, file] of Object.entries(data.files)) {
      if (exclude.has(path)) continue;
      for (const passage of file.passages) candidates.push({ path, file, passage });
    }
    if (candidates.length === 0) return [];

    const topic = [
      ...(opts.context?.topics ?? []),
      opts.context?.noteTitle,
      ...(opts.context?.headings ?? []),
    ].filter(Boolean).join(" > ");
    const queryVec = opts.context?.fast ? undefined : await this.embedder.query(topic ? `${topic}: ${claim}` : claim);
    const topicTerms = topic ? `${topic} ${claim}` : claim;
    return candidates
      .map((c) => ({
        ...c,
        keyword: keywordScore(claim, c.passage.text),
        score:
          (queryVec
            ? HYBRID_EMBEDDING_WEIGHT * cosine(queryVec, c.passage.vector) +
              HYBRID_KEYWORD_WEIGHT * keywordScore(claim, c.passage.text)
            : keywordScore(claim, c.passage.text)) +
          (topic ? 0.1 * keywordScore(topic, `${c.path} ${c.passage.section}`) : 0),
      }))
      // Semantic similarity alone can match unrelated notes (for example a finance passage
      // for a claim about Singapore's age). Require at least one meaningful shared token before
      // course material can be used as evidence; Wikipedia remains the fallback otherwise.
      .filter((c) => c.keyword > 0 && c.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, top)
      .map((c) => toEvidence(claim, c.path, c.file, c.passage, c.score));
  }

  /** Number of files and passages currently indexed. */
  async stats(): Promise<{ files: number; passages: number }> {
    const data = await this.loaded();
    const files = Object.values(data.files);
    return { files: files.length, passages: files.reduce((n, f) => n + f.passages.length, 0) };
  }

  private async loaded(): Promise<CourseIndexData> {
    if (!this.data) {
      const saved = await this.store.load();
      this.data = saved?.version === 1 ? saved : { version: 1, embed_model: this.embedder.model(), files: {} };
    }
    return this.data;
  }

  private async syncNow(files: CourseFile[], log?: (msg: string) => void): Promise<SyncReport> {
    const data = await this.loaded();
    const report: SyncReport = { added: 0, updated: 0, removed: 0, unchanged: 0, passages: 0 };
    let changed = false;

    if (data.embed_model !== this.embedder.model()) {
      log?.(`embedding model changed from ${data.embed_model}, rebuilding the course index`);
      data.embed_model = this.embedder.model();
      data.files = {};
      changed = true;
    }

    const seen = new Set<string>();
    for (const f of files) {
      seen.add(f.path);
      const old = data.files[f.path];
      if (old && old.mtime === f.mtime) {
        report.unchanged++;
        continue;
      }
      const text = await f.read();
      const hash = hashText(text);
      if (old && old.hash === hash) {
        // touched but not edited (for example a sync tool), so keep the old vectors
        old.mtime = f.mtime;
        report.unchanged++;
        changed = true;
        continue;
      }

      const passages = chunkMarkdown(text);
      const vectors = passages.length
        ? await this.embedder.documents(passages.map((p) => embeddingText(f.path, p)))
        : [];
      data.files[f.path] = {
        mtime: f.mtime,
        hash,
        passages: passages.map((p, i) => ({ ...p, vector: roundVector(vectors[i]) })),
      };
      if (old) report.updated++;
      else report.added++;
      changed = true;
      log?.(`indexed ${f.path} (${passages.length} passages)`);
    }

    for (const path of Object.keys(data.files)) {
      if (!seen.has(path)) {
        delete data.files[path];
        report.removed++;
        changed = true;
      }
    }

    if (changed) await this.store.save(data);
    report.passages = Object.values(data.files).reduce((n, f) => n + f.passages.length, 0);
    return report;
  }
}

/** FNV-1a, 32 bit. Stands in for a Wikipedia revision id: same text, same number. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** "Lecture 3.md" from "Courses/DB/Lecture 3.md", without the extension. */
export function fileTitle(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

// The file name and heading go into the embedding too, because a bullet like "- removes partial
// dependencies" means little without "Normalisation > 2NF" in front of it.
function embeddingText(path: string, p: CoursePassage): string {
  return `${fileTitle(path)}${p.section ? ` > ${p.section}` : ""}: ${p.text}`;
}

// 4 decimals is plenty for cosine similarity and makes the saved JSON about half the size
function roundVector(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1e4) / 1e4);
}

function toEvidence(claim: string, path: string, file: StoredFile, p: StoredPassage, score: number): Evidence {
  // highlight the sentence that best matches the claim, as Wikipedia retrieval does
  let best = { start: 0, end: p.text.length };
  let bestScore = -1;
  for (const s of splitSentences(p.text)) {
    const sc = keywordScore(claim, p.text.slice(s.start, s.end));
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return {
    passage: p.text,
    page_title: fileTitle(path),
    revision_id: file.hash,
    revision_timestamp: new Date(file.mtime).toISOString(),
    url: path,
    source: "course",
    section: p.section || undefined,
    retrieval_score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000,
    highlight: best,
  };
}
