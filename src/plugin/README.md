# NoteCheck Obsidian Plugin (`src/plugin`)

**Owner:** Medapati Williams Smith

The user-facing Obsidian plugin component for **NoteCheck**. This allows Obsidian users to select text in their notes, trigger a fact-checking command, configure local AI settings, and view formatted Claim Cards in a dedicated right-hand sidebar panel.

---

## Architecture & Files

```
src/plugin/
├── main.ts              # Plugin lifecycle, command registration, and dispatch
├── resultView.ts        # Custom ItemView ("notecheck-results") rendering Claim Cards
├── settingsTab.ts       # Settings tab (Ollama URL, model name, Wikimedia contact agent)
├── types.ts             # Settings interfaces and defaults
├── mockData.ts          # Embedded mock cards from src/contract/examples/ for unblocked testing
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

3. **Settings Page**:
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
| Mock data pipeline | **Complete** | Tested against all 3 example contract cards |
| Orchestrator integration | *Stubbed / Placeholder* | Ready to call `src/orchestrator/` once Jonathan completes the pipeline |

