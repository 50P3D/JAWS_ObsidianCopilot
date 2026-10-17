/**
 * Pick a system by name from the command line.
 *
 *   constant:<label>   always answers <label> (Supported, Refuted or NEI)
 *   no-rag             local model, no evidence             --model qwen3.5:9b --think
 *   minicheck          retrieval + Bespoke-MiniCheck        --retrieval-mode hybrid --top 3 --nei-threshold 0.5
 *   pipeline           the real orchestrator (stubbed until src/orchestrator/ exists)
 */

import { flagBool, flagNumber } from "../cli";
import { constantSystem } from "./constant";
import { minicheckSystem } from "./minicheck";
import { noRagSystem } from "./noRag";
import { pipelineSystem } from "./pipeline";
import type { System } from "./types";

export const SYSTEM_NAMES = ["constant:<label>", "no-rag", "minicheck", "pipeline"];

export function createSystem(name: string, flags: Record<string, string>): System {
  if (name.startsWith("constant:")) return constantSystem(name.slice("constant:".length));
  switch (name) {
    case "no-rag":
      return noRagSystem({ model: flags.model, think: flagBool(flags, "think") });
    case "minicheck": {
      const mode = flags["retrieval-mode"];
      if (mode && !["keyword", "embedding", "hybrid"].includes(mode)) {
        throw new Error(`--retrieval-mode must be keyword, embedding or hybrid`);
      }
      return minicheckSystem({
        model: flags.model,
        retrievalMode: mode as "keyword" | "embedding" | "hybrid" | undefined,
        top: flagNumber(flags, "top", 3),
        neiThreshold: flagNumber(flags, "nei-threshold", 0.5),
      });
    }
    case "pipeline":
      return pipelineSystem({ model: flags.model });
    default:
      throw new Error(`Unknown system "${name}". Choose one of: ${SYSTEM_NAMES.join(", ")}`);
  }
}

export type { System };
