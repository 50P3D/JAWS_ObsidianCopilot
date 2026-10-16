/**
 * NoteCheck Results sidebar panel.
 *
 * Extends Obsidian's `ItemView` to display fact-check results as a vertical
 * list of "claim cards". Each card shows the verdict, claim text, evidence,
 * reliability, and (when refuted) a suggested fix.
 *
 * The panel is opened by the `notecheck:fact-check-selection` command and
 * lives in the right sidebar so users can read results alongside their note.
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ClaimCard, Evidence, Verdict, ReliabilityBadge } from "../contract/claimCard.js";

/** Unique identifier for this view type, used when registering with Obsidian. */
export const VIEW_TYPE_NOTECHECK = "notecheck-results";

export class NoteCheckResultView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  // ── ItemView overrides ─────────────────────────────────────────

  getViewType(): string {
    return VIEW_TYPE_NOTECHECK;
  }

  getDisplayText(): string {
    return "NoteCheck Results";
  }

  getIcon(): string {
    return "check-circle";
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Replace the panel contents with a list of rendered claim cards.
   * Called by the plugin after a fact-check run completes.
   */
  renderCards(cards: ClaimCard[]): void {
    this.clear();
    const container = this.containerEl.children[1]; // Obsidian reserves [0] for the header

    if (cards.length === 0) {
      const empty = container.createEl("p", {
        text: "No claims found in the selected text.",
        cls: "notecheck-empty",
      });
      return;
    }

    for (const card of cards) {
      this.renderOneCard(container, card);
    }
  }

  /**
   * Show a loading spinner while the fact-check pipeline is running.
   */
  showLoading(): void {
    this.clear();
    const container = this.containerEl.children[1];

    const wrapper = container.createEl("div", { cls: "notecheck-loading" });
    wrapper.createEl("div", { cls: "notecheck-spinner" });
    wrapper.createEl("p", { text: "Checking claims against Wikipedia…" });
  }

  /**
   * Show an error message in the panel.
   */
  showError(message: string): void {
    this.clear();
    const container = this.containerEl.children[1];

    const wrapper = container.createEl("div", { cls: "notecheck-error" });
    wrapper.createEl("p", { text: `Error: ${message}` });
  }

  /**
   * Remove all child elements from the content area.
   */
  clear(): void {
    const container = this.containerEl.children[1];
    container.empty();
  }

  // ── Private rendering helpers ──────────────────────────────────

  /**
   * Render a single ClaimCard as a DOM subtree inside `parent`.
   */
  private renderOneCard(parent: Element, card: ClaimCard): void {
    const cardEl = parent.createEl("div", { cls: "notecheck-card" });

    // ── Verdict badge ──────────────────────────────────────────
    if (card.verdict) {
      const badgeCls = this.verdictClass(card.verdict);
      cardEl.createEl("span", {
        text: card.verdict,
        cls: `notecheck-verdict-badge ${badgeCls}`,
      });
    }

    // ── Claim text (bold) ──────────────────────────────────────
    cardEl.createEl("p", {
      text: card.claim,
      cls: "notecheck-claim-text",
    });

    // ── Original text (smaller, muted) ─────────────────────────
    if (card.original_text && card.original_text !== card.claim) {
      cardEl.createEl("p", {
        text: `Original: "${card.original_text}"`,
        cls: "notecheck-original-text",
      });
    }

    // ── Explanation ────────────────────────────────────────────
    if (card.explanation) {
      cardEl.createEl("p", {
        text: card.explanation,
        cls: "notecheck-explanation",
      });
    }

    // ── Suggested fix (only for Refuted verdicts) ──────────────
    if (card.verdict === "Refuted" && card.suggested_fix) {
      const fixEl = cardEl.createEl("div", { cls: "notecheck-suggested-fix" });
      fixEl.createEl("strong", { text: "Suggested fix: " });
      fixEl.createEl("span", { text: card.suggested_fix });
    }

    // ── Evidence section (collapsible) ─────────────────────────
    if (card.evidence && card.evidence.length > 0) {
      this.renderEvidenceSection(cardEl, card.evidence);
    }

    // ── Reliability badge ──────────────────────────────────────
    if (card.reliability) {
      this.renderReliability(cardEl, card.reliability.badge, card.reliability.reasons);
    }
  }

  /**
   * Render an expandable evidence section using <details>/<summary>.
   */
  private renderEvidenceSection(parent: Element, evidenceList: Evidence[]): void {
    const details = parent.createEl("details", { cls: "notecheck-evidence-section" });
    details.createEl("summary", {
      text: `Evidence (${evidenceList.length} passage${evidenceList.length > 1 ? "s" : ""})`,
    });

    for (const ev of evidenceList) {
      const item = details.createEl("div", { cls: "notecheck-evidence-item" });

      // Passage text
      item.createEl("blockquote", {
        text: ev.passage,
        cls: "notecheck-evidence-passage",
      });

      // Metadata line
      const meta = item.createEl("div", { cls: "notecheck-evidence-meta" });

      meta.createEl("span", {
        text: ev.page_title,
        cls: "notecheck-evidence-title",
      });

      if (ev.section) {
        meta.createEl("span", { text: ` § ${ev.section}` });
      }

      if (ev.retrieval_score !== undefined) {
        meta.createEl("span", {
          text: ` (score: ${ev.retrieval_score.toFixed(2)})`,
          cls: "notecheck-evidence-score",
        });
      }

      // Clickable link to the exact Wikipedia revision
      const link = item.createEl("a", {
        text: "View on Wikipedia →",
        href: ev.url,
        cls: "notecheck-evidence-link",
      });
      link.setAttr("target", "_blank");
      link.setAttr("rel", "noopener noreferrer");
    }
  }

  /**
   * Render a reliability badge (colored pill) and the list of reasons.
   */
  private renderReliability(parent: Element, badge: ReliabilityBadge, reasons: string[]): void {
    const wrapper = parent.createEl("div", { cls: "notecheck-reliability" });

    const badgeCls = this.reliabilityClass(badge);
    wrapper.createEl("span", {
      text: `Reliability: ${badge}`,
      cls: `notecheck-reliability-badge ${badgeCls}`,
    });

    if (reasons.length > 0) {
      const list = wrapper.createEl("ul", { cls: "notecheck-reliability-reasons" });
      for (const reason of reasons) {
        list.createEl("li", { text: reason });
      }
    }
  }

  // ── CSS class helpers ──────────────────────────────────────────

  /** Map a verdict to its colour class. */
  private verdictClass(verdict: Verdict): string {
    switch (verdict) {
      case "Supported":
        return "notecheck-verdict-supported";
      case "Refuted":
        return "notecheck-verdict-refuted";
      case "Not Enough Info":
        return "notecheck-verdict-nei";
    }
  }

  /** Map a reliability badge to its colour class. */
  private reliabilityClass(badge: ReliabilityBadge): string {
    switch (badge) {
      case "High":
        return "notecheck-badge-high";
      case "Medium":
        return "notecheck-badge-medium";
      case "Low":
        return "notecheck-badge-low";
    }
  }
}
