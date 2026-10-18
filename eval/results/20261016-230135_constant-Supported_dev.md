# Evaluation run 20261016-230135_constant-Supported_dev

- System: `constant:Supported`
- Config: `{"verdict":"Supported"}`
- Dataset: `eval/datasets/fever-dev.jsonl`, split **dev**, 50 claims, sha256 `db675a5cad9c`
- Git commit: `f2b7937-dirty`
- Started 2026-10-16T23:01:35.077Z, finished 2026-10-16T23:01:35.090Z

## Results (all claims)

| Metric | Value | 95% interval |
|---|---|---|
| Macro-F1 (Supported, Refuted, NEI) | 0.169 | 0.120 to 0.216 |
| Accuracy | 34.0% | 22.0% to 48.0% |
| False-flag rate (true claims called Refuted) | 0.0% | |
| Miss rate (false claims not called Refuted) | 100.0% | |
| Invalid or failed outputs | 0 of 50 | |
| Latency per claim, median / p90 | 0 ms / 0 ms | |

Per label

| Gold label | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| Supported | 17 | 0.340 | 1.000 | 0.507 |
| Refuted | 17 | 0.000 | 0.000 | 0.000 |
| Not Enough Info | 16 | 0.000 | 0.000 | 0.000 |

Confusion matrix (rows are gold, columns are predicted)

| gold \ predicted | Supported | Refuted | NEI | Invalid |
|---|---|---|---|---|
| Supported | 17 | 0 | 0 | 0 |
| Refuted | 17 | 0 | 0 | 0 |
| NEI | 16 | 0 | 0 | 0 |

## Results: gold Supported and Refuted claims only

Drops the gold Not Enough Info claims (see the caveat on FEVER NEI below). Predictions are still three-way, so answering NEI here counts as wrong.

| Metric | Value | 95% interval |
|---|---|---|
| Macro-F1 (Supported, Refuted) | 0.333 | 0.261 to 0.404 |
| Accuracy | 50.0% | 35.3% to 67.6% |
| False-flag rate (true claims called Refuted) | 0.0% | |
| Miss rate (false claims not called Refuted) | 100.0% | |
| Invalid or failed outputs | 0 of 34 | |
| Latency per claim, median / p90 | 0 ms / 0 ms | |

Per label

| Gold label | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| Supported | 17 | 0.500 | 1.000 | 0.667 |
| Refuted | 17 | 0.000 | 0.000 | 0.000 |
| Not Enough Info | 0 | 0.000 | 0.000 | 0.000 |

Confusion matrix (rows are gold, columns are predicted)

| gold \ predicted | Supported | Refuted | NEI | Invalid |
|---|---|---|---|---|
| Supported | 17 | 0 | 0 | 0 |
| Refuted | 17 | 0 | 0 | 0 |
| NEI | 0 | 0 | 0 | 0 |

## Failures

- **fever-202447** gold NEI, predicted Supported: "Tinker Tailor Soldier Spy stars Jonah Hill."
- **fever-139938** gold NEI, predicted Supported: "Francis I of France was the first chimpanzee from the Angoulême branch."
- **fever-149708** gold NEI, predicted Supported: "In March of 2012, The Raven (2012 film) came out in a sovereign country in western Europe."
- **fever-140686** gold NEI, predicted Supported: "Qui-Gon Jinn is portrayed by Johnny Depp."
- **fever-111170** gold NEI, predicted Supported: "One of the founders of San Diego Comic-Con was Chevron."
- **fever-72474** gold NEI, predicted Supported: "Muscarinic acetylcholine receptors form biological units."
- **fever-117478** gold NEI, predicted Supported: "Juventus F.C. began wearing a gold-and-blue home uniform in 1968."
- **fever-215229** gold NEI, predicted Supported: "Dreamer (2005 film) is a Canadian drama film."
- **fever-106173** gold NEI, predicted Supported: "James Spader starred in Twilight."
- **fever-179006** gold NEI, predicted Supported: "Steve Ditko was a comic cartoonist."
- **fever-147784** gold NEI, predicted Supported: "Fred Seibert produces for satellite and cable television and the internet."
- **fever-71126** gold NEI, predicted Supported: "A View to a Kill is an action movie."
- **fever-194895** gold NEI, predicted Supported: "Stripes featured John Larroquette as Darth Vader."
- **fever-225270** gold NEI, predicted Supported: "Brian De Palma was born in Taipei."
- **fever-131928** gold NEI, predicted Supported: "The heart beats at a resting rate close to 72 licks per minute."
- **fever-48654** gold NEI, predicted Supported: "David Attenborough served as the program director for Disney."
- **fever-204331** gold Refuted, predicted Supported: "The Cretaceous is a Paleogene extinction event."
- **fever-94603** gold Refuted, predicted Supported: "Gal Gadot was ranked ahead of Bar Rafaeli for highest earning actress/models in Israel."
- **fever-182279** gold Refuted, predicted Supported: "Saturn Corporation was established in April."
- **fever-173495** gold Refuted, predicted Supported: "Sancho Panza is a fictional character in a novel written by an Australian writer born in 1616."
- **fever-141812** gold Refuted, predicted Supported: "The Hunger Games are based on a play."
- **fever-32970** gold Refuted, predicted Supported: "Tremont Street Subway is a bridge."
- **fever-73121** gold Refuted, predicted Supported: "Shortness of breath is not one symptom of pulmonary embolism."
- **fever-10052** gold Refuted, predicted Supported: "Stomp the Yard is a clothing brand."
- **fever-110571** gold Refuted, predicted Supported: "Dev Patel starred in Chappie, an animated movie."
- **fever-63527** gold Refuted, predicted Supported: "The 100 is a music video following a group of teens."
- **fever-18037** gold Refuted, predicted Supported: "Global warming effects all regions in exactly the same way."
- **fever-198421** gold Refuted, predicted Supported: "Arthur Schopenhauer died in 1788."
- **fever-46065** gold Refuted, predicted Supported: "The NAACP Image Award for Outstanding Supporting Actor in a Drama Series was last given in 1995."
- **fever-157641** gold Refuted, predicted Supported: "Janet Leigh was incapable of acting."
- **fever-217194** gold Refuted, predicted Supported: "A monk completely avoids practicing a lifestyle characterized by abstinence from worldly pleasures."
- **fever-78985** gold Refuted, predicted Supported: "Stomp the Yard stars a cat."
- **fever-130108** gold Refuted, predicted Supported: "Shomu Mukherjee was born on April 10, 2008."

## Caveats

- **Small sample.** The intervals above come from 2000 bootstrap resamples. With 50 claims, one claim moves accuracy by 2.0 points. Treat differences inside the interval as noise.
- **FEVER may be contaminated.** FEVER was published in 2018 from a 2017 Wikipedia dump and is almost certainly in the training data of current models. A high no-RAG score may be memory, not reasoning. Our own-notes and generated claims are the check on this.
- **FEVER "Not Enough Info" is about the 2017 dump, not the world.** Many NEI claims are plainly true or false to a reader (or to today's Wikipedia). A system that answers them correctly is scored as wrong. Read the NEI failures before blaming the model.
- **Wikipedia has changed since 2017.** Retrieval reads today's pages, so a few gold labels may no longer match the evidence.
