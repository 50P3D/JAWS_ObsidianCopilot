# Retrieval notes

Owner: Aadhavan. This file records how retrieval works and the decisions behind it, for the checkpoint document.

## What it does

Input: one claim (a sentence). Output: the best Wikipedia passages as `Evidence[]`, matching `src/contract/claimCard.ts`.

1. **Queries.** Wikipedia search needs every word to match, so a whole sentence often finds nothing. We build short queries instead: named things first ("Treaty of Versailles"), then the main content words. See `query.ts`.
2. **Search and fetch.** Search the top results, then fetch each article as plain text together with its exact `revision_id`. See `wikipedia.ts`.
3. **Chunk.** Cut each article into passages of about one paragraph. Each passage keeps its section name and its position in the article. Reference sections are skipped. See `chunk.ts`.
4. **Keyword candidates.** Score every passage by how many of the claim's words it contains and keep the best 60. This is cheap and limits how many passages need embeddings. See `score.ts`.
5. **Re-rank by meaning.** Embed the claim and the candidates with `nomic-embed-text` through Ollama and compare them. See `embed.ts`.
6. **Title adjustment.** A passage from the article titled exactly like the thing in the claim gets a small boost. A lookalike such as "Treaty of Versailles (1756)" gets a small penalty when the claim does not mention the bracket. See `title.ts`.
7. **Return evidence.** Each result carries the revision link, the section, a score, the sentence to highlight and a little text before and after for the source viewer. The surrounding text never crosses into another section. See `retrieve.ts` and `context.ts`.

## Modes

| Mode | What it uses |
|---|---|
| `keyword` | Word matching only |
| `embedding` | Meaning only, over the keyword candidates |
| `hybrid` (default) | 70% meaning and 30% keywords. Weights are in `config.ts`. |

Having all three lets us compare them in the evaluation and justify the choice.

## Run it

```
npm install
npm run smoke
npm run smoke -- "Pluto was reclassified as a dwarf planet in 2006."
npm run smoke -- "The Treaty of Versailles was signed in 1920." --mode keyword
npm test
```

Needs Ollama running with `nomic-embed-text` pulled (not needed for `--mode keyword`).
Set `NOTECHECK_CONTACT` to your email or the repo URL so Wikimedia can identify the client.

## Score retrieval on the test claims

`testdata/claims.json` holds 20 hand-written claims. Each lists the Wikipedia pages that count as correct and a fact that a good passage should contain (for example the true year).

```
npx tsx src/retrieval/evaluate.ts
npx tsx src/retrieval/evaluate.ts --configs keyword,embedding,hybrid,hybrid:30
```

It prints one row per setup:

| Column | Meaning |
|---|---|
| page@1 | The top passage comes from an expected page |
| page@3 | Any of the top three passages does |
| fact@3 | Any of the top three passages contains the expected fact |
| avg ms | Average time per claim. Wikipedia is cached first, so this is our own processing, mostly embeddings |

It also lists every miss with what came back instead, which is the material for the "failures we saw" part of the checkpoint document. `hybrid:30` means hybrid with 30 candidates instead of 60, to see how much speed we gain and how much accuracy we lose.

The claims and the expected pages were written from general knowledge. Check them and add more, especially ones that are hard for retrieval: names with several meanings, claims with no capitalised words, and different treaties or people sharing a name.

## Known limits and stubs

- **Disambiguation is a stub.** Pages that say "may refer to" are skipped, nothing smarter yet.
- **The title penalty can misfire.** "Mercury (planet)" is penalised if the claim never says "planet". The boost and penalty sizes (`config.ts`) were set by eye on a few claims and need tuning on the test set.
- **The keyword pre-filter can miss paraphrases.** A passage that says the same thing in different words may not reach the embedding step. Raising `candidates` helps.
- **Wording and numbers.** "Signed in 1920" and "signed in 1919" look almost the same to embeddings. The year bonus in `score.ts` keeps a conflicting date in the running, and the verifier makes the final call.
- **Weak results are not dropped yet.** `top` always returns that many passages. The `minRatio` option can drop passages far below the best score. It is off by default until the test set says what value to use.
- **Speed.** Embedding 60 passages took about 5.6 seconds on the first test machine, steady and not just a cold start. The Wikipedia calls add about 1.3 seconds.
- **Only English Wikipedia and the first few search results.**

## First results

First hand-run on two claims, before the title boost: the Pluto claim returned relevant passages. The Versailles claim returned the right treaty but ranked a different treaty (1756) third in hybrid mode, while keyword mode stayed on the right treaty. The full 20-claim comparison still needs to be run.
