# Ghost text: functions and tests

This file describes what the ghost text feature must do, without code, so a second reviewer (human or AI from another model family) can check the code and the tests against it. If the code and this file disagree, one of them is wrong. Say which.

Status: tests written first, now passing (49/49). `ghostText.ts` is implemented; settings and `main.ts` wiring still to do.

## What the feature is

After you type a space and pause, a short grey suggestion appears after the cursor. It comes from a small local model through Ollama. Tab accepts it. Esc dismisses it. Typing the letters of the suggestion consumes it. Anything else clears it. The suggestion is never saved in the note until you accept it.

Out of scope: suggestions mid-word, multi-line suggestions, accepting one word at a time, cloud models.

## Files

| File | Role | State |
|---|---|---|
| `src/plugin/ghostText.ts` | Pure helpers, the Ollama call and the editor extension. No Obsidian imports, so it can be unit tested | Implemented |
| `src/plugin/ghostText.test.ts` | Unit tests (`node:test`, `assert/strict`), run with `npm run test:ghost` | Written, green (49/49) |
| `src/plugin/GHOST-TEXT.md` | This file | Written |
| `src/plugin/types.ts`, `settingsTab.ts`, `main.ts` | Settings and wiring (later step) | Not started |
| `eval/ghost/` | Latency and usefulness measurement on 20 hand-picked sentences (later step, needs the `eval/` owner's agreement) | Not started |

## Settings (later step, all off or small by default)

| Setting | Default | Meaning |
|---|---|---|
| `enableGhostText` | false | Turns the feature on |
| `ghostModel` | a small model such as `qwen3.5:2b` | Model used for suggestions. Separate from the fact-check model |
| `ghostDebounceMs` | 400 | Pause after typing before a suggestion is requested |

## Options (`GhostOptions`, with defaults)

`maxContextChars` 600, `maxWords` 12, `minWordsBefore` 3, `maxTokens` 24. Every function that takes options accepts a partial set and fills in the defaults.

## Functions

### `shouldSuggest(input, opts?) -> boolean`
Decides whether to ask the model at all. Input: the text before the cursor, the rest of the cursor's line, whether text is selected, whether the feature is enabled and whether a live fact-check is running.

Returns true only when all of these hold:
1. The feature is enabled.
2. No live check is running (the same small machine runs both models).
3. Nothing is selected.
4. The rest of the line after the cursor is empty or only spaces.
5. The text before the cursor ends with a space.
6. The current line has at least `minWordsBefore` words, not counting a leading list marker such as `- `.
7. The cursor is not in a heading, a fenced code block, frontmatter, a maths block or a table row.

### `buildPrompt(before, opts?) -> string`
Builds the text sent to the model. Rules:
1. The text before the cursor is the last thing in the prompt, unchanged, including a trailing space.
2. At most `maxContextChars` characters of the note are included, taken from the end.
3. If the note is cut, the context starts at a word boundary, never inside a word. A word that does not fit is dropped.
4. Frontmatter at the top of the note is left out.
5. The instruction around the context is short (under 300 characters) and asks for a continuation of a few words only.

### `cleanCompletion(raw, before, opts?) -> string`
Turns the model's raw reply into a safe suggestion, or an empty string. Rules, in order:
1. Empty, blank or symbol-only replies give an empty string.
2. Only the first line is kept.
3. Wrapping quotes are removed.
4. Chatty openers ("Sure", "Here is", "Here's" and similar) make the whole reply invalid, so the result is an empty string.
5. If the reply starts by repeating the last words before the cursor (three or more), the repeated part is removed.
6. The reply is cut after the first sentence end, where a full stop, `!` or `?` is followed by a space or the end of the text. A decimal point such as in `3.5` is not a sentence end.
7. At most `maxWords` words are kept.
8. Spacing: if the text before the cursor ends in whitespace, leading spaces are removed. If it does not, and the reply starts with a word, exactly one leading space is added. If the reply starts with punctuation, none is added.
9. The result never contains a newline.

### `advanceSuggestion(suggestion, typed) -> string | null`
Called when the user types characters. If `typed` is an exact, case-sensitive start of `suggestion` and something remains, returns the remainder. Returns null if the typing does not match or nothing remains.

### `fetchCompletion({ before, model, ollamaUrl, opts?, signal?, fetchFn? }) -> Promise<string>`
Asks Ollama for a suggestion and returns the cleaned text. `fetchFn` defaults to the global `fetch` and exists so tests can fake it.
1. Sends a POST to `<ollamaUrl>/api/generate`. A trailing slash on the URL is tolerated.
2. The JSON body has the model name, the prompt from `buildPrompt`, `stream: false`, `think: false`, a stop sequence of a newline, and a token limit between 1 and 40.
3. The abort signal is passed on to `fetch`.
4. If the signal is already aborted, `fetch` is not called and the result is an empty string.
5. If the request is aborted, the result is an empty string and nothing is thrown.
6. A non-OK response throws an error that includes the status code.
7. A network failure throws an error that names Ollama.
8. The model's text goes through `cleanCompletion` before it is returned.

### Editor extension

State: at most one ghost `{ pos, text }` per editor, shown as grey widget text at `pos` and never part of the document.

| Function | Behaviour |
|---|---|
| `ghostTextExtension()` | The CodeMirror 6 extension to register once. Holds the ghost state and draws it. Tab and Esc are bound only while a ghost is showing, so Tab still indents otherwise |
| `showGhost(view, text)` | Shows `text` at the cursor. Ignored if `text` is empty or text is selected. Replaces any earlier ghost |
| `currentGhost(view)` | Returns the ghost or null |
| `acceptGhost(view)` | Inserts the text at the ghost position, puts the cursor after it, clears the ghost and returns true. Returns false and changes nothing if there is no ghost |
| `dismissGhost(view)` | Clears the ghost without editing the note. Returns true if there was one, otherwise false |

The ghost updates on its own:
1. Typing the next letters of the suggestion moves it forward (`advanceSuggestion`). The ghost position follows the cursor.
2. Typing the last remaining letters clears it.
3. Typing anything else clears it.
4. Moving the cursor away from the ghost position clears it.
5. Any edit elsewhere in the note clears it.

## Data flow

Typing stops for `ghostDebounceMs`, then `shouldSuggest`, then `fetchCompletion` (earlier request aborted if the user typed again), then `showGhost`. Tab runs `acceptGhost`. Esc runs `dismissGhost`.

## Test layout

One test file, in sections that match the functions above. Each test has one reason to fail.

| Section | Count | What it covers |
|---|---|---|
| `shouldSuggest` | 12 | One test per rule 1 to 7, plus boundary cases (two words against three, list marker, text after a closed code block or frontmatter) |
| `buildPrompt` | 4 | Last in prompt, length cap, word-boundary cut, frontmatter |
| `cleanCompletion` | 10 | One test per rule, plus decimal point and the repeated-words case |
| `advanceSuggestion` | 3 | Match, mismatch and fully typed |
| `fetchCompletion` | 8 | Request shape, cleaning, trailing slash, signal passed on, abort, pre-aborted, HTTP error, network error. Uses a fake `fetch`, so no Ollama is needed |
| Editor state | 12 | Show, replace, ignore, accept, dismiss, type to advance, type to clear, cursor move, edit elsewhere, and that the note text never changes until accept |

Not covered by unit tests, so check by hand in Obsidian: the grey styling, the Tab and Esc keys inside a real editor, and how it behaves next to the live fact-check suggestions.

## Notes for the cross-checker

1. For every numbered rule above, find at least one test that would fail if the rule were broken. List any rule with no test.
2. Look for tests that only restate the code and would pass for any implementation.
3. Check boundaries: exactly `minWordsBefore` words, exactly `maxWords`, a reply that is only a quote mark, a reply that repeats all of `before`.
4. Check the spec for gaps the tests cannot see, for example an unclosed code fence or frontmatter that never closes.
5. After the code exists, run mutation testing (Stryker) on `ghostText.ts` and report the surviving mutants.

## AI use

The spec, the stub and the tests were written by Claude (Claude Code) and need one log row in `docs/ai-use-log.md`. The reviewer should be a different model family, and its row should name the model.
