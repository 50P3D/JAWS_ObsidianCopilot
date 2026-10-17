/**
 * Git helpers shared by the eval runners (`run.ts`, `reliabilityRun.ts`).
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Short commit sha of the repo HEAD, with a `-dirty` suffix when the working tree has
 * uncommitted changes. Returns null when git is unavailable or this is not a repo.
 */
export function gitCommit(): string | null {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}
