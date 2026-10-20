# MEDAPATI.md: Medapati Williams Smith's Progress Log

Branch: `williams/plugin-and-mcp`.  
Area: **Obsidian Plugin UI** (`src/plugin/`), **MCP Server** (`src/mcp/`), and integration testing.  
Last updated: 16 October 2026.  

---

## AI Disclaimer

Code, tests, and documentation in this branch were developed with AI assistance (**Antigravity / Claude & Gemini**).
Medapati directed the development, specified requirements, tested the output inside a live Obsidian vault and terminal, made architectural decisions, and verified compliance with the shared `ClaimCard` contract.

All AI interactions have been logged in [`docs/ai-use-log.md`](docs/ai-use-log.md) in accordance with SE201 course policy.

---

## What Was Built

### 1. Obsidian Plugin (`src/plugin/`)
The front-end user experience for NoteCheck inside Obsidian:
- **Command Palette Action**: `NoteCheck: Fact-check selection`. Grabs the user's selected text in the active editor, captures the note title for context, and dispatches a `FactCheckRequest`.
- **Sidebar Results Panel (`ItemView`)**: A custom tab registered in the right sidebar (`notecheck-results`) that renders incoming `ClaimCard` objects:
  - **Verdict Badges**: Color-coded badges for `Supported` (green), `Refuted` (red), and `Not Enough Info` (amber).
  - **Suggested Fix**: Clear correction callout displayed whenever a claim is refuted.
  - **Evidence Section**: Collapsible `<details>` element showing quoted passages, Wikipedia article titles, section headings, retrieval similarity scores, and clickable links to the exact Wikipedia revision (`oldid`).
  - **Reliability Badges**: Trust level badges (`High`, `Medium`, `Low`) with bulleted reasons (e.g. *"stable article"*, *"recent unreviewed edit"*).
  - **Loading & Error States**: Smooth progress feedback while checks are running.
- **Settings Tab**: Configuration tab under Obsidian Community Plugins:
  - Base Ollama URL (default: `http://localhost:11434`)
  - Model selection (default: `qwen3.5:9b`)
  - Wikimedia contact User-Agent header
  - Opt-in toggle for Claude review pass
- **Styles & Build**:
  - `styles.css`: Full stylesheet utilizing native Obsidian CSS variables.
  - `esbuild.config.mjs`: Bundler compiling TypeScript into `dist/plugin/main.js`.
  - Tested and verified in a live Obsidian vault (`TestVault`).

### 2. MCP Server (`src/mcp/`)
A Model Context Protocol server running over `stdio` using `@modelcontextprotocol/sdk`:
- **`fact_check` Tool**: Exposes fact-checking with parameters `{ text, note_title?, headings? }`. Returns contract-compliant `FactCheckResponse` JSON. Currently delegates to fixture mock cards until the pipeline orchestrator is merged.
- **`retrieve` Tool**: Exposes Wikipedia evidence retrieval with parameters `{ query, top_k? }`. Directly wired to Anna's real Wikipedia retrieval module (`src/retrieval/retrieve.ts`).
- **Smoke Test Harness (`src/mcp/smoke.ts`)**: Automated test that boots the server over `stdio`, tests protocol handshake, queries `tools/list`, and calls `fact_check`.

---

## Verification & Test Results

| Check / Test | Command | Result |
|---|---|---|
| **TypeScript Typecheck** | `npm run typecheck` | ✅ Passed (0 errors across entire repo) |
| **Plugin Build** | `npm run build:plugin` | ✅ Compiled `dist/plugin/main.js` (60.3 kB) in 127 ms |
| **MCP Smoke Test** | `npm run smoke:mcp` | ✅ Passed: Protocol handshake, 2 tools listed, `fact_check` returns 3 cards |
| **Retrieval Unit Tests** | `npm run test` | ✅ Passed: All 28 unit tests pass |
| **Live Vault Verification** | Obsidian UI | ✅ Verified in `TestVault`: Command runs, sidebar opens, cards render cleanly |

---

## Status: What is Done vs. Stubbed

### Done:
- [x] Full Obsidian plugin scaffold (manifest, types, settings, view, styles, build script).
- [x] Claim card rendering adhering to `src/contract/claimCard.ts`.
- [x] MCP server over `stdio` with `fact_check` and `retrieve` tools.
- [x] Automated smoke test script for MCP communication.
- [x] Verified in live Obsidian vault (`TestVault`).
- [x] Documentation: `MEDAPATI.md`, `src/plugin/README.md`, `src/mcp/README.md`, `docs/MEDAPATI-STATUS.md`, and `docs/ai-use-log.md`.

### Integrated:
- [x] Plugin calls `factCheck()` from `src/orchestrator/index.js` — no mock data.
- [x] MCP `fact_check` calls `factCheck()` — no mock data.
- [x] Apply-fix button on refuted cards writes `suggested_fix` back into the note.
- [x] Plugin settings (Ollama URL, model, Wikimedia contact) reach retrieval + reliability via `configure*()`.
- [x] Headings extracted from note and passed to claim extractor for context.

---

## Next Steps (Post-Checkpoint / Towards Final Submission)

1. **End-to-end verification**: Run the plugin in `TestVault` with Ollama + `qwen3.5:9b` and confirm real verdicts.
2. **Inline Ambience (Stretch Goal)**: Implement CodeMirror 6 inline squiggly underlines on sentence pause as an experimental toggle.
3. **Claude review (Stretch Goal)**: Wire the `enableClaudeReview` setting to call the MCP server for a second opinion.

