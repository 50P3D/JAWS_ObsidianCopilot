# Comparison on 50 shared claims (split dev)

| System | Run | Macro-F1 [95% CI] | Accuracy | False-flag | Miss | Invalid |
|---|---|---|---|---|---|---|
| no-rag (qwen3.5:9b) | 20261016-225821_no-rag_qwen3.5-9b_dev | 0.429 [0.333, 0.512] | 54.0% | 29.4% | 11.8% | 0 |
| constant:Supported | 20261016-230135_constant-Supported_dev | 0.169 [0.120, 0.216] | 34.0% | 0.0% | 100.0% | 0 |

Change in macro-F1 against baseline **no-rag (qwen3.5:9b)** (target: +10 points)

| System | Delta (points) | 95% CI | Share of resamples not better | Meets target? |
|---|---|---|---|---|
| constant:Supported | -26.0 | -35.1 to -16.4 | 100.0% | no |
