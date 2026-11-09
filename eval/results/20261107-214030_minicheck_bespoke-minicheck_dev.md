# Evaluation run 20261107-214030_minicheck_bespoke-minicheck_dev

- System: `minicheck`, model `bespoke-minicheck` (family bespoke-minicheck)
- Config: `{"retrieval_mode":"hybrid","top":3,"nei_threshold":0.5,"temperature":0}`
- Dataset: `eval/datasets/fever-dev.jsonl`, split **dev**, 50 claims, sha256 `ae4f0fbe0d1d`
- Git commit: `0a72f74`
- Started 2026-11-07T21:40:30.900Z, finished 2026-11-07T21:42:48.401Z

## Results (all claims)

| Metric | Value | 95% interval |
|---|---|---|
| Macro-F1 (Supported, Refuted, NEI) | 0.497 | 0.381 to 0.615 |
| Accuracy | 58.0% | 44.0% to 72.0% |
| False-flag rate (true claims called Refuted) | 35.3% | |
| Miss rate (false claims not called Refuted) | 0.0% | |
| Invalid or failed outputs | 0 of 50 | |
| Latency per claim, median / p90 | 2535 ms / 3821 ms | |

Per label

| Gold label | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| Supported | 17 | 0.846 | 0.647 | 0.733 |
| Refuted | 17 | 0.472 | 1.000 | 0.642 |
| Not Enough Info | 16 | 1.000 | 0.063 | 0.118 |

Confusion matrix (rows are gold, columns are predicted)

| gold \ predicted | Supported | Refuted | NEI | Invalid |
|---|---|---|---|---|
| Supported | 11 | 6 | 0 | 0 |
| Refuted | 0 | 17 | 0 | 0 |
| NEI | 2 | 13 | 1 | 0 |

## Results: gold Supported and Refuted claims only

Drops the gold Not Enough Info claims (see the caveat on FEVER NEI below). Predictions are still three-way, so answering NEI here counts as wrong.

| Metric | Value | 95% interval |
|---|---|---|
| Macro-F1 (Supported, Refuted) | 0.818 | 0.671 to 0.940 |
| Accuracy | 82.4% | 70.6% to 94.1% |
| False-flag rate (true claims called Refuted) | 35.3% | |
| Miss rate (false claims not called Refuted) | 0.0% | |
| Invalid or failed outputs | 0 of 34 | |
| Latency per claim, median / p90 | 2535 ms / 3522 ms | |

Per label

| Gold label | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| Supported | 17 | 1.000 | 0.647 | 0.786 |
| Refuted | 17 | 0.739 | 1.000 | 0.850 |
| Not Enough Info | 0 | 0.000 | 0.000 | 0.000 |

Confusion matrix (rows are gold, columns are predicted)

| gold \ predicted | Supported | Refuted | NEI | Invalid |
|---|---|---|---|---|
| Supported | 11 | 6 | 0 | 0 |
| Refuted | 0 | 17 | 0 | 0 |
| NEI | 0 | 0 | 0 | 0 |

## Failures

- **fever-202447** gold NEI, predicted Refuted: "Tinker Tailor Soldier Spy stars Jonah Hill."
  - evidence pages: Tinker Tailor Soldier Spy, Tinker Tailor Soldier Spy, Tinker Tailor Soldier Spy
- **fever-139938** gold NEI, predicted Refuted: "Francis I of France was the first chimpanzee from the Angoulême branch."
  - evidence pages: Francis I of France, Francis I of France, Francis I of France
- **fever-149708** gold NEI, predicted Refuted: "In March of 2012, The Raven (2012 film) came out in a sovereign country in western Europe."
  - evidence pages: March, March and March, March
- **fever-140686** gold NEI, predicted Refuted: "Qui-Gon Jinn is portrayed by Johnny Depp."
  - evidence pages: Qui-Gon Jinn, Qui-Gon Jinn, List of Star Wars prequel trilogy characters
