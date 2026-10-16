/**
 * NoteCheck MCP Server
 *
 * Exposes the NoteCheck fact-checking pipeline as MCP (Model Context Protocol)
 * tools that Claude Desktop — or any MCP client — can call over stdio.
 *
 * Tools registered:
 *   • fact_check  – Fact-check a piece of text against Wikipedia.
 *   • retrieve    – Search Wikipedia for evidence passages relevant to a claim.
 *
 * Run with:  npx tsx src/mcp/index.ts
 * Inspect:   npx @modelcontextprotocol/inspector npx tsx src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { mockFactCheck } from "./mockPipeline.js";
import { retrieveEvidence } from "../retrieval/retrieve.js";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "notecheck-mcp",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: fact_check
// ---------------------------------------------------------------------------

server.tool(
  "fact_check",
  "Fact-check a piece of text against Wikipedia. Returns claim cards with verdicts, evidence, and reliability scores.",
  {
    text: z.string().describe("The text to fact-check"),
    note_title: z
      .string()
      .optional()
      .describe("Title of the note for context"),
    headings: z
      .array(z.string())
      .optional()
      .describe("Headings in the note for context"),
  },
  async ({ text, note_title, headings }) => {
    // TODO: Replace with orchestrator pipeline call when src/orchestrator/ is ready.
    // The orchestrator will use note_title and headings to contextualise claims
    // before handing them to retrieval + verification. For now both are unused.
    void note_title;
    void headings;

    try {
      const response = await mockFactCheck(text);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error during fact-check: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: retrieve
// ---------------------------------------------------------------------------

server.tool(
  "retrieve",
  "Search Wikipedia for passages relevant to a claim. Returns ranked evidence passages.",
  {
    query: z.string().describe("The claim or query to search for"),
    top_k: z
      .number()
      .optional()
      .default(3)
      .describe("Number of passages to return"),
  },
  async ({ query, top_k }) => {
    // NOTE: Requires Ollama running with nomic-embed-text for embedding modes.
    // Falls back to keyword-only retrieval if the embedding server is unreachable,
    // but that case currently throws — hence the try/catch.

    try {
      const evidence = await retrieveEvidence(query, { top: top_k });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(evidence, null, 2),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      // Surface actionable help when Ollama is the likely culprit.
      const hint = message.toLowerCase().includes("fetch")
        ? "\n\nHint: Make sure Ollama is running (`ollama serve`) and has the nomic-embed-text model pulled (`ollama pull nomic-embed-text`)."
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `Error during retrieval: ${message}${hint}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Connect transport and start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
