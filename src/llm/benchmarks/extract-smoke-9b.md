using the 9b model instead.
At first it added its own knowledge for pythagorean theorem. 
After changing code and formula to be placeholders, it seems to pass the test.

PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> $env:OLLAMA_MODEL="qwen3.5:9b"
PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> npx tsx smokeExtract.ts

=== maths
expected: Pythagoras claim kept, 'It' becomes the Pythagorean theorem, the formula dropped
  c1: The Pythagorean theorem states that .
  c2: The Pythagorean theorem is named after Pythagoras.
  c3: Pythagoras was a Greek philosopher.

=== code
expected: only the Python history claims, nothing from inside the code
  c1: Guido van Rossum created Python.
  c2: Python was first released in 1991.

=== frontmatter + wikilinks
expected: Napoleon crowned Emperor in 1804
  c1: Napoleon was crowned Emperor of the French in 1804.

=== pronoun from title
expected: 'He' becomes Winston Churchill
  c1: Winston Churchill was Prime Minister of the United Kingdom during the Second World War.

=== wrong fact kept as is
expected: claim still says 1920, not corrected
  c1: The Treaty of Versailles was signed in 1920.

=== nothing checkable
expected: empty list
  (no claims)

===================================================
SECOND TRY
PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> $env:OLLAMA_MODEL="qwen3.5:9b"
PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> npx tsx smokeExtract.ts       

=== maths
expected: Pythagoras claim kept, 'It' becomes the Pythagorean theorem, the formula dropped
  c1: The Pythagorean theorem states that [formula].
  c2: The Pythagorean theorem is named after Pythagoras.
  c3: Pythagoras was a Greek philosopher.

=== code
expected: only the Python history claims, nothing from inside the code
  c1: Python was created by Guido van Rossum.
  c2: Python was first released in 1991.

=== frontmatter + wikilinks
expected: Napoleon crowned Emperor in 1804
  c1: Napoleon was crowned Emperor of the French in 1804.

=== pronoun from title
expected: 'He' becomes Winston Churchill
  c1: Winston Churchill was Prime Minister of the United Kingdom during the Second World War.

=== wrong fact kept as is
expected: claim still says 1920, not corrected
  c1: The Treaty of Versailles was signed in 1920.

=== nothing checkable
expected: empty list
  (no claims)