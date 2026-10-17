/**
 * Maintenance banner and inline issue tag classification (pure, no network).
 *
 * Input comes from `action=parse&oldid=<rev>&prop=categories|templates|wikitext`, so it describes
 * that exact revision. Names are compared after `normaliseName`, so letter case, underscores in
 * place of spaces and a leading `Template:` or `Category:` prefix do not matter.
 */

import type { BannerKind, MaintenanceSignal } from "./types";

/** Lower case, `_` to space, strip a leading `Template:` or `Category:`, collapse spaces, trim. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:template|category)\s*:\s*/, "")
    .trim();
}

export interface BannerRule {
  kind: BannerKind;
  /** Patterns tested against normalised category names. Anchored, so unrelated names do not match. */
  categories: RegExp[];
  /** Normalised template names (including common redirects). */
  templates: string[];
}

/**
 * One entry per banner kind. Order matters: a name is given the kind of the first rule it matches,
 * and `classifyMaintenance` reports kinds in this order.
 */
export const BANNER_RULES: readonly BannerRule[] = [
  {
    kind: "pov",
    categories: [/^all npov disputes$/, /^npov disputes from /],
    templates: ["pov", "npov", "pov section", "pov check", "pov dispute", "npov dispute", "neutrality"],
  },
  {
    kind: "disputed",
    categories: [/^all accuracy disputes$/, /^accuracy disputes from /],
    templates: ["disputed", "factual accuracy", "disputed section", "accuracy dispute"],
  },
  {
    kind: "unreferenced",
    categories: [/^all articles lacking sources$/, /^articles lacking sources from /],
    templates: ["unreferenced", "no sources", "unsourced", "unreferenced section"],
  },
  {
    kind: "more_citations",
    categories: [/^all articles needing additional references$/, /^articles needing additional references from /],
    templates: ["more citations needed", "refimprove", "more citations needed section", "citations needed", "improve references"],
  },
  {
    kind: "cleanup",
    categories: [
      /^all (?:articles|pages) needing cleanup$/,
      /^articles needing cleanup from /,
      /^(?:all |wikipedia )?articles with style issues(?: from |$)/,
    ],
    templates: ["cleanup", "essay-like", "tone", "copy edit", "cleanup rewrite", "advert"],
  },
  {
    kind: "current_event",
    categories: [],
    templates: ["current", "current event", "current events", "current related"],
  },
];

/** Inline issue tags and their redirects. Words may be separated by spaces or underscores. */
const INLINE_ALIASES = ["citation needed", "cn", "fact", "failed verification", "dubious", "clarification needed"];

const INLINE_RE = new RegExp(
  String.raw`\{\{\s*(?:template\s*:\s*)?(?:` +
    INLINE_ALIASES.map((a) => a.split(" ").join("[ _]+")).join("|") +
    String.raw`)\s*(?:\||\}\})`,
  "gi",
);

function kindForCategory(name: string): BannerKind | null {
  const n = normaliseName(name);
  for (const rule of BANNER_RULES) if (rule.categories.some((re) => re.test(n))) return rule.kind;
  return null;
}

function kindForTemplate(name: string): BannerKind | null {
  const n = normaliseName(name);
  for (const rule of BANNER_RULES) if (rule.templates.includes(n)) return rule.kind;
  return null;
}

/** Counts inline issue tags such as `{{citation needed}}` or `{{cn|date=May 2024}}`. */
export function countInlineIssues(wikitext: string): number {
  return wikitext.match(INLINE_RE)?.length ?? 0;
}

/**
 * Returns the distinct banner kinds found in the categories or templates (in BANNER_RULES order)
 * and the number of inline issue tags in the wikitext.
 */
export function classifyMaintenance(categories: string[], templates: string[], wikitext: string): MaintenanceSignal {
  const found = new Set<BannerKind>();
  for (const c of categories) {
    const k = kindForCategory(c);
    if (k) found.add(k);
  }
  for (const t of templates) {
    const k = kindForTemplate(t);
    if (k) found.add(k);
  }
  return {
    banners: BANNER_RULES.map((r) => r.kind).filter((k) => found.has(k)),
    inlineIssues: countInlineIssues(wikitext),
  };
}
