/**
 * Claim extraction: note text in, claim cards out.
 * Stage 1 (preprocess) is plain code. Stages 2 and 3 (split into atomic claims,
 * drop uncheckable ones, rewrite each to stand alone) are one LLM call.
 */

import type { ClaimCard, FactCheckRequest } from "../contract/claimCard";
import { chatJson, type LlmOptions } from "./ollama";

/**
 * Stage 1: clean the note before the LLM sees it. Frontmatter is removed.
 * Code and maths become [code] and [formula] placeholders rather than being deleted,
 * so sentences are not left with holes the model tries to fill in.
 * Wikilinks keep their text as context.
 */
export function preprocess(text: string): string {
  return text
    .replace(/\r\n/g, "\n") // Windows line endings
    .replace(/^---\n[\s\S]*?\n---\n?/, "") // frontmatter at the top of the note
    .replace(/```[\s\S]*?```/g, "[code]") // code blocks
    .replace(/`[^`\n]+`/g, "[code]") // inline code
    .replace(/\$\$[\s\S]*?\$\$/g, "[formula]") // block maths
    .replace(/\$(?=\S)[^$\n]*?\S\$(?!\d)/g, "[formula]") // inline maths, but not prices like $5 and $10
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[Page|label]] becomes label
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[Page]] becomes Page
    .trim();
}

// Stage 2 and 3: extract atomic claims, drop uncheckable ones, rewrite each to stand alone
const SYSTEM = `You extract checkable factual claims from a student's notes.

Rules:
- Split sentences into atomic claims, one fact each. "Einstein was born in 1879 in Ulm" becomes two claims.
- Keep only claims Wikipedia could confirm or deny: dates, places, people, numbers, events, definitions.
- Skip opinions, to-do items, questions, instructions, and anything specific to a course or lecturer.
- Rewrite each claim so it makes sense alone. Replace "he", "it", "the treaty" and similar with full names, using the note title and headings for context.
- Never correct or add facts. Keep the claim's meaning exactly, even if you think it is wrong.
- original_text is the sentence the claim came from, copied exactly from the note.
- [code] and [formula] mark removed code and maths. Skip any claim that is only about a placeholder, and never guess what it contained.
- If there are no checkable claims, return an empty list.`;

// The schema for the expected output from the LLM
const SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: { original_text: { type: "string" }, claim: { type: "string" } },
        required: ["original_text", "claim"],
      },
    },
  },
  required: ["claims"],
};

// The result type from the LLM call
interface ExtractResult {
  claims: { original_text: string; claim: string }[];
}

// The main function to extract claims from a note text
export async function extractClaims(request: FactCheckRequest, opts: LlmOptions = {}): Promise<ClaimCard[]> {
  const text = preprocess(request.text);
  // If the preprocessed text is empty, return an empty array of claims
  if (!text) return [];

  const user = [
    `Note title: ${request.note_title ?? "(none)"}`,
    `Headings: ${request.headings?.join(" > ") || "(none)"}`,
    "",
    'Note text:\n"""',
    text,
    '"""',
  ].join("\n");

  const out = await chatJson<ExtractResult>(SYSTEM, user, SCHEMA, opts);

  return (out.claims ?? [])
    .filter((c) => c.claim?.trim())
    .map((c, i) => {
      // find the sentence in the original note so the plugin can point back to it
      const start = request.text.indexOf(c.original_text);
      return {
        claim_id: `c${i + 1}`,
        original_text: c.original_text,
        claim: c.claim.trim(),
        source_span: start >= 0 ? { start, end: start + c.original_text.length } : undefined,
      };
    });
}