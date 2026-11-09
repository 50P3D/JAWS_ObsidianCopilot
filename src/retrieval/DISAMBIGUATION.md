# Disambiguation: functions and tests

This file describes what disambiguation must do, without code, so a second reviewer (human or AI from another model family) can check the code and the tests against it. If the code and this file disagree, one of them is wrong. Say which.

Status: 57 tests, all passing. Written tests first, then the code. Not yet checked against live Wikipedia (`npm run smoke:disambiguation` does that).

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

### `pickSenseTitles(name, links, limit) -> string[]`

1. Titles that start with `name` and a bracket ("Mercury (planet)"), ignoring capital letters, come first.
2. The other links follow in the order given.
3. Leaves out `name` itself, "(disambiguation)" titles and repeats, and returns at most `limit` titles.

### `fetchSenses(title, limit = 40) -> Sense[]`

1. First request lists the links of `title` (main namespace only). No links means no second request.
2. `pickSenseTitles` chooses which links to read, so "Mercury (planet)" is read even when it is far down Wikipedia's alphabetical list.
3. Introductions are requested in batches of at most 20 titles (Wikipedia's cap), together with the disambiguation flag.
4. Leaves out missing pages, pages with an empty introduction, disambiguation pages (flagged, or saying "may refer to" in the first 400 characters) and the page `title`.
5. A non-OK response throws an error that includes the status code.

## Where it runs

In `retrieveEvidence`, after the top pages are fetched and before they are cut into passages: `fetched` pages go through `expandDisambiguations`, and the result is what gets chunked, ranked and returned.

## Test layout

| Section | Count | What it covers |
|---|---|---|
| `rankSenses` | 8 | Best first, sorted, bracket bonus, no senses |
| `chooseSenses` | 14 | Planet, element and god claims, a tie keeps two, nothing fits, the limit, no senses |
| `expandDisambiguations` | 11 | Ordinary pages, replace in place, no repeats, no fit, failed lookup, missing pages, nested disambiguation, unfetchable meaning, title passed to the lookup |
| `isDisambiguation` | 3 | Flag decides, text fallback |
| `fetchSenses` | 9 | Links then introductions, qualified titles far down the list, batches of 20, filtering, no links, error status |
| `pickSenseTitles` | 7 | Qualified first, capitals, exclusions, limit, fallback, no links |
| `fetchPage` | 5 | Flag, text fallback, ordinary article, flag requested |

Not covered by unit tests: the call inside `retrieveEvidence` (needs the network and Ollama) and the real Wikipedia response. Check those with the smoke script.

## Known limits

- Choice is by word overlap only. A claim that shares no words with the intended meaning's introduction is skipped, not guessed.
- Weights and thresholds are set by hand.
- At most 40 linked pages are read per disambiguation page, qualified titles first. A meaning without a bracket in its title may be cut on very long pages.
- Found by the live smoke test: reading only the first 20 links (alphabetical) missed Mercury (planet) and Mercury (element). Unit tests with fakes could not show this.
- A disambiguation page that lists meanings without linking to articles gives nothing.

## Notes for the cross-checker

1. For every numbered rule above, find at least one test that would fail if the rule were broken. List any rule with no test.
2. Look for tests that only restate the code and would pass for any implementation.
3. Check boundaries: a score of exactly `minScore`, a second meaning exactly `margin` below the best, exactly `max` meanings, one meaning, and a claim with no usable words.
4. Check the spec for gaps the tests cannot see, for example two meanings with the same title, a link to a redirect, or a claim made only of stopwords.
5. After reading, run mutation testing (Stryker) on `src/retrieval/disambiguate.ts` and report the surviving mutants.

## AI use

Claude wrote the tests first, then the code and this file. It needs a row in `docs/ai-use-log.md`. The reviewer should be a different model family from Claude.

## Review log

A full pass is: the reviewer reads this spec, compares it with the code and tests, then runs Stryker on `disambiguate.ts`. Fixes follow, then the next pass repeats all of it.

### Preliminary review (Grok in Cursor, Ask mode, comparison only, no Stryker)

Found that the numbers were not pinned: the 0.3 bonus, minimum score 0.25, margin 0.1 and default maximum of 2 would all survive a wrong value. Also found that `fetchSenses` kept a page that only said "may refer to" (no flag), that one failed `fetchPage` threw away every meaning of that page, and that "may also refer to", the 400-character window, the default limit of 40, `plnamespace=0` and `ppprop` were untested. Fixed in the next commit (38 -> 54 tests). No Stryker score was taken at this stage.

### Pass 1 (Grok on commit a25442b, then Stryker)

Grok's run used a commit from before the preliminary fixes, so it re-found the same gaps. Stryker scored 77.78% (72 mutants, 16 survived) on the old tests. Our own run on the fixed tests scored 90.41% (73 mutants, 7 survived). The 7 survivors:

| Survivor | Verdict | Action |
|---|---|---|
| Quantity check `ranked[0].score < minScore` set to false | Equivalent: the filter below already returns nothing | Removed the redundant line |
| `r.score >= minScore` set to true | Real gap | Test: second meaning below 0.25 but within the margin is dropped |
| `<= margin` changed to `< margin` | Real gap (hidden by floating point on 0.5 and 0.4) | Test with margin 0.25 on scores 0.75 and 0.5, which are exact in binary |
| `.trim()` dropped on the bracket word | Real gap | Test with "Foo ( album )" |
| Regex without `$` (first bracket, not last) | Real gap | Test with "Foo (Mercury) (album)" |
| Regex `\s*$` changed to `\S*$` | Real gap | Test with a trailing space after the bracket |
| `.catch(() => null)` changed to `() => undefined` | Equivalent: both are falsy and skipped | None |

After the fixes: 57 tests, Stryker 98.53% (68 mutants, 1 survivor, equivalent).

### Pass 2

To do: Grok re-reads this spec against the fixed code and tests and runs Stryker again.

### Left as is on purpose

The planet, element and god tests stay as readable examples, because the exact-number tests do the pinning. The live case where the god claim keeps both Mercury (planet) and Mercury (mythology) is the margin rule working, not a bug. The scoring weights are hand-set and are not retuned against the test claims.
