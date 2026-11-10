# AI Use Log: Medapati Williams Smith

<!--
Edit only your own file.

Add one entry per task in which an AI tool produced or substantially
shaped work you submit. Add entries as you work, and commit each entry
together with the work it describes.

Outcome is one of: Kept, Changed, Rejected.
-->

Entries up to 2026-10-19 were moved from the shared table in `docs/ai-use-log.md` on 2026-11-10. Where that table did not record a detail, such as the model, the entry says "not recorded".

## 2026-10-16 · Plugin UI and MCP server scaffold
- **Tool (model):** Antigravity (Claude and Gemini per `MEDAPATI.md`; model for this task not recorded)
- **Files:** src/plugin/, src/mcp/
- **Outcome:** Kept

### What I asked for
A scaffold for the Obsidian plugin UI (command, settings, results panel) and
the MCP server (`fact_check` and `retrieve` tools), using mock data that
follows the contract.

### How I checked it
Reviewed the architecture and validated the output against the ClaimCard
schema.

### What I kept or changed
Kept the scaffold and committed it.

## 2026-10-19 · Plugin and MCP integration with the orchestrator
- **Tool (model):** OpenCode (Claude; model not recorded)
- **Files:** src/plugin/, src/mcp/, src/orchestrator/index.ts, project documentation
- **Outcome:** Kept

### What I asked for
Full integration: wire the plugin and the MCP server to the real
orchestrator, add a canonical `src/orchestrator/index.ts` entry point, add
runtime config injection (`configureRetrieval` and `configureReliability`),
an apply-fix button, headings extraction and `process.env` guards, remove the
mock data, and update all the docs.

### How I checked it
Typecheck clean (0 errors), 89 tests pass, and the plugin builds (269 kB).

### What I kept or changed
Kept the integration and the updated documentation. The mock data was
removed.
