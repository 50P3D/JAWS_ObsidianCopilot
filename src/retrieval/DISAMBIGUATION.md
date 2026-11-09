# Disambiguation: functions and tests

This file describes what disambiguation must do, without code, so a second reviewer (human or AI from another model family) can check the code and the tests against it. If the code and this file disagree, one of them is wrong. Say which.

Status: 30 tests, all passing. Written tests first, then the code. Not yet checked against live Wikipedia (`npm run smoke:disambiguation` does that).

## What the feature is

A search for a claim sometimes lands on a disambiguation page, such as "Mercury may refer to: ...". That page lists meanings and holds no facts. Before this feature the page was dropped. Now NoteCheck reads the introductions of the pages it links to and keeps the meaning the claim is about, so the evidence comes from the right article.

Out of scope: asking the user which meaning they meant, using embeddings or the language model to choose, and handling disambiguation inside a search query before any page is fetched.

## Files

| File | Role |
|---|---|
| `src/retrieval/disambiguate.ts` | `rankSenses`, `chooseSenses`, `expandDisambiguations` |
| `src/retrieval/wikipedia.ts` | `fetchSenses`, the `disambiguation` flag on `fetchPage`, `isDisambiguation` |
| `src/retrieval/retrieve.ts` | Calls `expandDisambiguations` after fetching pages and before cutting them into passages |
| `src/retrieval/disambiguate.test.ts` | Unit tests (`node:test`), run with `npm run test:retrieval`. No network needed |
| `src/retrieval/smokeDisambiguation.ts` | Live check against real Wikipedia, run with `npm run smoke:disambiguation` |

A "sense" is one meaning: the title of a linked article and its first paragraph.

## Defaults

`max` 2 (most meanings kept), `minScore` 0.25, `margin` 0.1. The bracket bonus is 0.3. These were set by hand, not tuned on a test set.

## Functions

### `rankSenses(claim, senses) -> { title, score }[]`

1. Returns one entry per sense, best score first.
2. The score is the share of the claim's distinct words (stopwords removed) that appear in the sense's title plus introduction. This is the same word-matching score the rest of retrieval uses, including its small bonus when both texts contain a year.
3. If the title ends in a bracketed word, as in "Mercury (planet)", and the claim contains that word in any capitalisation, 0.3 is added.
4. No senses gives an empty list.

### `chooseSenses(claim, senses, opts?) -> string[]`

1. If the best score is below `minScore`, return nothing. Guessing is worse than skipping.
2. Otherwise keep the best sense, plus any other sense that scores at least `minScore` and is within `margin` of the best. Two near-equal meanings are both kept.
3. Never return more than `max` titles. Titles come back best first.
4. No senses gives an empty list.

### `expandDisambiguations(claim, pages, deps, opts?) -> WikiPage[]`

`deps` supplies `fetchSenses(title)` and `fetchPage(title)`, so the function can be tested without a network.

1. Missing pages (null) are skipped.
2. Ordinary pages are kept unchanged and stay in the same order.
3. A disambiguation page is replaced, in the same position, by the pages for the chosen meanings.
4. A page never appears twice. The first one wins, judged by page id.
5. A chosen meaning that cannot be fetched, or that is itself a disambiguation page, is dropped.
6. If looking up the meanings fails for one disambiguation page, only that page is dropped. Nothing is thrown, and the rest of the list is returned.
7. `fetchSenses` is called with the disambiguation page's own title.
8. A disambiguation page where no meaning fits adds nothing.

### `isDisambiguation(page) -> boolean`

1. If the page carries a flag, the flag decides, true or false, whatever the text says.
2. With no flag, the phrase "may refer to" or "may also refer to" in the first 400 characters means yes.

### `fetchPage(title)` (changed part only)

1. The request also asks Wikipedia for the page property `disambiguation`.
2. The returned page has `disambiguation` set to true when Wikipedia flags it, or when its text says "may refer to" near the top. Otherwise false.

### `fetchSenses(title, limit = 20) -> Sense[]`

1. Makes one request that lists the pages linked from `title` (main namespace only), with each page's introduction and disambiguation flag.
2. Leaves out missing pages, pages with an empty introduction, pages that are disambiguation pages themselves, and the page `title`.
3. An answer with no pages gives an empty list.
4. A non-OK response throws an error that includes the status code.
5. Only the first `limit` links are looked at. A meaning beyond that is never seen.

## Where it runs

In `retrieveEvidence`, after the top pages are fetched and before they are cut into passages: `fetched` pages go through `expandDisambiguations`, and the result is what gets chunked, ranked and returned.

## Test layout

| Section | Count | What it covers |
|---|---|---|
| `rankSenses` | 4 | Best first, sorted, bracket bonus, no senses |
| `chooseSenses` | 7 | Planet, element and god claims, a tie keeps two, nothing fits, the limit, no senses |
| `expandDisambiguations` | 9 | Ordinary pages, replace in place, no repeats, no fit, failed lookup, missing pages, nested disambiguation, unfetchable meaning, title passed to the lookup |
| `isDisambiguation` | 2 | Flag decides, text fallback |
| `fetchSenses` | 4 | One request and its parameters, filtering, empty answer, error status |
| `fetchPage` | 4 | Flag, text fallback, ordinary article, flag requested |

Not covered by unit tests: the call inside `retrieveEvidence` (needs the network and Ollama) and the real Wikipedia response. Check those with the smoke script.

## Known limits

- Choice is by word overlap only. A claim that shares no words with the intended meaning's introduction is skipped, not guessed.
- Weights and thresholds are set by hand.
- Only the first 20 links of a disambiguation page are read.
- A disambiguation page that lists meanings without linking to articles gives nothing.

## Notes for the cross-checker

1. For every numbered rule above, find at least one test that would fail if the rule were broken. List any rule with no test.
2. Look for tests that only restate the code and would pass for any implementation.
3. Check boundaries: a score of exactly `minScore`, a second meaning exactly `margin` below the best, exactly `max` meanings, one meaning, and a claim with no usable words.
4. Check the spec for gaps the tests cannot see, for example two meanings with the same title, a link to a redirect, or a claim made only of stopwords.
5. After reading, run mutation testing (Stryker) on `src/retrieval/disambiguate.ts` and report the surviving mutants.

## AI use

Claude wrote the tests first, then the code and this file. It needs a row in `docs/ai-use-log.md`. The reviewer should be a different model family from Claude.
