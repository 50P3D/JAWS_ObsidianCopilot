# Reliability evaluation run 20261017-185921_reliability-flag-nothing_dev

- System: `flag-nothing`, Lift Wing off
- Dataset: `eval/datasets/reliability-dev.jsonl`, split **dev**, 40 revisions, sha256 `0dbe65fd4da5`
- Git commit: `9013bb2-dirty`
- Started 2026-10-17T18:59:21.696Z, finished 2026-10-17T18:59:21.706Z

## Low flag against "was reverted"

| Metric | Value | 95% interval |
|---|---|---|
| Precision (Low flags that were reverted) | 0.000 | 0.000 to 0.000 |
| Recall (reverted revisions flagged Low) | 0.000 | 0.000 to 0.000 |
| F1 | 0.000 | 0.000 to 0.000 |
| Flag rate (share of revisions flagged Low) | 0.0% | 0.0% to 0.0% |
| Revisions (reverted / stable) | 40 (20 / 20) | |
| Errors (counted as not flagged) | 0 of 40 | |
| Latency per revision, median / p90 | 0 ms / 0 ms | |

Confusion counts (positive = reverted / flagged Low)

| gold \ predicted | Low | not Low |
|---|---|---|
| reverted | TP 0 | FN 20 |
| stable | FP 0 | TN 20 |

## Rule firing counts

No rule fired on any revision.

## Unavailable signals

No signals were recorded for this system.

## Errors

None.

## False positives (flagged Low, not reverted)

None.

## False negatives (reverted, not flagged Low)

- **rev-1380746986** [Rara National Park](https://en.wikipedia.org/w/index.php?oldid=1380746986), badge High
  - Baseline: no revision is ever flagged
- **rev-1380683364** [Something Special (TV series)](https://en.wikipedia.org/w/index.php?oldid=1380683364), badge High
  - Baseline: no revision is ever flagged
- **rev-1380748973** [Ottoman–Safavid War (1623–1639)](https://en.wikipedia.org/w/index.php?oldid=1380748973), badge High
  - Baseline: no revision is ever flagged
- **rev-1380749520** [Black Sun (symbol)](https://en.wikipedia.org/w/index.php?oldid=1380749520), badge High
  - Baseline: no revision is ever flagged
- **rev-1380720225** [Athletics at the World School Sport Games](https://en.wikipedia.org/w/index.php?oldid=1380720225), badge High
  - Baseline: no revision is ever flagged
- **rev-1380728891** [OsamaSon discography](https://en.wikipedia.org/w/index.php?oldid=1380728891), badge High
  - Baseline: no revision is ever flagged
- **rev-1380689181** [Mozeza Ashraf Monalisa](https://en.wikipedia.org/w/index.php?oldid=1380689181), badge High
  - Baseline: no revision is ever flagged
- **rev-1380724046** [Kingdom of Serbia](https://en.wikipedia.org/w/index.php?oldid=1380724046), badge High
  - Baseline: no revision is ever flagged
- **rev-1380762149** [Puberty blocker](https://en.wikipedia.org/w/index.php?oldid=1380762149), badge High
  - Baseline: no revision is ever flagged
- **rev-1380731812** [Pokémon Concierge](https://en.wikipedia.org/w/index.php?oldid=1380731812), badge High
  - Baseline: no revision is ever flagged
- **rev-1380758888** [Nikita Mears](https://en.wikipedia.org/w/index.php?oldid=1380758888), badge High
  - Baseline: no revision is ever flagged
- **rev-1380720183** [Miles Gloriosus (play)](https://en.wikipedia.org/w/index.php?oldid=1380720183), badge High
  - Baseline: no revision is ever flagged
- **rev-1380723636** [2026 UCI Track Cycling World Championships](https://en.wikipedia.org/w/index.php?oldid=1380723636), badge High
  - Baseline: no revision is ever flagged
- **rev-1380688315** [Oikophobia](https://en.wikipedia.org/w/index.php?oldid=1380688315), badge High
  - Baseline: no revision is ever flagged
- **rev-1380722189** [Peter Hänggi](https://en.wikipedia.org/w/index.php?oldid=1380722189), badge High
  - Baseline: no revision is ever flagged
- **rev-1380688874** [Rise and Fall (Indian TV series)](https://en.wikipedia.org/w/index.php?oldid=1380688874), badge High
  - Baseline: no revision is ever flagged
- **rev-1380699422** [Commitment scheme](https://en.wikipedia.org/w/index.php?oldid=1380699422), badge High
  - Baseline: no revision is ever flagged
- **rev-1380740686** [Buni](https://en.wikipedia.org/w/index.php?oldid=1380740686), badge High
  - Baseline: no revision is ever flagged
- **rev-1380691272** [WXMI](https://en.wikipedia.org/w/index.php?oldid=1380691272), badge High
  - Baseline: no revision is ever flagged
- **rev-1380754872** [Nazlı Ecevit](https://en.wikipedia.org/w/index.php?oldid=1380754872), badge High
  - Baseline: no revision is ever flagged

## Caveats

- **Small sample.** The intervals above come from 2000 bootstrap resamples (seed 201). With 40 revisions, one revision moves recall or precision by several points. Treat differences inside the interval as noise.
- **The gold label is incomplete.** `mw-reverted` only marks reverts that MediaWiki detects (rollback, undo, exact manual revert), so some "stable" edits may have been undone by hand.
- **Labels can change.** A stable edit could still be reverted after it was sampled.
- **Evaluation time is not live time.** The evaluation scores each edit as of its own save time, while live use scores the current revision. Recency signals therefore behave differently in the two settings. This does not affect the Low flag, because recency only produces Medium.
- **Lift Wing is a strong baseline.** Lift Wing is itself trained on revert data, so `revert-risk-only` is a strong baseline. The interesting question is whether the rules add precision or recall beyond it.
- **Lift Wing internals were not checked.** Which features Lift Wing uses internally was not checked. NoteCheck only uses the revision-level probability and never shows or stores editor information.
