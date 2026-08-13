# Independent Reversal G1 — fit-only verdict

## Decision

**G1 is rejected as a tradable Reversal specification. Do not open the 2023 signal-validation slice for G1.**

This is a fit-only conclusion for BTC/ETH/SOL/XRP perpetuals, 15m, on the half-open interval `2021-01-01T00:00:00Z`–`2023-01-01T00:00:00Z`. It does not consume 2023 validation, 2024 management validation, portability, or sealed 2025+ data.

The negative result is broad rather than an isolated weak cell:

- every asset is net negative;
- both calendar years are net negative;
- both directions are net negative;
- every family with a usable sample (`CORE`, `P`, `V`, `C`) is net negative;
- the aggregate 95% calendar-week clustered bootstrap interval is entirely below zero;
- removing the best 1% of trades worsens the result, as expected for a genuinely negative distribution;
- even the counterfactual result without fees and slippage remains negative.

## Frozen protocol

- Protocol: `independent-reversal-protocol-1.0-preregistered`
- Protocol SHA-256: `c8e36dd4241dc65bd51c01cbe52df2fe88490c8ed6d2034d0f16e865f4a1e623`
- Signal finalization: candle close
- Entry: next candle open, market/taker
- Stop: episode extreme plus `0.15 ATR`
- Target: `2R`
- Time stop: 48 bars
- Same-bar stop/target ambiguity: stop first
- Taker fee: 5 bps
- Maker target fee: 2 bps
- Market slippage: 2 bps adverse
- Funding: signed Binance USD-M settlement history

## Data integrity and repair

Each asset has exactly 70,080 unique 15m candles, no duplicates, no missing bars, no irregular intervals, and complete requested boundaries.

The initial SOL/XRP load exposed two identical defects in Binance monthly kline ZIPs:

- missing `2022-02-26` through `2022-02-28` — 288 bars;
- missing `2022-04-01` through `2022-04-02` — 192 bars.

The official Binance daily archives contain all 480 missing bars per symbol. The archive loader was changed to detect internal gaps and recover only existing daily archives; no candles were synthesized.

The initial funding cache also contained zero rows because Binance's historical REST response returned an empty `markPrice`. Funding was rebuilt from official monthly `fundingRate` archives and aligned with official 8h `markPriceKlines` interval opens. Final funding counts are non-zero and hashed.

| Asset | Candles | Missing | Funding rows | Combined SHA-256 |
|---|---:|---:|---:|---|
| BTC/USDT | 70,080 | 0 | 2,169 | `68e22c48aeb03406a4d33ed0669def52fc9d80ee00a6364ef610d0ff91abcd96` |
| ETH/USDT | 70,080 | 0 | 2,187 | `96c5037da5970a6600ecfc559b929a883f9a1d2284bf4d0e6db5304690fa8c35` |
| SOL/USDT | 70,080 | 0 | 2,247 | `a0a73f069811ee35a5d817e816c7bd979ffee01b53bf920cf8b4c25b4316c2ee` |
| XRP/USDT | 70,080 | 0 | 2,172 | `9956f3f5c675ab1579d0773adec6741abeaed5d9e34017bb11c79931b7158108` |

## Aggregate result

| Metric | Result | Promotion gate |
|---|---:|---:|
| Signals | 6,242 | — |
| Closed trades | 3,323 | ≥ 200 on validation |
| Signals / symbol-week | 14.96 | balanced target was about 2–8 |
| Closed trades / symbol-week | 7.97 | — |
| Win rate | 39.18% | — |
| Net total | **−445.92R** | positive |
| Net expectancy | **−0.1342R** | ≥ +0.08R |
| Profit factor | **0.7607** | ≥ 1.15 |
| Best-1%-removed expectancy | **−0.1564R** | positive |
| Bootstrap 95% interval | **[−0.2077R, −0.0599R]** | lower bound > 0 |
| Bootstrap P(expectancy > 0) | **0.02%** | — |
| Max sequential drawdown | **468.07R** | incompatible with the risk gate |
| Non-negative asset cells | **0 / 4** | ≥ 70% |

The sequential drawdown above is a diagnostic sum of overlapping family trade streams, not the final 3%-open-risk portfolio simulator. A portfolio simulation cannot rescue a stream whose expectancy and PF are already strongly negative, so it is not a reason to consume later stages.

## Asset transfer

| Asset | Trades | Expectancy | PF | Best-1%-removed |
|---|---:|---:|---:|---:|
| BTC/USDT | 826 | −0.1350R | 0.7643 | −0.1583R |
| ETH/USDT | 832 | −0.1026R | 0.8171 | −0.1258R |
| SOL/USDT | 857 | −0.1373R | 0.7559 | −0.1603R |
| XRP/USDT | 808 | −0.1626R | 0.7024 | −0.1872R |

