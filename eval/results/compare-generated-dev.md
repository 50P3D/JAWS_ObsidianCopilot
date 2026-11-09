# Comparison on 20 shared claims (split dev)

| System | Run | Macro-F1 [95% CI] | Accuracy | False-flag | Miss | Invalid |
|---|---|---|---|---|---|---|
| pipeline (qwen3.5:9b) | 20261109-095630_pipeline_qwen3.5-9b_dev | 0.974 [0.919, 1.000] | 95.0% | 0.0% | 5.0% | 0 |
| no-rag (qwen3.5:9b) | 20261109-104400_no-rag_qwen3.5-9b_dev | 0.974 [0.919, 1.000] | 95.0% | 0.0% | 5.0% | 0 |

Change in macro-F1 against baseline **no-rag (qwen3.5:9b)** (target: +10 points)

| System | Delta (points) | 95% CI | Share of resamples not better | Meets target? |
|---|---|---|---|---|
| pipeline (qwen3.5:9b) | +0.0 | -8.1 to +8.1 | 65.5% | no |
