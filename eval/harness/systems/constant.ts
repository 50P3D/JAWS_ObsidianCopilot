/**
 * Always answers the same label. The floor every real system must beat.
 * On a balanced 3-label set it scores accuracy 1/3 and macro-F1 about 0.17.
 * Also the cheapest way to check the harness end to end without Ollama.
 */

import { normaliseLabel } from "../labels";
import type { System } from "./types";

export function constantSystem(labelArg: string): System {
  const verdict = normaliseLabel(labelArg);
  if (!verdict) throw new Error(`constant:<label> needs Supported, Refuted or NEI, got "${labelArg}"`);
  return {
    info: { name: `constant:${verdict}`, config: { verdict } },
    async check() {
      return { verdict };
    },
  };
}