There is no profitable asset carrying the aggregate and therefore no favorable concentration story. ETH is the least negative cell, not a positive exception.

## Family result

| Family | Trades | Expectancy | PF | Best-1%-removed | Bootstrap 95% |
|---|---:|---:|---:|---:|---:|
| CORE | 1,079 | −0.1216R | 0.7795 | −0.1436R | [−0.1910R, −0.0534R] |
| P | 582 | −0.1343R | 0.7639 | −0.1567R | [−0.2350R, −0.0342R] |
| V | 1,082 | −0.1354R | 0.7575 | −0.1574R | [−0.2045R, −0.0659R] |
| C | 576 | −0.1541R | 0.7320 | −0.1770R | [−0.2496R, −0.0552R] |
| L | 2 | −0.3334R | 0.3718 | −1.0616R | not estimable usefully |
| S | 2 | −0.3334R | 0.3718 | −1.0616R | not estimable usefully |

`L` and `S` must not be interpreted as statistically disproven families: the fit CLI supplied the runner's causal structure event stream but no independent liquidity-POI stream, and the episode/CHoCH timing intersection produced only two closed trades for each. The underlying structure engine generated 2,392 CHoCH events across the four assets, including 1,839 after an opposite sweep, so the scarcity is an interface/grammar issue rather than absent source structure.

That limitation does not rescue G1. `CORE`, `P`, `V`, and `C` together provide thousands of trades and all fail decisively. It does mean the next generation should treat a corrected, independently preregistered liquidity/structure grammar as a new specification rather than claim that G1 fully falsified all possible L/S reversals.

## Direction and time stability

| Slice | Trades | Expectancy | PF |
|---|---:|---:|---:|
| Long | 1,898 | −0.1796R | 0.6915 |
| Short | 1,425 | −0.0737R | 0.8615 |
| 2021 | 1,677 | −0.1481R | 0.7386 |
| 2022 | 1,646 | −0.1200R | 0.7837 |

Shorts are less bad, but still clearly below zero and below PF 1.0. The result is not explained by one calendar year.

## Cost attribution

- Gross expectancy with executed slippage already embedded, before fees and funding: `−0.0876R`.
- Net fee drag: `−0.0479R/trade`.
- Net funding contribution: `+0.0013R/trade` across 2,981 counted settlements.
- Counterfactual expectancy without fees, retaining slippage and funding: `−0.0863R`.
- Counterfactual expectancy without both fees and slippage, retaining funding: `−0.0678R`.

Therefore the failure is not merely a transaction-cost problem. Costs worsen an already negative raw entry/exit distribution.

## Reproducibility

A repeated BTC run produced byte-identical output:

- `independent-reversal-fit-btc-15m.json`: `43baa95bbeda4f6f16c6e31fdceceb69f38525d4aa3793b5a2e56f79256ae67f`

Other final result hashes:

- ETH: `db98c26df3fa5dd08d0655369b596d6b21511d49858a2563e60fd94683512013`
- SOL: `5a9b15dbc76bd4c93fb14d8e03eadadd88b110e6a9ff411d84602b5ca389cd64`
- XRP: `6fb496b5df8acf01856437cdeb63d6774a10d754ad74c22529766b574dc1e08e`
- Aggregate: `a729be1ea9fcbfadac0bfa23df22515fd117f1634d1ecada9aeddbe58352d92f`

Verification gates after the data fixes:

- full tests: **409/409 pass**;
- research integrity: **13/13 pass**;
- TypeScript: **clean**.

## What is rejected and what is not

Rejected:

- G1's unconditional Apex Inner recovery (`CORE`);
- G1 price exhaustion (`P`);
- G1 volume exhaustion (`V`);
- G1 price-plus-confirmation composite (`C`);
- the G1 2R/48-bar next-open package as a tradable model;
- opening 2023 merely to search for a rescue.

Not established:

- that all causal reversal ideas are unprofitable;
- that every possible liquidity or CHoCH grammar is unprofitable;
- that the 2R/48-bar management is optimal or uniquely responsible for failure.

## Next research decision

Do not tune G1 and do not inspect 2023 for G1. Preserve 2023 as unseen for a genuinely new generation.

The defensible next step is a **new preregistered G2**, derived only from fit diagnostics and not from 2023:

1. fix the liquidity/structure input contract so L and S receive a real causal candidate stream;
2. prevent duplicated economic bets across `CORE/P/V/C` from being interpreted as independent trades;
3. reduce excessive activity before validation;
4. test whether exits are failing because entries have no favorable excursion, rather than grid-searching targets blindly;
5. freeze G2 before any 2023 computation.

Production `detectReversals()` and Apex remain unchanged.
