PS C:\Users\User\Documents\Code\JAWS_ObsidianCopilot\src\llm> npx tsx smokeVerify.ts        

=== example: supported PASS
expected: Supported  got: Supported
  why: The passage explicitly states that in 2006, the International Astronomical Union reclassified Pluto as a dwarf planet.

=== example: refuted PASS
expected: Refuted  got: Refuted
  why: The passage states that the Treaty of Versailles was signed on 28 June 1919, which contradicts the claim that it was signed in 1920.

=== example: not-enough-info PASS
expected: Not Enough Info  got: Not Enough Info
  why: The provided passage states that Marie Curie was a physicist and chemist but does not mention her personal preferences or favourite colours.

=== paraphrase PASS
expected: Supported  got: Supported
  why: The passage states that at standard atmospheric pressure, which corresponds to sea level, the boiling point of water is 100 °C.

=== off-topic evidence PASS
expected: Not Enough Info  got: Not Enough Info
  why: The provided passage only states that Pierre Curie was a French physicist born in Paris; it does not mention Marie Curie or any Nobel Prizes.

5/5 correct on qwen3.5:4b