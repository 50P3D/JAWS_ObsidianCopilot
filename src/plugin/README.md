# NoteCheck Obsidian Plugin (`src/plugin`)

**Owner:** Medapati Williams Smith

The user-facing Obsidian plugin component for **NoteCheck**. This allows Obsidian users to select text in their notes, trigger a fact-checking command, configure local AI settings, and view formatted Claim Cards in a dedicated right-hand sidebar panel.

---

## Architecture & Files

```
src/plugin/
├── main.ts              # Plugin lifecycle, command registration, dispatch, course index sync
├── resultView.ts        # Custom ItemView ("notecheck-results") rendering Claim Cards
├── liveChecker.ts       # Live checking: watches the editor, checks finished sentences once each
├── liveText.ts          # Sentence splitting and word-level fixes (no Obsidian imports, unit tested)
├── inlineDecorations.ts # CodeMirror 6 field: underline, struck-through words, green fix, popover
├── paragraphExtractor.ts # Finds the section or paragraph around the cursor
├── settingsTab.ts       # Settings tab (Ollama, model, Wikimedia contact, live check, course folder)
├── types.ts             # Settings interfaces and defaults
├── styles.css           # Styling for verdict pills, trust badges, collapsible evidence
├── manifest.json        # Obsidian community plugin manifest
├── esbuild.config.mjs   # Bundler script compiling TypeScript to CommonJS (main.js)
└── README.md            # This documentation file
```

---

## Features

1. **Fact-Check Selection Command**:
   - Palette command: `NoteCheck: Fact-check selection`.
   - Ribbon icon: Magnifying glass icon on the left ribbon opens the results panel.
   - Extracts selected text and note title context into a `FactCheckRequest`.

2. **Results Sidebar Panel (`ItemView`)**:
   - Renders results adhering to the shared `ClaimCard` contract ([`src/contract/claimCard.ts`](../contract/claimCard.ts)).
   - **Verdict Badges**: Color-coded badges for `Supported` (green), `Refuted` (red), and `Not Enough Info` (amber).
   - **Suggested Fix**: Clear correction box displayed whenever a claim is refuted.
   - **Evidence Collapsible**: Details toggle showing quoted passages, Wikipedia article titles, sections, similarity scores, and pinned revision URLs (`oldid`).
   - **Reliability Badges**: Trust level badges (`High`, `Medium`, `Low`) with bulleted reasons (e.g., *"stable article"*, *"recent unreviewed edit"*).

3. **Inline suggestions (live and selection checks)**:
   - Refuted claims get a wavy underline; the wrong words are struck through and the fix appears in green after them.
   - Click for a card with explanation, evidence and **Accept** / **Dismiss**. Command: `NoteCheck: Accept suggestion at cursor`.
   - Fixes change only the words that differ (`minimalEdit` in `liveText.ts`), so "He was born in 1880" keeps "He".
   - Built as a CodeMirror 6 extension (`registerEditorExtension`). `@codemirror/*` stay external in the bundle because Obsidian provides them.

4. **Course materials**:
   - Setting **Course materials folder** plus **Index now** / `NoteCheck: Index course materials`. See [`src/course/`](../course/).
   - The index is kept in the plugin folder as `course-index.json` and synced before every check.

5. **Settings Page**:
   - **Ollama URL**: e.g., `http://localhost:11434`
   - **Model Name**: e.g., `qwen3.5:9b` (or `qwen3.5:4b` on lower-memory systems)
   - **Wikimedia User-Agent**: Contact header compliant with Wikimedia API policy
   - **Claude Review**: Opt-in toggle for second-opinion evaluations

---

## Build & Installation Instructions

### 1. Build the Plugin Bundle
Compile TypeScript and copy the static assets into `dist/plugin/`:

```bash
npm run build:plugin
```

This creates:
- `dist/plugin/main.js`
- `dist/plugin/manifest.json`
- `dist/plugin/styles.css`

### 2. Install into an Obsidian Vault
1. Open your Obsidian vault in your file explorer.
2. Navigate to `<your-vault>/.obsidian/plugins/`. (If `plugins/` does not exist, create it.)
3. Create a folder named `notecheck`:
   ```
   <your-vault>/.obsidian/plugins/notecheck/
   ```
4. Copy the three files (`main.js`, `manifest.json`, `styles.css`) from `dist/plugin/` into that folder.
5. In Obsidian:
   - Go to **Settings** → **Community plugins**.
   - Ensure Community plugins are enabled.
   - Locate **NoteCheck** in the list and toggle it **ON**.

---

## Status & Integration

| Feature | State | Details |
|---|---|---|
| Plugin lifecycle & command | **Complete** | Registered with Obsidian API |
| Settings tab | **Complete** | Persists settings via Obsidian storage |
| Results panel UI | **Complete** | Full ClaimCard renderer with CSS badges |
| Orchestrator integration | **Complete** | Calls `factCheck()` from `src/orchestrator/index.js` |
| Apply-fix button | **Complete** | Changes only the wrong words of the sentence (word-level diff) |
| Live inline suggestions | **Complete** | CM6 decorations, 21 unit tests (`npm run test:plugin`); hands-on checks in the main README |
| Course materials | **Complete** | Settings, index command, course links in results |
| Runtime config | **Complete** | Plugin settings reach retrieval + reliability via `configure*()` |