- **fever-117478** gold NEI, predicted Refuted: "Juventus F.C. began wearing a gold-and-blue home uniform in 1968."
  - evidence pages: Juventus FC, Juventus FC, Juventus FC
- **fever-215229** gold NEI, predicted Refuted: "Dreamer (2005 film) is a Canadian drama film."
  - evidence pages: Tommy Dreamer, Tommy Dreamer, Tommy Dreamer
- **fever-106173** gold NEI, predicted Refuted: "James Spader starred in Twilight."
  - evidence pages: James Spader, James Spader, James Spader
- **fever-147784** gold NEI, predicted Refuted: "Fred Seibert produces for satellite and cable television and the internet."
  - evidence pages: Fred Seibert, Fred Seibert, Fred Seibert
- **fever-71126** gold NEI, predicted Refuted: "A View to a Kill is an action movie."
  - evidence pages: The View, The View, The View
- **fever-194895** gold NEI, predicted Refuted: "Stripes featured John Larroquette as Darth Vader."
  - evidence pages: Stripes (film), The White Stripes, The White Stripes
- **fever-225270** gold NEI, predicted Refuted: "Brian De Palma was born in Taipei."
  - evidence pages: Brian De Palma, Brian De Palma, Brian De Palma filmography
- **fever-131928** gold NEI, predicted Refuted: "The heart beats at a resting rate close to 72 licks per minute."
  - evidence pages: Hummingbird, Hummingbird, Hummingbird
- **fever-48654** gold NEI, predicted Refuted: "David Attenborough served as the program director for Disney."
  - evidence pages: David Attenborough, David Attenborough, David Attenborough
- **fever-72474** gold NEI, predicted Supported: "Muscarinic acetylcholine receptors form biological units."
  - evidence pages: Muscarinic acetylcholine receptor, Muscarinic acetylcholine receptor, Muscarinic acetylcholine receptor
- **fever-179006** gold NEI, predicted Supported: "Steve Ditko was a comic cartoonist."
  - evidence pages: Steve Ditko, Steve Ditko, Steve Ditko
- **fever-21228** gold Supported, predicted Refuted: "There were 3,090,953 Mormon members in 1971."
  - evidence pages: Who Goes There?, Hey There Delilah, Who Goes There?
- **fever-111719** gold Supported, predicted Refuted: "Dakota Fanning models."
  - evidence pages: Dakota Fanning, Elle Fanning, Dakota Fanning
- **fever-177186** gold Supported, predicted Refuted: "Dub music is a genre of music that grew out of reggae."
  - evidence pages: Rub-a-dub-dub, Rub-a-dub-dub, Dubbing
- **fever-11554** gold Supported, predicted Refuted: "Pharrell Williams plays an instrument."
  - evidence pages: Pharrell Williams, Pharrell Williams, Pharrell Williams
- **fever-27403** gold Supported, predicted Refuted: "The Mormon population has been growing rapidly due to high birth and conversion rates."
  - evidence pages: The Church of Jesus Christ of Latter-day Saints, Mormons, The Church of Jesus Christ of Latter-day Saints
- **fever-35575** gold Supported, predicted Refuted: "Tim Roth was not born on May 14th, 1961."
  - evidence pages: Tim Roth, Tim Roth, Tim Roth

## Caveats

- **Small sample.** The intervals above come from 2000 bootstrap resamples. With 50 claims, one claim moves accuracy by 2.0 points. Treat differences inside the interval as noise.
- **FEVER may be contaminated.** FEVER was published in 2018 from a 2017 Wikipedia dump and is almost certainly in the training data of current models. A high no-RAG score may be memory, not reasoning. Our own-notes and generated claims are the check on this.
- **FEVER "Not Enough Info" is about the 2017 dump, not the world.** Many NEI claims are plainly true or false to a reader (or to today's Wikipedia). A system that answers them correctly is scored as wrong. Read the NEI failures before blaming the model.
- **Wikipedia has changed since 2017.** Retrieval reads today's pages, so a few gold labels may no longer match the evidence.
