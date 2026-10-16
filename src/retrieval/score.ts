/**
 * Keyword helpers: cheap word matching used to pick candidate passages
 * and to choose which sentence to highlight.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "from", "by", "with",
  "as", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these",
  "those", "he", "she", "they", "his", "her", "their", "has", "have", "had", "do", "does", "did",
  "not", "no", "so", "than", "then", "also", "which", "who", "whom", "what", "when", "where",
]);

/** Lowercase words and numbers from a text, without stopwords. */
export function tokens(text: string): string[] {
  const all = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return all.filter((t) => !STOPWORDS.has(t));
}

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/;

/**
 * Share of the claim's distinct words that appear in the passage (0 to 1).
 * If the claim mentions a year, a passage that mentions any year gets a small bonus.
 * That helps a passage with a conflicting date (1919 against 1920) stay in the running,
 * so the verifier can see the contradiction.
 */
export function keywordScore(claim: string, passage: string): number {
  const claimTokens = [...new Set(tokens(claim))];
  if (claimTokens.length === 0) return 0;
  const passageTokens = new Set(tokens(passage));
  let hits = 0;
  for (const t of claimTokens) if (passageTokens.has(t)) hits += 1;
  let score = hits / claimTokens.length;
  if (YEAR.test(claim) && YEAR.test(passage)) score = Math.min(1, score + 0.1);
  return score;
}

/** Cosine similarity of two equal-length vectors (1 means same direction). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
