import type { App } from "obsidian";
import type { Evidence } from "../contract/claimCard";

/** Open course evidence at its indexed heading, or open external evidence in a browser. */
export function openEvidence(app: App, evidence: Evidence): void {
  if (evidence.source !== "course") {
    window.open(evidence.url, "_blank", "noopener,noreferrer");
    return;
  }

  const openState = evidence.section
    ? { eState: { subpath: `#${evidence.section}` } }
    : undefined;
  void app.workspace.openLinkText(evidence.url, "", true, openState).catch((err: unknown) => {
    console.error("[NoteCheck] Could not open course evidence:", err);
  });
}
