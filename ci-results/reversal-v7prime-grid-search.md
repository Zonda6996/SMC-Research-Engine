# V7' grid search (fit+validation only, sealed untouched)

18 configurations, exact matching (tolerance 0). Selection: highest mean validation F1, tie-break precision then smaller W.

| W | minAge | threshold | mean val F1 % | mean val precision % |
|---|---|---|---|---|
| 48 | 8 | 0.5 | 3.03 | 2.17 |
| 54 | 8 | 0.25 | 3.03 | 2.17 |
| 54 | 8 | 0.5 | 3.03 | 2.17 |
| 60 | 8 | 0.25 | 3.03 | 2.17 |
| 60 | 8 | 0.5 | 3.03 | 2.17 |
| 48 | 8 | 0.25 | 2.94 | 2.08 |
| 48 | 16 | 0.25 | 0.00 | 0.00 |
| 48 | 16 | 0.5 | 0.00 | 0.00 |
| 48 | 24 | 0.25 | 0.00 | 0.00 |
| 48 | 24 | 0.5 | 0.00 | 0.00 |
| 54 | 16 | 0.25 | 0.00 | 0.00 |
| 54 | 16 | 0.5 | 0.00 | 0.00 |
| 54 | 24 | 0.25 | 0.00 | 0.00 |
| 54 | 24 | 0.5 | 0.00 | 0.00 |
| 60 | 16 | 0.25 | 0.00 | 0.00 |
| 60 | 16 | 0.5 | 0.00 | 0.00 |
| 60 | 24 | 0.25 | 0.00 | 0.00 |
| 60 | 24 | 0.5 | 0.00 | 0.00 |

## Winner (mechanical)

W=48, minAge=8, threshold=0.5

Per-dataset detail:

```json
{
  "btc-perp-15m": {
    "fit": {
      "p": 0.029850746268656716,
      "r": 0.0625,
      "f1": 0.04040404040404041,
      "preds": 67,
      "truth": 32
    },
    "validation": {
      "p": 0,
      "r": 0,
      "f1": 0,
      "preds": 31,
      "truth": 16
    }
  },
  "btc-perp-1h": {
    "fit": {
      "p": 0.023255813953488372,
      "r": 0.043478260869565216,
      "f1": 0.030303030303030304,
      "preds": 43,
      "truth": 23
    },
    "validation": {
      "p": 0.043478260869565216,
      "r": 0.1,
      "f1": 0.06060606060606061,
      "preds": 23,
      "truth": 10
    }
  }
}
```
