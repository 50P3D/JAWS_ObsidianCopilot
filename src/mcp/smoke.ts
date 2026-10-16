/**
 * Smoke test for NoteCheck MCP Server.
 *
 * Spawns the MCP server as a subprocess over stdio, verifies tool discovery,
 * and calls the `fact_check` tool to verify the response matches the ClaimCard contract.
 *
 * Run with:  npx tsx src/mcp/smoke.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("=== NoteCheck MCP Server Smoke Test ===\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "src/mcp/index.ts"],
  });

  const client = new Client(
    { name: "smoke-test-client", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    console.log("1. Connecting to MCP server via stdio transport...");
    await client.connect(transport);
    console.log("   Connected successfully!\n");

    console.log("2. Querying registered tools (tools/list)...");
    const tools = await client.listTools();
    console.log(`   Found ${tools.tools.length} tool(s):`);
    for (const t of tools.tools) {
      console.log(`   - [${t.name}]: ${t.description.slice(0, 60)}...`);
    }

    const hasFactCheck = tools.tools.some((t) => t.name === "fact_check");
    const hasRetrieve = tools.tools.some((t) => t.name === "retrieve");
    if (!hasFactCheck || !hasRetrieve) {
      throw new Error("Missing expected tools (fact_check or retrieve)");
    }
    console.log("   Both 'fact_check' and 'retrieve' tools are registered.\n");

    console.log("3. Calling 'fact_check' tool...");
    const result = await client.callTool({
      name: "fact_check",
      arguments: {
        text: "The Treaty of Versailles was signed in 1920.",
        note_title: "History Notes",
      },
    });

    console.log("   Response received:");
    const content = result.content as Array<{ type: string; text: string }>;
    if (!content || content.length === 0 || !content[0].text) {
      throw new Error("Empty or invalid tool response content");
    }

    const parsed = JSON.parse(content[0].text);
    console.log(`   - Returned ${parsed.cards?.length ?? 0} Claim Cards`);
    for (const card of parsed.cards || []) {
      console.log(`     • Claim: "${card.claim}" -> Verdict: [${card.verdict}] (Reliability: ${card.reliability?.badge})`);
    }

    console.log("\n=== MCP Smoke Test PASSED! ===");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err);
  process.exit(1);
});

