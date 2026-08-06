# Pre-registration: OWN2 expectancy ranker v1

Date: 2026-08-06

## Question

OWN1 reproduces a high dashboard-style win rate and a large Full:Stop ratio, but not reliable expectancy. The new test asks whether a causal continuous ranking model can select the economically valuable subset of a broad reversal-candidate stream better than another binary candle gate.

This is not an exact GGI-arrow reconstruction test. Same-side GGI proximity is diagnostic only.

## Why the OWN1 headline is insufficient

`Win rate = (Partial + Full) / closed trades` treats every Partial as a win even when its realised R is small. Full and Partial payoffs also vary because the static signal-bar Inner target and moving Mean are at different distances from entry, while every Stop is approximately -1R. Therefore neither win rate nor Full:Stop determines expectancy without the payoff distribution.

OWN2 targets realised DM3 net R directly. It does not target arrow labels, Full/Stop classification, or win rate.

## Frozen data roles

Development dataset: `BYBIT_BTCUSDT.P_2h_full20k_vol.csv`.

Chronological split by bar index:

- fit: first 50%;
- validation: next 20%;
- sealed test: final 30%.

Transfer diagnostics, never used to fit feature bins, bin values, score thresholds, or retention:

- XRP 3m;
- ONDO 2h;
- ONDO 15m;
- BTC 15m.

These transfer files are hypothesis-seen by prior research and are not described as independent sealed OOS.

## Broad causal candidate universe

A BUY candidate on closed bar i requires:

1. valid GGI band geometry;
2. bullish candle (`close > open`);
3. close remains below Mean;
4. at least 8 bars since the most recent Mean touch;
5. body >= 0.75 x causal SMA20(body).

SELL is mirrored. No GGI Shape is used. Candidate construction uses only rows <= i.

After score selection, a 20-bar per-side cooldown is applied chronologically. No future cohort ranking is allowed.

## Frozen causal features

All features are measured on candidate bar i from rows <= i and mirrored so larger/smaller values have the same semantic meaning for BUY and SELL:

1. `bodyRatio`: candle body / SMA20(body);
2. `episodeAge`: bars since Mean touch;
3. `recoveryInner`: recovery from the episode extreme / signal-side Mean-Inner width;
4. `directionalCloseLocation`: close location in candle range in reversal direction;
5. `meanGapInner`: remaining close-to-Mean distance / signal-side Mean-Inner width;
6. `innerWidthRatio`: current total Inner width / causal prior-20-bar average;
7. `extensionRatio`: latest episode-extreme extension / previous extension; lower means weakening continuation;
8. `directionalMeanSlope`: pre-signal 3-bar Mean slope in the old-trend direction / TR55.

Values are winsorised to fixed broad bounds in code. Missing/non-finite candidates are skipped.

## Model family

A small additive ranker is frozen to avoid an unconstrained ML search:

- each feature receives four fit-sample quantile cuts (five bins);
- each bin value is the fit-sample mean net R (6 bps/side) shrunk toward the fit global mean with prior weight 15;
- candidate score is the arithmetic mean of its eight bin values;
- no interactions, trees, neural networks, asset IDs, timeframe IDs, timestamps, GGI labels, or future path features.

This is economic meta-labeling of a broad causal trigger, not classification of vendor arrows.

## Frozen selection family

Only three retention levels are tested: top 10%, 20%, and 35% of fit-sample model scores. Their absolute score thresholds are frozen from the fit score distribution and then applied chronologically to validation/test/transfer.

Winner = highest validation mean net R among levels with at least 20 closed validation trades. Tie-breakers: higher validation PF, then higher retained count. No threshold may be changed after sealed test is viewed.

## Replay and cost accounting

All streams use unchanged DM3 V2:

- entry next-bar open;
- moving-Mean wick Partial, 25%;
- static signal-bar opposite-Inner wick Full;
- static 12 x SMA(TR,55) stop;
- adverse-first;
- no BE, no add.

Primary economics are net of 6 bps per side for a round trip, normalised by planned entry risk. Gross R is also reported.

Comparators in every evaluation window:

1. selected OWN2 stream;
2. broad candidate stream with the same cooldown;
3. frozen OWN1 (`body >= 1.5 x SMA20`, drought >=10, cooldown 40);
4. real GGI arrows;
5. deterministic regime-matched null at selected OWN2 count.

## Primary metrics

- mean net R;
- net profit factor;
- mean gross R;
- mean payoff by Partial / Stop / Full;
- outcome contribution to total R;
- best 1% removed mean net R;
- selected-minus-broad and selected-minus-null mean net R;
- transfer consistency.

Win rate and Full:Stop are reported only as descriptive diagnostics.

## Frozen verdict

`PROMOTE` requires all:

1. sealed BTC 2h test mean net R >= +0.03;
2. sealed test PF >= 1.10;
3. selected-minus-broad test advantage >= +0.03R;
4. selected-minus-regime-null test advantage > 0;
5. sealed test mean remains positive after removing best 1%;
6. pooled transfer mean net R > 0;
7. at least 3 of 4 transfer datasets have positive mean net R.

Otherwise `REJECT OWN2 V1`. Rejection closes this frozen additive ranker, not continuous ranking, meta-labeling, sequence models, or the whole search for a proprietary signal.

## Information gained on failure

A failure would show that causal one-bar/episode summary features combined additively do not recover the missing selectivity. The next structurally different family would then need interactions or sequential state representations, not another body/drought threshold grid.

## Integrity requirements

- prefix stability of candidates and features;
- deterministic fit and selection;
- no GGI labels in candidate generation or scoring;
- thresholds derived only from fit;
- validation selects among only the three frozen retention levels;
- test/transfer evaluated once;
- production signal code and defaults remain unchanged.
