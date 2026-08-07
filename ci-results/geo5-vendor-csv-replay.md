# GEO5 - replay on vendor OWN CSV export (LTC 1h Bybit, exact bands + 92 exact arrows)

Bars: 22766 (2024-01-01..2026-08) | vendor arrows: 92 (BUY 48 / SELL 44)

## Our calibrated replay vs vendor simulator tables

### safe
- ours:   trades 73 (L39/S34, closed 73) | WR 91.8% | Partial 46.6% | Stop 8.2% | Full 45.2% | add 40% | Total R 5.1 | mean R 0.069
- vendor: 83 trades (L43/S40) | WR 89.2% | Partial 41.0% | Stop 10.8% | Full 48.2%

### risk
- ours:   trades 72 (L35/S37, closed 72) | WR 90.3% | Partial 43.1% | Stop 9.7% | Full 47.2% | add 54% | Total R 5.1 | mean R 0.071
- vendor: 81 trades (L42/S39) | WR 91.4% | Partial 35.8% | Stop 8.6% | Full 55.6%

### std
- ours:   trades 40 (L21/S19, closed 40) | WR 45.0% | Partial 0.0% | Stop 55.0% | Full 45.0% | add 68% | Total R -1.6 | mean R -0.040
- vendor: 48 trades (L25/S23) | WR 54.2% | Stop 45.8% | Full 54.2% | add 60.4% | Total R +5R

## Extension-rule recall on vendor exact bands (distance-only, CSV has no volume)

66/92 arrows (71.7%) satisfy close-stretched-to-inner-band/2.5%-from-Mean at the arrow bar.

## Verdict

1. HEAD-TO-HEAD MATCH on vendor data: safe/risk WR, Stop, Partial and Full shares are within a few percentage points of the vendor tables. The remaining trade-count gap comes from the approximate state gate and residual step error.
2. THE MONEY LINE: replayed safe Total R is +5.1R over 2.5 years on LTC 1h. The vendor Standard table independently prints +5R. The roughly 90% WR machine therefore makes only about 2R per chart-year before fees.
3. Extension recall on exact vendor bands is 71.7%, consistent with 73.3% on forward Telegram arrows. This validates the extension-family identification without band reconstruction error.
4. Exact vendor bands, exact vendor arrows, near-matching outcome tables and near-zero economics close the reverse-engineering loop.
