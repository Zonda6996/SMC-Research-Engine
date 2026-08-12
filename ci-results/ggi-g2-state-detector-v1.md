# GGI-adjacent G2 state detector v1 — results

## Verdict: **REJECT G2**

Coverage: 5/5 available datasets. Missing: none.

| Dataset | Role | G2 n | G2 net R | PF | Null net R | Δ net R | Full:Stop |
|---|---|---:|---:|---:|---:|---:|---:|
| btc-2h | development | 41 | 0.0868 | 1.342 | -0.0214 | 0.1082 | 28.00 |
| ondo-2h | transfer | 74 | -0.1577 | 0.612 | -0.1614 | 0.0037 | 8.75 |
| ondo-15m | transfer | 98 | 0.0282 | 1.092 | -0.0375 | 0.0657 | 15.00 |
| btc-15m | transfer | 123 | -0.1140 | 0.703 | -0.1070 | -0.0070 | 6.60 |
| xrp-3m | transfer | 139 | -0.1047 | 0.720 | -0.1313 | 0.0266 | 9.88 |

## Frozen aggregate gate

- BTC 2h chronological test: mean net R 0.0868; matched-null advantage 0.1082.
- Pooled transfer (closed-trade weighted, n=434): mean net R -0.0864.
- Pooled transfer after removing the best 1% within each dataset: -0.0992.
- Positive transfer datasets: 1/4.

## Interpretation

- G2 is judged by net expectancy, PF and advantage over the matched null; Full:Stop and win rate are secondary.
- The dataset role is explicit: BTC 2h is chronological development/test, other available files are transfer diagnostics and are not sealed OOS.
- GGI proximity is diagnostic only and was not used to choose or promote the detector.
- No G2 threshold was selected after viewing these results.
- A rejection means this frozen state grammar did not clear the current test; it does not revive SUR1 or prove that all proprietary signals are impossible.

