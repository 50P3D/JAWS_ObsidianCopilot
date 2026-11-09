# Evaluation run 20261109-093159_minicheck_bespoke-minicheck_dev

- System: `minicheck`, model `bespoke-minicheck` (family bespoke-minicheck)
- Config: `{"retrieval":"app (src/retrieval + query-rewrite retries)","retrieval_mode":"hybrid","top":3,"nei_threshold":0.5,"retries":3,"rewrite_model":"qwen3.5:9b","rewrite_family":"qwen","retry_rule":"search again after every No, stop at the first Yes; verdict replays the app loop","temperature":0}`
- Dataset: `eval/datasets/fever-dev.jsonl`, split **dev**, 50 claims, sha256 `ae4f0fbe0d1d`
- Git commit: `1e67a3f`
- Started 2026-11-09T09:31:59.043Z, finished 2026-11-09T10:19:39.356Z

## Results (all claims)

| Metric | Value | 95% interval |
|---|---|---|
| Macro-F1 (Supported, Refuted, NEI) | 0.462 | 0.368 to 0.540 |
| Accuracy | 58.0% | 44.0% to 72.0% |
| False-flag rate (true claims called Refuted) | 29.4% | |
| Miss rate (false claims not called Refuted) | 0.0% | |
| Invalid or failed outputs | 0 of 50 | |
| Latency per claim, median / p90 | 67601 ms / 113329 ms | |

Per label

| Gold label | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| Supported | 17 | 0.706 | 0.706 | 0.706 |
| Refuted | 17 | 0.515 | 1.000 | 0.680 |
| Not Enough Info | 16 | 0.000 | 0.000 | 0.000 |

Confusion matrix (rows are gold, columns are predicted)

| gold \ predicted | Supported | Refuted | NEI | Invalid |
|---|---|---|---|---|
| Supported | 12 | 5 | 0 | 0 |
| Refuted | 0 | 17 | 0 | 0 |
| NEI | 5 | 11 | 0 | 0 |

## Results: gold Supported and Refuted claims only

Drops the gold Not Enough Info claims (see the caveat on FEVER NEI below). Predictions are still three-way, so answering NEI here counts as wrong.

| Metric | Value | 95% interval |
|---|---|---|
| Macro-F1 (Supported, Refuted) | 0.850 | 0.706 to 0.969 |
| Accuracy | 85.3% | 73.5% to 97.1% |
| False-flag rate (true claims called Refuted) | 29.4% | |
| Miss rate (false claims not called Refuted) | 0.0% | |
| Invalid or failed outputs | 0 of 34 | |
| Latency per claim, median / p90 | 73432 ms / 97776 ms | |

Per label

| Gold label | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| Supported | 17 | 1.000 | 0.706 | 0.828 |
| Refuted | 17 | 0.773 | 1.000 | 0.872 |
| Not Enough Info | 0 | 0.000 | 0.000 | 0.000 |

Confusion matrix (rows are gold, columns are predicted)

| gold \ predicted | Supported | Refuted | NEI | Invalid |
|---|---|---|---|---|
| Supported | 12 | 5 | 0 | 0 |
| Refuted | 0 | 17 | 0 | 0 |
| NEI | 0 | 0 | 0 | 0 |

## Failures

- **fever-202447** gold NEI, predicted Refuted: "Tinker Tailor Soldier Spy stars Jonah Hill."
  - evidence pages: Tinker Tailor Soldier Spy, Tinker Tailor Soldier Spy, Tinker Tailor Soldier Spy
  - searches: "Tinker Tailor Soldier Spy stars Jonah Hill." (No, 0.78) used; "Tinker Tailor Soldier Spy cast" (No, 0.84); "Jonah Hill Tinker Tailor Soldier Spy role" (No, 0.63); "Tinker Tailor Soldier Spy cast list" (No, 0.79)
- **fever-139938** gold NEI, predicted Refuted: "Francis I of France was the first chimpanzee from the Angoulême branch."
  - evidence pages: Francis I of France, Francis I of France, Francis I of France
  - searches: "Francis I of France was the first chimpanzee from the Angoulême branch." (No, 0.86) used; "Francis I of France chimpanzee" (No, 0.86)
- **fever-140686** gold NEI, predicted Refuted: "Qui-Gon Jinn is portrayed by Johnny Depp."
  - evidence pages: Qui-Gon Jinn, Qui-Gon Jinn, List of Star Wars prequel trilogy characters
  - searches: "Qui-Gon Jinn is portrayed by Johnny Depp." (No, 0.80) used; "Qui-Gon Jinn actor" (No, 0.88)
- **fever-111170** gold NEI, predicted Refuted: "One of the founders of San Diego Comic-Con was Chevron."
  - evidence pages: Chevron Corporation, Chevron Corporation, Chevron Corporation
  - searches: "One of the founders of San Diego Comic-Con was Chevron." (No, 0.39); "Chevron founder San Diego Comic-Con" (No, 0.58) used
- **fever-117478** gold NEI, predicted Refuted: "Juventus F.C. began wearing a gold-and-blue home uniform in 1968."
  - evidence pages: Juventus FC, Juventus FC, Juventus FC
  - searches: "Juventus F.C. began wearing a gold-and-blue home uniform in 1968." (No, 0.70) used; "Juventus F.C. kit history 1968" (No, 0.65); "Juventus F.C. kit history" (No, 0.67)
- **fever-215229** gold NEI, predicted Refuted: "Dreamer (2005 film) is a Canadian drama film."
  - evidence pages: Dreamer (2005 film), Dreamer (2005 film), The Dreamers (2003 film)
  - searches: "Dreamer (2005 film) is a Canadian drama film." (No, 0.91) used; "Dreamer 2005 film country of origin" (No, 0.60); "Dreamer (2005 film) production country" (No, 0.79); "Dreamer (2005 film) genre" (No, 0.85)
