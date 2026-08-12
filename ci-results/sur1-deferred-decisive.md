# SUR1 surrogate signal results

Pre-registration: `sur1-surrogate-signal-preregistration.md`. DM3 V2 exits everywhere; capture C = (sur - rand) / (arrows - rand).

## Calibration - BTC.P 2h full20k (vol re-export) (arrows: n=89, meanR=0.1509, WR=93.3%; random @ arrow-n: 0.0004 [-0.0893..0.0799])

| rule | n | mean R | WR | capture C |
|---|---|---|---|---|
| S1_wick_outer/k1.25 | 62 | -0.1065 | 71.0% | -0.671 |
| S1_wick_outer/k1.75 | 60 | -0.1154 | 70.0% | -0.813 |
| S1_wick_outer/k2.5 | 56 | -0.1253 | 71.4% | -0.965 |
| S2_close_outer/k1.25 | 44 | -0.2266 | 72.7% | -1.491 |
| S2_close_outer/k1.75 | 42 | -0.2375 | 73.8% | -1.618 |
| S2_close_outer/k2.5 | 39 | -0.1939 | 74.4% | -1.549 |
| S3_twobar_outer/k1.25 | 62 | -0.1065 | 71.0% | -0.782 |
| S3_twobar_outer/k1.75 | 60 | -0.1154 | 70.0% | -0.787 |
| S3_twobar_outer/k2.5 | 56 | -0.1253 | 71.4% | -0.997 |

## OOS (winner only)

Not run (calibration failed).

## Pre-registered verdict

**FAILURE (best calibration C=-0.671 < 0.6: hidden state carries the bulk of the arrows' value)**
## Interpretation notes (post-run, appended once)

1. FINAL FAILURE for SUR1, and this time the test was clean: pre-declared
   sanity check passed (arrows on the vol re-export: n=89 closed, +0.1509R,
   WR 93.3% - reproduces the DM3 reference +0.154R), the calibration set is
   the one where the arrows genuinely earn, and every one of the 9 frozen
   rules lost money (-0.11..-0.24R) while random entries sat at ~0.00R.
   All capture ratios are NEGATIVE: stretch+volume entries are systematically
   WORSE than random on BTC 2h.
2. This is strong evidence, not an artifact: the arrows fire on a subset of
   stretched-beyond-Outer bars (BUY arrows overwhelmingly satisfy S1), yet
   the average S1+volume bar loses. The hidden state does not merely add a
   little selectivity - it carries ESSENTIALLY ALL of the monetary value.
   Whatever distinguishes the ~90 arrow bars from the ~60 surrogate bars
   (mostly different bars) is the indicator's actual product.
3. Per the deferred-run pre-registration this verdict is FINAL: the surrogate
   direction (SUR-series, observable-feature entry rules) is CLOSED. No SUR2.
4. Consequences for Nikita's engine integration:
   - Live signals require the indicator itself: TV alerts (webhook) while a
     paid plan is available; there is no home-grown replacement on the table.
   - Everything downstream of the signal IS replicable and already built:
     the DM3-identified exit machinery runs in his engine on any feed.
   - The economically honest summary stands: the arrows carry ~+0.15R gross
     per trade on BTC 2h; that value is not extractable from OHLCV+bands
     without the indicator's internal state.
