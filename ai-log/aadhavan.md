# AI Use Log: Aadhavan Anna

<!--
Edit only your own file.

Add one entry per task in which an AI tool produced or substantially
shaped work you submit. Add entries as you work, and commit each entry
together with the work it describes.

Outcome is one of: Kept, Changed, Rejected.
-->

Entries up to 2026-11-09 were moved from the shared table in `docs/ai-use-log.md` on 2026-11-10. Where that table did not record a detail, such as the model, the entry says "not recorded".

## 2026-10-12 · Repository README draft
- **Tool (model):** Claude (claude-sonnet-5-5, per `ANNA.md`)
- **Files:** README.md
- **Outcome:** Changed

### What I asked for
A draft of the repository README, based on our project proposal and the
feedback on it.

### How I checked it
Reviewed the draft before committing it.

### What I kept or changed
Edited the draft, then committed it.

## 2026-11-08 · Ghost text suggestions
- **Tool (model):** Claude (model not recorded); Grok in Cursor (model not recorded)
- **Files:** src/plugin/GHOST-TEXT.md, src/plugin/ghostText.ts and its tests, the ghost text settings and settings tab section, src/plugin/main.ts
- **Outcome:** Kept

### What I asked for
Claude: a spec for ghost text (a grey inline suggestion from a small local
model, accepted with Tab) in `src/plugin/GHOST-TEXT.md`, then the unit tests
first, then `src/plugin/ghostText.ts`, its settings, the settings tab section
and the `main.ts` wiring. After each review I asked it to strengthen the tests.

Grok, in read-only Ask mode on a separate clone of the branch: review the
spec, tests and code three times, and read the Stryker reports.

### How I checked it
Ran the tests and the typecheck at each step (120 ghost text tests, 141
plugin tests). Stryker (a mutation testing tool, not AI) gave the objective
score, which went from 67.96% to 86.96% over three runs. Not yet tried in
Obsidian, and not yet read line by line by a teammate.

### What I kept or changed
Where Claude and Grok disagreed, I decided. The decisions are written in
`GHOST-TEXT.md`. The work is on branch `aadhavan/ghost-text`. The plugin
owner must approve the pull request.

## 2026-11-09 · Optional Claude cross-check
- **Tool (model):** Claude (model not recorded)
- **Files:** src/crosscheck/CROSSCHECK.md, src/crosscheck/crosscheck.ts and its tests, src/plugin/ (settings, API key field, a line in the results panel)
- **Outcome:** Kept

### What I asked for
A spec for an optional Claude cross-check in `src/crosscheck/CROSSCHECK.md`:
a second opinion on Supported and Refuted verdicts, using Haiku first and
Sonnet when Haiku does not agree. Then the unit tests first, then
`src/crosscheck/crosscheck.ts` and the plugin wiring.

### How I checked it
Ran the tests and the typecheck at each step (78 cross-check tests, 23
plugin tests, 28 retrieval tests). Stryker (a mutation testing tool, not AI)
gave the objective score: 79.24% on the first tests, 97.48% after the privacy
guard was added. The surviving mutants are equivalent mutants. The tests use
a fake network, so it has not yet been run against the real API. No Grok
review yet, and not yet read line by line by a teammate.

### What I kept or changed
A privacy guard was added: personal language and private-looking text in a
claim are never sent, and the panel says so. The API key is stored in plain
text in the plugin settings, and the settings text says so. The work is on
branch `aadhavan/claude-crosscheck`. It touches `src/plugin/`, so the plugin
owner must approve the pull request.
