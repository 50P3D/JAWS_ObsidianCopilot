=== example: supported PASS
expected: Supported  got: Supported
  why: Passage [1] explicitly states that in 2006, the International Astronomical Union reclassified Pluto as a dwarf planet.

=== example: refuted PASS
expected: Refuted  got: Refuted
  why: The passage states that the Treaty of Versailles was signed on 28 June 1919, not 1920.

=== example: not-enough-info PASS
expected: Not Enough Info  got: Not Enough Info
  why: The passage states that Marie Curie was a physicist and chemist but does not mention her favourite colour.

=== paraphrase PASS
expected: Supported  got: Supported
  why: The passage states that at standard atmospheric pressure (which corresponds to sea level), the boiling point of water is 100 °C.

=== off-topic evidence PASS
expected: Not Enough Info  got: Not Enough Info
  why: The provided passage only mentions Pierre Curie and his birth; it does not contain any information about Marie Curie or her Nobel Prizes.

5/5 correct on qwen3.5:9b