# NoteCheck MCP Server

The MCP (Model Context Protocol) server exposes NoteCheck's fact-checking
pipeline as **tools** that Claude Desktop — or any MCP-compatible client — can
call over **stdio**.

## Why?

MCP lets Claude (or any LLM assistant that speaks the protocol) call NoteCheck
directly from a chat conversation. The user says "fact-check this paragraph"
and Claude calls the `fact_check` tool behind the scenes, returning claim cards
with verdicts, evidence links, and reliability scores.

---

## Prerequisites

| Requirement | Why |
|---|---|
| **Node.js ≥ 20** | Runtime for the server |
| **npm dependencies installed** (`npm i`) | Pulls the MCP SDK, zod, tsx, etc. |
| **Ollama** with `nomic-embed-text` | Required by the `retrieve` tool for semantic search. Start with `ollama serve`, then `ollama pull nomic-embed-text`. |

> [!NOTE]
> The `fact_check` tool calls the **real** orchestrator pipeline
> (`src/orchestrator/index.ts`). It needs Ollama running with the configured
> LLM model and `nomic-embed-text` for embedding-based retrieval.

---

## Running the server

```bash
# One-shot (recommended during development)
npx tsx src/mcp/index.ts

# Or via the npm script (once added to package.json)
npm run mcp
```

The server communicates over **stdin/stdout** using JSON-RPC, so you won't see
any interactive output — it's designed to be launched by an MCP client.

---

## Available tools

### `fact_check`

Fact-check a piece of text against Wikipedia. Returns claim cards with
verdicts, evidence, and reliability scores.

**Input parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `text` | `string` | ✅ | The text to fact-check |
| `note_title` | `string` | ❌ | Title of the note for context |
| `headings` | `string[]` | ❌ | Headings in the note for context |

**Output** — JSON-stringified `FactCheckResponse` (defined in
`src/contract/claimCard.ts`), containing an array of `ClaimCard` objects.

> [!IMPORTANT]
> This tool calls the **real** orchestrator pipeline via `factCheck()` from
> `src/orchestrator/index.ts`. It needs Ollama running with the configured
> LLM model and `nomic-embed-text` for embedding-based retrieval.

---

### `retrieve`

Search Wikipedia for passages relevant to a claim. Returns ranked evidence
passages.

**Input parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | `string` | ✅ | — | The claim or query to search for |
| `top_k` | `number` | ❌ | `3` | Number of passages to return |

**Output** — JSON-stringified array of `Evidence` objects (defined in
`src/contract/claimCard.ts`).

> [!NOTE]
> This tool calls the **real** retrieval pipeline (`src/retrieval/retrieve.ts`).
> It requires Ollama running with `nomic-embed-text` for embedding-based
> ranking. If Ollama is not reachable, the tool returns a descriptive error
> message with setup instructions.

---

## Adding to Claude Desktop

Edit your Claude Desktop config file
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "notecheck": {
      "command": "npx",
      "args": ["tsx", "<path-to-repo>/src/mcp/index.ts"]
    }
  }
}
```

Replace `<path-to-repo>` with the absolute path to this repository.

After saving, restart Claude Desktop. The `fact_check` and `retrieve` tools
will appear in Claude's tool list.

---

## Testing with MCP Inspector

The MCP Inspector is a browser-based UI that lets you call tools interactively
without needing Claude Desktop:

```bash
npx @modelcontextprotocol/inspector npx tsx src/mcp/index.ts
```

This opens a local web page where you can select a tool, fill in parameters,
and see the raw JSON response.

---

## What works vs. what is stubbed

| Component | Status | Notes |
|---|---|---|
| `retrieve` tool | ✅ **Live** | Calls `src/retrieval/retrieve.ts` directly. Needs Ollama. |
| `fact_check` tool | ✅ **Live** | Calls `factCheck()` from `src/orchestrator/index.ts`. |
| Orchestrator integration | ✅ **Live** | `src/orchestrator/index.ts` exports `factCheck(req, opts)`. |
| Claim extraction | ✅ **Live** | Called by the orchestrator to split text into claims. |
| Reliability scoring | ✅ **Live** | Called by the orchestrator per evidence passage. |
| Verification (verdict) | ✅ **Live** | Called by the orchestrator to produce verdicts. |

---

## File overview

```
src/mcp/
├── index.ts          # Server entry point — registers tools, connects transport
├── smoke.ts          # Automated smoke test (spawns server over stdio)
└── README.md         # This file
```
