# IMP2 - selection via causal liquidity context (net BingX VIP0 costs: 0.07%/side)

Universe: 28 symbols, TFs 1h/2h; 711 gated extension trades.

| filter | train n | train meanR | hold n | hold meanR | PASS(+0.05 both) |
|---|---|---|---|---|---|
| ALL | 462 | -0.0228 | 249 | 0.0156 | no |
| INPOOL | 304 | -0.0751 | 228 | -0.0052 | no |
| SELECTIVE | 8 | 0.0234 | 9 | 0.3417 | no |
| RELAXED | 14 | 0.1819 | 12 | 0.2602 | YES |

## Per-cell (INPOOL, n>=4, net meanR)

| cell | n | mean R | total R |
|---|---|---|---|
| JTOUSDT 120m | 6 | 0.402 | 2.4 |
| GRTUSDT 120m | 8 | 0.243 | 1.9 |
| ETHUSDT 60m | 12 | 0.241 | 2.9 |
| DOTUSDT 60m | 20 | 0.138 | 2.8 |
| ETCUSDT 60m | 10 | 0.102 | 1.0 |
| ORDIUSDT 120m | 6 | 0.094 | 0.6 |
| APTUSDT 60m | 8 | 0.079 | 0.6 |
| LINKUSDT 60m | 14 | 0.072 | 1.0 |
| FILUSDT 60m | 7 | 0.067 | 0.5 |
| JUPUSDT 60m | 19 | 0.062 | 1.2 |
| BTCUSDT 60m | 13 | 0.056 | 0.7 |
| QNTUSDT 60m | 11 | 0.056 | 0.6 |
| POLUSDT 60m | 19 | 0.056 | 1.1 |
| JUPUSDT 120m | 12 | 0.053 | 0.6 |
| WLDUSDT 120m | 10 | 0.051 | 0.5 |
| ETCUSDT 120m | 5 | 0.046 | 0.2 |
| KAITOUSDT 120m | 7 | 0.042 | 0.3 |
| ATOMUSDT 120m | 6 | 0.020 | 0.1 |
| ZECUSDT 120m | 5 | 0.015 | 0.1 |
| JTOUSDT 60m | 15 | 0.009 | 0.1 |
| ZECUSDT 60m | 14 | 0.000 | 0.0 |
| ORDIUSDT 60m | 20 | -0.024 | -0.5 |
| LINKUSDT 120m | 7 | -0.025 | -0.2 |
| SOLUSDT 120m | 7 | -0.038 | -0.3 |
| INJUSDT 60m | 19 | -0.046 | -0.9 |
| ATOMUSDT 60m | 24 | -0.047 | -1.1 |
| WLDUSDT 60m | 20 | -0.070 | -1.4 |
| GRASSUSDT 120m | 6 | -0.074 | -0.4 |
| XLMUSDT 60m | 8 | -0.080 | -0.6 |
| ALGOUSDT 60m | 14 | -0.083 | -1.2 |
| AAVEUSDT 60m | 14 | -0.087 | -1.2 |
| FILUSDT 120m | 8 | -0.107 | -0.9 |
| GRTUSDT 60m | 10 | -0.147 | -1.5 |
| TWTUSDT 120m | 8 | -0.150 | -1.2 |
| ETHUSDT 120m | 7 | -0.150 | -1.1 |
| SOLUSDT 60m | 13 | -0.155 | -2.0 |
| LTCUSDT 60m | 10 | -0.163 | -1.6 |
| TWTUSDT 60m | 19 | -0.166 | -3.1 |
| ONDOUSDT 60m | 11 | -0.197 | -2.2 |
| AVAXUSDT 120m | 4 | -0.234 | -0.9 |
| BTCUSDT 120m | 7 | -0.239 | -1.7 |
| AVAXUSDT 60m | 14 | -0.282 | -3.9 |
| ONDOUSDT 120m | 6 | -0.292 | -1.7 |
| APTUSDT 120m | 6 | -0.326 | -2.0 |
| TRXUSDT 120m | 4 | -0.330 | -1.3 |
| INJUSDT 120m | 10 | -0.334 | -3.3 |
| XLMUSDT 120m | 4 | -0.372 | -1.5 |
| AAVEUSDT 120m | 5 | -0.376 | -1.9 |
| TRXUSDT 60m | 6 | -0.509 | -3.1 |

## Per-cell (RELAXED, n>=4, net meanR)

| cell | n | mean R | total R |
|---|---|---|---|
| TWTUSDT 60m | 4 | 0.037 | 0.1 |
## Verdict (appended post-run)

1. FIRST FILTER TO CLEAR THE PRE-REGISTERED BAR: RELAXED (pool rank
   < 2/3, entry in band +-25%, pool swept <= 48h) - train +0.18R
   (n=14), holdout +0.26R (n=12), NET of BingX VIP0 costs (0.07%/side).
   Direction matches ZC5's independent +0.18R. SELECTIVE same sign but
   n too small. INPOOL alone is NEGATIVE (-0.075 train): being at a
   pool is not enough - it must be a non-top pool that was JUST swept.
2. HONESTY: n=26 total. This is a strong, consistent lead - not yet a
   proven system. Signal frequency ~1 trade/month across 28 symbols.
3. Trade-level profile: 14 full fix (avg +0.7R), 4 pBE (~0), 2 pStop,
   4 stops (-1R). Payoff structure is healthy: winners bigger than
   losers, unlike the raw GGI machinery.
4. Symbol spread: 16 different symbols in 26 trades - edge is not
   one coin's fluke. Cells too thin for per-coin ranking yet; the
   FILTER selects the coin for you on any given day.
5. Next (IMP3): expand n - fetch 240m context for ALL 56 cached
   symbols + add 15m/30m signal TFs for survivors; walk-forward by
   month instead of single split; then a paper-trade harness.
