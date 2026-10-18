# Reliability evaluation run 20261017-185933_reliability-revert-risk-only_dev

- System: `revert-risk-only`, Lift Wing on
- Thresholds: `{"revertRiskLow":0.7,"revertRiskMedium":0.4,"recentEditHours":24,"revertsInWindow":3,"inlineIssues":10,"citationCoverage":0.5,"unavailableCap":2}`
- Dataset: `eval/datasets/reliability-dev.jsonl`, split **dev**, 40 revisions, sha256 `0dbe65fd4da5`
- Git commit: `9013bb2-dirty`
- Started 2026-10-17T18:59:33.378Z, finished 2026-10-17T19:00:32.091Z

## Low flag against "was reverted"

| Metric | Value | 95% interval |
|---|---|---|
| Precision (Low flags that were reverted) | 0.923 | 0.750 to 1.000 |
| Recall (reverted revisions flagged Low) | 0.600 | 0.357 to 0.813 |
| F1 | 0.727 | 0.500 to 0.875 |
| Flag rate (share of revisions flagged Low) | 32.5% | 17.5% to 47.5% |
| Revisions (reverted / stable) | 40 (20 / 20) | |
| Errors (counted as not flagged) | 0 of 40 | |
| Latency per revision, median / p90 | 1285 ms / 2363 ms | |

Confusion counts (positive = reverted / flagged Low)

| gold \ predicted | Low | not Low |
|---|---|---|
| reverted | TP 12 | FN 8 |
| stable | FP 1 | TN 19 |

## Rule firing counts

| Rule | Fired on reverted | Fired on stable |
|---|---|---|
| `revert-risk-high` | 12 | 1 |
| `banner-pov` | 0 | 0 |
| `banner-disputed` | 0 | 0 |
| `banner-unreferenced` | 0 | 0 |
| `banner-more-citations` | 0 | 0 |
| `banner-cleanup` | 0 | 0 |
| `banner-current-event` | 0 | 0 |
| `inline-issues` | 0 | 0 |
| `revert-risk-medium` | 0 | 0 |
| `recent-edit` | 0 | 0 |
| `pending-review` | 0 | 0 |
| `revert-volatility` | 0 | 0 |
| `low-citations` | 0 | 0 |

## Unavailable signals

Out of 40 revisions with recorded signals.

| Signal | Unavailable on reverted | Unavailable on stable | Most common cause |
|---|---|---|---|
| maintenance | 0 | 0 |  |
| editActivity | 0 | 0 |  |
| revertRisk | 0 | 0 |  |
| citations | 1 | 2 | no prose paragraphs (3) |

## Errors

None.

## False positives (flagged Low, not reverted)

- **rev-1379561129** [Marlene Belfort](https://en.wikipedia.org/w/index.php?oldid=1379561129), badge Low, rules `revert-risk-high`
  - This revision has a high predicted chance of being reverted (0.83)

## False negatives (reverted, not flagged Low)

- **rev-1380746986** [Rara National Park](https://en.wikipedia.org/w/index.php?oldid=1380746986), badge High
  - Predicted revert risk 0.22 is below 0.7
- **rev-1380748973** [Ottoman–Safavid War (1623–1639)](https://en.wikipedia.org/w/index.php?oldid=1380748973), badge High
  - Predicted revert risk 0.61 is below 0.7
- **rev-1380720225** [Athletics at the World School Sport Games](https://en.wikipedia.org/w/index.php?oldid=1380720225), badge High
  - Predicted revert risk 0.15 is below 0.7
- **rev-1380723636** [2026 UCI Track Cycling World Championships](https://en.wikipedia.org/w/index.php?oldid=1380723636), badge High
  - Predicted revert risk 0.17 is below 0.7
- **rev-1380688315** [Oikophobia](https://en.wikipedia.org/w/index.php?oldid=1380688315), badge High
  - Predicted revert risk 0.24 is below 0.7
- **rev-1380740686** [Buni](https://en.wikipedia.org/w/index.php?oldid=1380740686), badge High
  - Predicted revert risk 0.43 is below 0.7
- **rev-1380691272** [WXMI](https://en.wikipedia.org/w/index.php?oldid=1380691272), badge High
  - Predicted revert risk 0.67 is below 0.7
- **rev-1380754872** [Nazlı Ecevit](https://en.wikipedia.org/w/index.php?oldid=1380754872), badge High
  - Predicted revert risk 0.35 is below 0.7

## Caveats

- **Small sample.** The intervals above come from 2000 bootstrap resamples (seed 201). With 40 revisions, one revision moves recall or precision by several points. Treat differences inside the interval as noise.
- **The gold label is incomplete.** `mw-reverted` only marks reverts that MediaWiki detects (rollback, undo, exact manual revert), so some "stable" edits may have been undone by hand.
- **Labels can change.** A stable edit could still be reverted after it was sampled.
- **Evaluation time is not live time.** The evaluation scores each edit as of its own save time, while live use scores the current revision. Recency signals therefore behave differently in the two settings. This does not affect the Low flag, because recency only produces Medium.
- **Lift Wing is a strong baseline.** Lift Wing is itself trained on revert data, so `revert-risk-only` is a strong baseline. The interesting question is whether the rules add precision or recall beyond it.
- **Lift Wing internals were not checked.** Which features Lift Wing uses internally was not checked. NoteCheck only uses the revision-level probability and never shows or stores editor information.
