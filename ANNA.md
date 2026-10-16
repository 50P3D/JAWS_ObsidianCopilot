# ANNA.md: Aadhavan's progress log

Branch: `ANNA`. Area: retrieval (`src/retrieval/`), the claim card contract (`src/contract/`) and project set-up.
Last updated: 13 October 2026.

## AI disclaimer

All code, tests and documentation in this branch up to this date were written by **Claude** (Anthropic), through Claude Code and Claude chat sessions (model configured as `claude-sonnet-5-5`). No other AI provider was used to write them.

Aadhavan directed the work, ran the code on his own machine, pasted back the results and made the decisions. Claude wrote the files. This covers:

- everything in `src/retrieval/` (code, tests, `NOTES.md`)
- `src/contract/claimCard.ts` and its example JSON files
- the root `README.md`, the `OWNER.md` files, `.gitignore` additions, `package.json` and `tsconfig.json`
- the 20 test claims in `src/retrieval/testdata/claims.json`, which were written from general knowledge and have not yet been checked against Wikipedia by a human

This should also be recorded in `docs/ai-use-log.md`.

## What the retrieval code does

The job: take one claim (a sentence from a note) and find the best passages on Wikipedia to check it against.

1. **Build search queries.** Wikipedia search needs every word to match, so a whole sentence often finds nothing. We pull out names ("Treaty of Versailles") and key words and search for those instead.
2. **Search and fetch.** Take the top few results and download each article as plain text. We also record the exact version of the article (`revision_id`) so a verdict can be reproduced later.
3. **Chunk.** Cut each article into passages of about a paragraph. Each passage remembers its section and its exact position in the article. Reference lists and similar sections are skipped.
4. **Keyword shortlist.** Score every passage by how many of the claim's words it contains and keep the best 60. This is quick and limits how many passages need the slower step.
5. **Rank by meaning.** Turn the claim and each shortlisted passage into numbers (an "embedding", made by `nomic-embed-text` running in Ollama) and compare them. Passages with a similar meaning rank higher, even when the words differ.
6. **Title adjustment.** An article titled exactly like the thing in the claim gets a small boost. A lookalike such as "Treaty of Versailles (1756)" gets a small penalty when the claim does not mention the bracket.
7. **Return evidence.** Each result carries the article link, the section, a score, the sentence to highlight and a little text before and after, all in the shared claim card format.

Three ranking modes exist so we can compare them:

| Mode | What it uses |
|---|---|
| `keyword` | Word matching only |
| `embedding` | Meaning only, over the keyword shortlist |
| `hybrid` | 70% meaning and 30% keywords |

## Scores so far

Test set: 20 hand-written claims, each with the Wikipedia page(s) that count as correct and a fact a good passage should contain. With 20 claims, one claim is worth 5 percentage points.

- **page@1**: the top passage comes from a correct page
- **page@3**: any of the top 3 passages does
- **fact@3**: any of the top 3 passages contains the expected fact

| Setup | page@1 | page@3 | fact@3 | Time per claim |
|---|---|---|---|---|
| keyword | 70% | 90% | 95% | 5 ms |
| embedding | 90% | 90% | 95% | about 6 s |
| hybrid | 85% | 90% | 95% | about 6 s |
| hybrid:30 (30 candidates, not 60) | 85% | 90% | 95% | about 3 s |

How to read this:

- Keyword is fastest but ranks worst. Embedding and hybrid differ by one claim, which is within noise.
- `hybrid:30` halves the time with no loss on this set.
- Every mode misses the same two claims:
  - "Apollo 11 landed humans on the Moon in 1969." returns the Apollo program instead. Cause found: the name finder cuts "Apollo 11" to "Apollo" because it ignores numbers.
  - "Mercury is the closest planet to the Sun." returns Mercury (element) and Freddie Mercury. Likely cause, not yet confirmed: the planet article is never fetched because only 3 articles are read.
