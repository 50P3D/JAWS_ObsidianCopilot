using qwen 3.5 4b 17/10/2026
seems to "add" its own knowledge of pythageorean theorem

PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> npx tsx smokeExtract.ts

=== maths
expected: Pythagoras claim kept, 'It' becomes the Pythagorean theorem, the formula dropped
  c1: The Pythagorean theorem states that the square of the hypotenuse of a right triangle is equal to the sum of the squares of the other two sides.
  c2: The Pythagorean theorem is named after Pythagoras, a Greek philosopher.

=== code
expected: only the Python history claims, nothing from inside the code
  c1: Guido van Rossum created Python.
  c2: Python was first released in 1991.

=== frontmatter + wikilinks
expected: Napoleon crowned Emperor in 1804
  c1: Napoleon Bonaparte was crowned Emperor of the French in 1804.

=== pronoun from title
expected: 'He' becomes Winston Churchill
  c1: Winston Churchill was Prime Minister of the United Kingdom during the Second World War.

=== wrong fact kept as is
expected: claim still says 1920, not corrected
  c1: The Treaty of Versailles was signed in 1920.

=== nothing checkable
expected: empty list
  (no claims)

==============================================
second try
PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> npx tsx smokeExtract.ts

=== maths
expected: Pythagoras claim kept, 'It' becomes the Pythagorean theorem, the formula dropped
  c1: The Pythagorean theorem states that the square of the hypotenuse of a right triangle is equal to the sum of the squares of the other two sides.
  c2: The Pythagorean theorem is named after Pythagoras, a Greek philosopher.

=== code
expected: only the Python history claims, nothing from inside the code
  c1: Guido van Rossum created Python.
  c2: Python was first released in 1991.

=== frontmatter + wikilinks
expected: Napoleon crowned Emperor in 1804
  c1: Napoleon Bonaparte was crowned Emperor of the French in 1804.

=== pronoun from title
expected: 'He' becomes Winston Churchill
  c1: Winston Churchill was Prime Minister of the United Kingdom during the Second World War.

=== wrong fact kept as is
expected: claim still says 1920, not corrected
  c1: The Treaty of Versailles was signed in 1920.

=== nothing checkable
expected: empty list
  (no claims)