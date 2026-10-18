# Reliability threshold tuning for run 20261017-190041_reliability-scorer_dev

- Source run: `20261017-190041_reliability-scorer_dev`, system `scorer`, Lift Wing on
- Dataset: `eval/datasets/reliability-dev.jsonl`, split **dev**, 40 revisions, sha256 `0dbe65fd4da5`
- Saved thresholds: `{"revertRiskLow":0.7,"revertRiskMedium":0.4,"recentEditHours":24,"revertsInWindow":3,"inlineIssues":10,"citationCoverage":0.5,"unavailableCap":2}`
- Rows with an error or no signals (kept not flagged): 0 of 40
- Recomputing at the saved thresholds reproduces every saved badge.
- Only `revertRiskLow` moves. `revertRiskMedium` is min(saved, candidate) so the Medium band never inverts.
- Best = highest F1, then higher min(precision, recall), then closest to the saved `revertRiskLow`, then the lower value.

| revertRiskLow | revertRiskMedium | Precision | Recall | F1 | min(P, R) | Flag rate | TP/FP/FN/TN |
|---|---|---|---|---|---|---|---|
| 0.30 | 0.30 | 0.696 | 0.800 | 0.744 | 0.696 | 57.5% | 16/7/4/13 |
| 0.35 | 0.35 | 0.696 | 0.800 | 0.744 | 0.696 | 57.5% | 16/7/4/13 |
| 0.40 | 0.40 | 0.750 | 0.750 | 0.750 | 0.750 | 50.0% | 15/5/5/15 |
| 0.45 | 0.40 | 0.824 | 0.700 | 0.757 | 0.700 | 42.5% | 14/3/6/17 |
| 0.50 | 0.40 | 0.824 | 0.700 | 0.757 | 0.700 | 42.5% | 14/3/6/17 |
| 0.55 | 0.40 | 0.824 | 0.700 | 0.757 | 0.700 | 42.5% | 14/3/6/17 |
| 0.60 **best** | 0.40 | 0.875 | 0.700 | 0.778 | 0.700 | 40.0% | 14/2/6/18 |
| 0.65 | 0.40 | 0.929 | 0.650 | 0.765 | 0.650 | 35.0% | 13/1/7/19 |
| 0.70 (saved) | 0.40 | 0.923 | 0.600 | 0.727 | 0.600 | 32.5% | 12/1/8/19 |
| 0.75 | 0.40 | 0.909 | 0.500 | 0.645 | 0.500 | 27.5% | 10/1/10/19 |
| 0.80 | 0.40 | 0.900 | 0.450 | 0.600 | 0.450 | 25.0% | 9/1/11/19 |
| 0.85 | 0.40 | 1.000 | 0.250 | 0.400 | 0.250 | 12.5% | 5/0/15/20 |
| 0.90 | 0.40 | 1.000 | 0.250 | 0.400 | 0.250 | 12.5% | 5/0/15/20 |
| 0.95 | 0.40 | 1.000 | 0.100 | 0.182 | 0.100 | 5.0% | 2/0/18/20 |

Best F1 0.778 at revertRiskLow 0.60 (precision 0.875, recall 0.700, 1 value(s) tied on F1).
Dev has 40 revisions, so expect some overfit.
