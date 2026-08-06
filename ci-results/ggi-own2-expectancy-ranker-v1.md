# OWN2 expectancy ranker v1

## Verdict: **REJECT OWN2 V1**

- Fit candidates: 1455; fit global mean net R: 0.0298
- Winner: top 35%; validation net mean 0.1146

| Split | Stream | n | mean net R | PF | WR | P/S/F | best 1% removed |
|---|---|---:|---:|---:|---:|---:|---:|
| validation | top 10% | 40 | 0.0932 | 1.331 | 65.0% | 10/4/26 | 0.0739 |
| validation | top 20% | 62 | 0.0699 | 1.235 | 62.9% | 17/6/39 | 0.0574 |
| validation | top 35% | 90 | 0.1146 | 1.423 | 66.7% | 22/8/60 | 0.1069 |
| test | selected OWN2 | 104 | 0.0245 | 1.073 | 59.6% | 30/12/62 | 0.0057 |
| test | broad | 194 | 0.0131 | 1.041 | 60.3% | 61/16/117 | 0.0034 |
| test | regime-null | 109 | 0.0253 | 1.086 | 63.3% | 33/7/69 | 0.0088 |

| Transfer | n | mean net R | PF | WR | P/S/F |
|---|---:|---:|---:|---:|---:|
| xrp-3m | 465 | -0.1627 | 0.621 | 50.5% | 187/43/235 |
| ondo-2h | 224 | 0.0419 | 1.135 | 59.8% | 77/13/134 |
| ondo-15m | 333 | 0.1141 | 1.419 | 65.8% | 95/19/219 |
| btc-15m | 439 | -0.0721 | 0.811 | 54.9% | 151/47/241 |

Pooled transfer mean net R: **-0.0410**

Win rate and Full:Stop are descriptive only; promotion is based on net expectancy, PF, null advantage and transfer consistency.
