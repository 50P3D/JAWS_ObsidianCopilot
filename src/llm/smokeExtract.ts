import { extractClaims } from "./extract";

const cases = [
  { name: "maths", expect: "Pythagoras claim kept, 'It' becomes the Pythagorean theorem, the formula dropped",
    req: { text: "The Pythagorean theorem states that $a^2 + b^2 = c^2$. It is named after Pythagoras, a Greek philosopher.", note_title: "Geometry" } },
  { name: "code", expect: "only the Python history claims, nothing from inside the code",
    req: { text: "Python was created by Guido van Rossum and first released in 1991.\n```python\nx = 1879  # Einstein born\n```", note_title: "Programming" } },
  { name: "frontmatter + wikilinks", expect: "Napoleon crowned Emperor in 1804",
    req: { text: "---\ntags: history\n---\n[[Napoleon Bonaparte|Napoleon]] was crowned Emperor of the French in 1804." } },
  { name: "pronoun from title", expect: "'He' becomes Winston Churchill",
    req: { text: "He was Prime Minister of the United Kingdom during the Second World War.", note_title: "Winston Churchill", headings: ["Biography"] } },
  { name: "wrong fact kept as is", expect: "claim still says 1920, not corrected",
    req: { text: "The Treaty of Versailles was signed in 1920." } },
  { name: "nothing checkable", expect: "empty list",
    req: { text: "I love this topic. Remember to email Prof Tan about the quiz. What should I revise next?" } },
];

// Run the test cases
for (const c of cases) {
  const cards = await extractClaims(c.req);
  console.log(`\n=== ${c.name}\nexpected: ${c.expect}`);
  for (const card of cards) console.log(`  ${card.claim_id}: ${card.claim}`);
  // If there are no claims, log that as well
  if (cards.length === 0) console.log("  (no claims)");
}