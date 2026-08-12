# OWN1 - our own reversal generator: results

Pre-registration: `own1-generator-preregistration.md`. DM3 V2 exits everywhere.

## Train (BTC.P 2h, first 70%)

| rule | n | mean R | WR | P/S/F |
|---|---|---|---|---|
| bk1.5/M10 | 275 | 0.0551 | 92.7% | 83/20/172 |
| bk1.5/M20 | 220 | 0.0409 | 92.3% | 69/17/134 |
| bk1.5/M30 | 174 | 0.0121 | 93.1% | 61/12/101 |
| bk2/M10 | 233 | 0.0460 | 93.1% | 72/16/145 |
| bk2/M20 | 189 | 0.0252 | 92.1% | 60/15/114 |
| bk2/M30 | 144 | 0.0231 | 93.1% | 49/10/85 |

Winner: **bk1.5/M10**. Benchmarks on train window: arrows n=62, meanR=0.2381, WR=95.2%, P/S/F=15/3/44; random meanR -0.0077.

## Test (BTC.P 2h, last 30%, time-forward)

- OWN1 winner: n=100, meanR=0.0039, WR=93.0%, P/S/F=33/7/60
- Arrows same window: n=27, meanR=-0.0493, WR=88.9%, P/S/F=10/3/14
- Random same window: meanR 0.0096

## OOS (winner only)

| dataset | OWN1 | arrows meanR | random meanR |
|---|---|---|---|
| xrp-3m | n=415, meanR=-0.0352, WR=92.8%, P/S/F=153/30/232 | 0.0193 | -0.0653 |
| ondo-2h | n=210, meanR=-0.0565, WR=93.3%, P/S/F=81/14/115 | 0.0228 | -0.0418 |
| ondo-15m | n=274, meanR=0.0502, WR=96.0%, P/S/F=91/11/172 | 0.1363 | -0.0096 |
| btc-15m | n=379, meanR=-0.0841, WR=90.2%, P/S/F=140/37/202 | -0.0934 | -0.0812 |

Pooled OOS meanR: **-0.0349** (n=1278)

## Pre-registered verdict

**PARTIAL (test meanR=0.0039, WR=93.0%, pooled OOS=-0.0349)**
## Interpretation notes (post-run, appended once)

1. PARTIAL per the frozen criteria: train +0.055R -> test +0.004R, pooled OOS
   -0.035R. The accounting SHAPE matches the vendor's tables everywhere
   (WR 90-96%, P/S/F proportions similar) - shape is easy; money is not.
2. THE HEADLINE FINDING IS ABOUT THE ARROWS, NOT OWN1: on the held-out test
   window (last 30% of BTC 2h ~= mid-2025..aug-2026) the GGI ARROWS THEMSELVES
   earn -0.049R (n=27, WR 88.9%) vs random +0.010R. Their entire +0.154R
   full-window edge comes from the train era (+0.238R, n=62). The vendor
   indicator's BTC 2h edge has DECAYED to at-or-below random in the most
   recent ~1.4 years. OWN1's flat test result is therefore not evidence
   against OWN1's design - NOTHING earns on that window, including GGI.
3. Same picture on OOS: ondo-15m is the only window where arrows earn big
   (+0.136R) and there OWN1 is also positive (+0.050R, WR 96%). Where arrows
   are flat/negative (xrp-3m recent, btc-15m), OWN1 is too. OWN1 broadly
   TRACKS the arrows' regime - it just has no access to whatever selectivity
   the arrows had pre-2025.
4. Recorded honestly: OWN1 is not a money-printer, and neither - on recent
   data - are the arrows. Any further work should first settle the regime
   question (is the arrows' edge time-decayed everywhere?) before building
   more generators. OWN1 closed per prereg; no parameter tweaking.