- **fever-106173** gold NEI, predicted Refuted: "James Spader starred in Twilight."
  - evidence pages: James Spader, James Spader, James Spader
  - searches: "James Spader starred in Twilight." (No, 0.85) used; "James Spader Twilight role" (No, 0.61); "James Spader Twilight Saga" (No, 0.61); "James Spader Twilight cast" (No, 0.60)
- **fever-194895** gold NEI, predicted Refuted: "Stripes featured John Larroquette as Darth Vader."
  - evidence pages: Stripes (film), The White Stripes, The White Stripes
  - searches: "Stripes featured John Larroquette as Darth Vader." (No, 0.68) used; "Stripes film cast list" (No, 0.76); "John Larroquette role in Stripes" (No, 0.78); "John Larroquette character in Stripes" (No, 0.74)
- **fever-225270** gold NEI, predicted Refuted: "Brian De Palma was born in Taipei."
  - evidence pages: Brian De Palma, Brian De Palma, Brian De Palma filmography
  - searches: "Brian De Palma was born in Taipei." (No, 0.83) used; "Brian De Palma birthplace" (No, 0.85); "Brian De Palma birthplace New York" (No, 0.82); "Brian De Palma birthplace Taipei" (No, 0.77)
- **fever-131928** gold NEI, predicted Refuted: "The heart beats at a resting rate close to 72 licks per minute."
  - evidence pages: Hummingbird, Giraffe, Hummingbird
  - searches: "The heart beats at a resting rate close to 72 licks per minute." (No, 0.71) used; "human heart resting rate beats per minute" (No, 0.89)
- **fever-48654** gold NEI, predicted Refuted: "David Attenborough served as the program director for Disney."
  - evidence pages: David Attenborough, David Attenborough, David Attenborough
  - searches: "David Attenborough served as the program director for Disney." (No, 0.73) used; "David Attenborough Disney program director" (No, 0.70)
- **fever-149708** gold NEI, predicted Supported: "In March of 2012, The Raven (2012 film) came out in a sovereign country in western Europe."
  - evidence pages: The Raven (2012 film), The Raven (2012 film), The Raven (1963 film)
- **fever-72474** gold NEI, predicted Supported: "Muscarinic acetylcholine receptors form biological units."
  - evidence pages: Muscarinic acetylcholine receptor, Muscarinic acetylcholine receptor, Muscarinic acetylcholine receptor
- **fever-179006** gold NEI, predicted Supported: "Steve Ditko was a comic cartoonist."
  - evidence pages: Steve Ditko, Steve Ditko, Steve Ditko
- **fever-147784** gold NEI, predicted Supported: "Fred Seibert produces for satellite and cable television and the internet."
  - evidence pages: Fred Seibert, Fred Seibert, Fred Seibert
- **fever-71126** gold NEI, predicted Supported: "A View to a Kill is an action movie."
  - evidence pages: A View to a Kill, A View to a Kill, A View to a Kill
- **fever-21228** gold Supported, predicted Refuted: "There were 3,090,953 Mormon members in 1971."
  - evidence pages: The Church of Jesus Christ of Latter-day Saints, Mormons, The Church of Jesus Christ of Latter-day Saints
  - searches: "There were 3,090,953 Mormon members in 1971." (No, 0.68) used; "Mormon membership statistics 1971" (No, 0.68); "LDS Church membership 1971" (No, 0.76)
- **fever-111719** gold Supported, predicted Refuted: "Dakota Fanning models."
  - evidence pages: Dakota Fanning, Elle Fanning, Dakota Fanning
  - searches: "Dakota Fanning models." (No, 0.80) used; "Dakota Fanning modeling career" (No, 0.80); "Dakota Fanning fashion model" (No, 0.69)
- **fever-11554** gold Supported, predicted Refuted: "Pharrell Williams plays an instrument."
  - evidence pages: Pharrell Williams, Pharrell Williams, Pharrell Williams
  - searches: "Pharrell Williams plays an instrument." (No, 0.79) used; "Pharrell Williams instruments played" (Yes, 0.75)
- **fever-27403** gold Supported, predicted Refuted: "The Mormon population has been growing rapidly due to high birth and conversion rates."
  - evidence pages: Mormons, History of Nauvoo, Illinois, Mormons
  - searches: "The Mormon population has been growing rapidly due to high birth and conversion rates." (No, 0.63) used; "Mormon population growth trends" (No, 0.67); "Mormon birth rate decline" (No, 0.58)
- **fever-35575** gold Supported, predicted Refuted: "Tim Roth was not born on May 14th, 1961."
  - evidence pages: Tim Roth, Tim Roth, Tim Roth
  - searches: "Tim Roth was not born on May 14th, 1961." (No, 0.84) used; "Tim Roth birth date" (No, 0.71); "Tim Roth birth date Wikipedia" (No, 0.68)

## Caveats

- **Small sample.** The intervals above come from 2000 bootstrap resamples. With 50 claims, one claim moves accuracy by 2.0 points. Treat differences inside the interval as noise.
- **FEVER may be contaminated.** FEVER was published in 2018 from a 2017 Wikipedia dump and is almost certainly in the training data of current models. A high no-RAG score may be memory, not reasoning. Our own-notes and generated claims are the check on this.
- **FEVER "Not Enough Info" is about the 2017 dump, not the world.** Many NEI claims are plainly true or false to a reader (or to today's Wikipedia). A system that answers them correctly is scored as wrong. Read the NEI failures before blaming the model.
- **Wikipedia has changed since 2017.** Retrieval reads today's pages, so a few gold labels may no longer match the evidence.
