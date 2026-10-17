/**
 * Shapes used across the evaluation harness.
 *
 * Verdict labels come from the shared claim card contract, so the harness scores
 * exactly what the pipeline emits.
 */

import type { Evidence, Verdict } from "../../src/contract/claimCard";

export type { Verdict };

export const VERDICTS: readonly Verdict[] = ["Supported", "Refuted", "Not Enough Info"] as const;

/** Where a test claim came from. Reported separately because each has different caveats. */
export type ItemSource = "fever" | "notes" | "generated";

/** dev is for tuning prompts and thresholds. test is frozen and run once at the end. */
export type Split = "dev" | "test";

/** One labelled claim in a dataset file (one JSON object per line). */
export interface EvalItem {
  /** Stable id, for example "fever-91198". Used to pair predictions across runs. */
  id: string;
  claim: string;
  /** Gold label. */
  label: Verdict;
  source: ItemSource;
  split: Split;
  /** For FEVER: the Wikipedia pages its annotators cited (2017 dump titles, normalised). */
  evidence_pages?: string[];
  /** For generated claims: the true fact it was rewritten from, and why it is false. */
  original_fact?: string;
  rationale?: string;
  /** For generated claims: has a human spot-checked this item? */
  human_checked?: boolean;
  note?: string;
}

/** What a system returns for one claim. */
export interface SystemOutput {
  /** null when the output could not be parsed into one of the three labels. */
  verdict: Verdict | null;
  explanation?: string;
  /** Raw model text, kept so failures can be inspected. Trimmed to a sane length. */
  raw?: string;
  evidence?: Evidence[];
  /** System-specific numbers that let us re-score offline (for example MiniCheck's retrieval score). */
  extra?: Record<string, unknown>;
}

/** One scored row in a run file. */
export interface Prediction {
  id: string;
  claim: string;
  gold: Verdict;
  source: ItemSource;
  predicted: Verdict | null;
  correct: boolean;
  ms: number;
  error?: string;
  explanation?: string;
  raw?: string;
  /** Titles and revision ids only, to keep run files small. */
  evidence?: { page_title: string; revision_id: number; retrieval_score?: number }[];
  extra?: Record<string, unknown>;
}

export interface SystemInfo {
  /** Registry name, for example "no-rag". */
  name: string;
  /** Model tag, for example "qwen3.5:9b". */
  model?: string;
  /**
   * Model family, for example "qwen" or "claude". Used to stop a judge from marking
   * work produced by its own family.
   */
  family?: string;
  /** Everything else that changes the output (prompt version, thresholds, retrieval mode). */
  config: Record<string, unknown>;
}

export interface RunFile {
  run_id: string;
  started_at: string;
  finished_at: string;
  git_commit: string | null;
  system: SystemInfo;
  dataset: { path: string; sha256: string; split: Split; count: number };
  predictions: Prediction[];
}
