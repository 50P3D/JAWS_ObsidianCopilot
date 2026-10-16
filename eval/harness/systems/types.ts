import type { EvalItem, SystemInfo, SystemOutput } from "../types";

/** Anything we can score: a baseline, or the real pipeline. */
export interface System {
  info: SystemInfo;
  /** Check prerequisites (model installed, module present). Returns a problem, or null if ready. */
  setup?(): Promise<string | null>;
  check(item: EvalItem): Promise<SystemOutput>;
}

/** Keep raw model output in run files, but not unbounded. */
export const clip = (s: string, max = 2000) => (s.length > max ? s.slice(0, max) + " …[clipped]" : s);
