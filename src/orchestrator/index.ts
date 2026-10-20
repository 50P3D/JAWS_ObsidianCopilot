/**
 * Canonical entry point for the NoteCheck fact-checking pipeline.
 *
 * Used by:
 *   - the Obsidian plugin (src/plugin/main.ts)
 *   - the MCP server (src/mcp/index.ts)
 *   - the evaluation harness (eval/harness/systems/pipeline.ts)
 *
 * The heavy lifting lives in pipeline.ts; this module re-exports a single
 * `factCheck(req, opts)` function so every caller uses the same path.
 */

import type { ClaimCard, FactCheckRequest, FactCheckResponse } from "../contract/claimCard";
import { runFactCheckPipeline, type PipelineOptions } from "./pipeline";

export { runFactCheckPipeline } from "./pipeline";
export type { PipelineOptions } from "./pipeline";
export type { FactCheckRequest } from "../contract/claimCard";

/**
 * Fact-check a piece of text against Wikipedia.
 *
 * Thin wrapper over runFactCheckPipeline — kept separate so callers don't
 * need to know the internal module layout.
 */
export async function factCheck(
  req: FactCheckRequest,
  opts: PipelineOptions = {},
): Promise<FactCheckResponse> {
  return runFactCheckPipeline(req, opts);
}