- The claims are easy and were written by Claude, so these numbers are probably optimistic.

Unit tests: 28 passed in Claude's own run. Aadhavan's last visible run showed 13, which looks like an older run. Re-run `npm test` to confirm.

## Run it

```
npm install
npm test
npm run smoke
npm run smoke -- "Pluto was reclassified as a dwarf planet in 2006." --mode keyword
npx tsx src/retrieval/evaluate.ts --configs keyword,embedding,hybrid,hybrid:30
```

Ollama must be running with `nomic-embed-text` pulled (not needed for `--mode keyword`).

## Done

- Wikipedia search and fetch with pinned revision
- Query building, chunking, three ranking modes, title adjustment, context for the source viewer
- Output in the shared claim card format
- Smoke test, evaluation runner, 20 test claims, unit tests
- Claim card contract and examples

## Not done yet

- Fix the Apollo 11 and Mercury misses, then choose the default setup
- Proper disambiguation (currently a stub that skips "may refer to" pages)
- Speed (3 to 6 seconds per claim is slow for live use)
- Dropping weak results
- `tools/claim-generator`: generating false claims with Claude for the evaluation
- Connecting retrieval to the orchestrator and plugin
- Claude access for the MCP second opinion
- Checkpoint document sections and AI use log entries

## Test set status and what is still needed

Verdict: **the 20-claim set is a working first version, not complete.** It is enough to show a first round of retrieval testing with real failures (the checkpoint asks for that), but not enough to back strong claims about accuracy.

Gaps in the current set:

- **Too small.** 20 claims means one claim moves a score by 5 points. The embedding vs hybrid gap is one claim, which tells us nothing.
- **Unverified.** Claude wrote the claims and the expected pages from general knowledge. A human has not opened the pages to confirm them.
- **Too easy and all one kind.** Most claims are well known facts about famous topics. There are almost no false claims, no claims with no Wikipedia evidence, and no claims taken from real notes.
- **No true or false label.** Each claim only lists expected pages. The verdict stage will need a label (Supported, Refuted or Not Enough Info) to be scored.
- **No dev and test split.** The title boost was tuned on Versailles and we are about to fix Apollo 11 and Mercury using this same set. Scores from here on are partly tuned on the data. Arne's feedback asks for a split.
- **Retrieval only.** The metric in the proposal is macro-F1 on verdicts (300 FEVER dev claims plus 50 claims from our own notes) against a no-RAG Qwen and Bespoke-MiniCheck. This set tests one stage, not that metric. It supports the checkpoint but does not replace the proposal's test round.

Still to do on the test set:

1. **Verify the 20 claims by hand.** Open each expected page and check the claim and the fact string. About 30 minutes.
2. **Add about 30 harder claims**, including:
   - names that need the number or bracket (Apollo 11, Henry VIII, Windows 95, Jaguar, Java, Amazon)
   - claims with no capitalised words
   - paraphrased claims, where the article uses different words
   - claims with no Wikipedia page, which should return nothing useful
   - 10 to 15 sentences taken from your own Obsidian notes
3. **Add a `label` field** to each claim (true, false or nei) and balance the mix. Use Claude to generate the false ones, as Arne suggested, and record that in the AI use log.
4. **Split into dev and test.** Tune on dev. Freeze test and run it once for the numbers we report.
5. **Agree with Nathanael** how this set relates to his `eval/` set so we do not build two. This one scores retrieval and his scores verdicts, so the claims can be shared with different labels.
6. **Optional:** if the FEVER data is already downloaded, check whether retrieval finds FEVER's listed evidence pages for a few hundred claims. Caution: FEVER used an older Wikipedia, so some titles will have changed.
7. **Repeat the timing runs a few times** and record the spread, not a single average.

Do not fix Apollo 11 and Mercury and then report the new score on the same 20 claims as if it were a fresh result. Add similar new claims first.
