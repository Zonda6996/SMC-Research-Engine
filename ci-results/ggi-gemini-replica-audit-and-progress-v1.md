# GGI Gemini replica audit and reconstruction progress v1

## Input audited

The supplied Pine v5 script uses:

```text
Mean: EMA(close, 100)
Width: ATR(100)
Inner: Mean ± 1.16 × ATR
Outer: Mean ± 2.0 × ATR
Raw BUY: bullish current candle + bearish previous candle + previous low <= current lower inner + close < mean
Raw SELL: symmetric condition
State: one global position lock; re-open after crossing Mean or opposite Inner
```

The exported replica CSV contains 1,472 Bybit BTCUSDT perpetual 15m bars from 2026-07-17 04:45 UTC through 2026-08-01 12:30 UTC, with 20 BUY and 20 SELL events.

## Direct comparison with vendor GGI

The local exact vendor export overlaps on 1,413 bars through 2026-07-31 21:45 UTC.

### Lines

| Line | Gemini MAPE versus GGI | Gemini MAE |
|---|---:|---:|
| Mean | 0.186% | 119.95 price units |
| Upper Outer | 1.653% | 1093.95 |
| Upper Inner | 0.969% | 635.64 |
| Lower Inner | 0.979% | 623.09 |
| Lower Outer | 1.682% | 1060.79 |

The lines correlate visually because both are slow centers with volatility envelopes, but they are not the recovered GGI formula. Correlations range from about 0.895 to 0.983, which is expected for related moving-band constructions and does not establish formula fidelity.

The recovered Apex family remains materially better supported:

```text
Mean = ALMA(hlc3, 200, 0.85, 6)
Width state = ALMA(trueRange / close, 122, 0.625, 4)
Bands = Mean × exp(±k × width), kInner=5.6, kOuter=9.6
```

### Signals

On the 1,413 common bars:

| Side | Gemini | Vendor | Exact TP | ±1 bar TP |
|---|---:|---:|---:|---:|
| BUY | 20 | 4 | 0 | 0 |
| SELL | 20 | 5 | 0 | 0 |

Combined:

```text
Gemini predictions: 40
Vendor labels: 9
Exact matches: 0
±1 bar matches: 0
```

The nearest same-direction match is still 7–8 bars away. Median distance from a vendor event to the nearest Gemini event is 30 bars for BUY and 14 bars for SELL.

## Code-level problems

### Wrong Apex formula

EMA/ATR bands are a generic approximation. The exported error is substantially larger than the ALMA/exponential family already validated cross-symbol and cross-timeframe.

### Previous price against current band

The script checks:

```pine
low[1] <= lower_inner
high[1] >= upper_inner
```

Here `low[1]` and `high[1]` are previous-bar prices, but `lower_inner` and `upper_inner` are current-bar bands. If the intended test is previous-bar contact, the consistent comparison would use `lower_inner[1]` and `upper_inner[1]`.

Fixing that indexing bug would improve internal consistency but would not make the signals resemble vendor GGI; the observed exact score is already zero.

### Engulfing-like trigger is too common

The two-candle directional condition produces 40 events where the vendor emits 9. It lacks the rare long-memory state evidenced by the exact corpus.

### Position state conflates signal suppression and trade management

`pos` prevents another signal while a toy position is active, and Mean/opposite-Inner exits re-enable it. This is an invented trade state, not supported as the vendor's entry-state machine.

### No verified cooldown or episode memory

The vendor corpus shows a stable minimum global signal gap near 52–60 bars and label offsets deep inside long Inner-zone episodes. The Gemini script can re-enable after a quick Mean/Inner traversal and has no bounded long-memory episode or global cooldown.

### Exit logic does not match described GGI management

The code exits a long on Mean crossover or Upper Inner. User-observed behavior is richer: dynamic mode management, 25% partial at Mean, full fix near the beginning of the opposite/target band, adds, stops and mode-dependent outcome tables. The script models none of those quantities.

## Honest reconstruction progress

### Apex: close to the original family

Status: high confidence in architecture, moderate residual numeric error.

Validated facts:

- ALMA-based Mean on `hlc3`, length 200, offset 0.85, sigma 6.
- Exponential symmetric band geometry.
- Inner/Outer multipliers 5.6/9.6.
- Relative true-range ALMA width approximation with length 122, offset 0.625, sigma 4.
- Sigma 4 beats 3.5 on every untouched OOS dataset.

OOS errors:

- Mean MAE: approximately 0.068–0.604%, depending on timeframe.
- Width MAE: approximately 1.55–2.13%.

Interpretation: Apex is usable and near-ready, but not byte-for-byte identical.

### Reversal: architecture clues found, exact mechanism still far

Best causal candidate so far is v4, not the Gemini script:

```text
prior Inner episode
→ recovery into normalized distance band
→ first eligible event
→ global cooldown near 72 bars
```

OOS aggregate for v4:

```text
precision 10.38%
recall    17.01%
```

This is the best broad causal improvement, but it is not close enough for vendor fidelity. All v1–v6 candidates failed sealed/OOS gates and production Reversal remains unchanged.

Reliable Reversal facts:

1. Signals are stable across revised exports; no observed historical label repaint on overlap.
2. Shape 0 = BUY, Shape 1 = SELL.
3. Current or previous Outer touch occurs on 0% of exact label bars.
4. Signals often arrive long after the first Inner-zone visit: median approximately 14–29 bars, p90 approximately 55–91.
5. Minimum adjacent-signal gap is consistently about 52–60 bars across datasets.
6. Ordinary current-bar rules, centered pivots, simple fear/greed proxies and volume-aware proxies fail OOS.
7. Safe and Risk entry labels are exact-identical on the tested 5,520-bar sample; different win rates come from trade management.
8. Standard mostly filters the Risk/Safe candidate set, consistent with a downstream fixed-R trade-feasibility gate.

## Current working model

The reconstruction should be organized as separate layers:

```text
Apex geometry
  → long-memory extremity episode
  → hidden recovery/confirmation state
  → rare first-eligible event
  → global one-shot/cooldown and re-arm
  → base Risk/Safe BUY or SELL
  → Standard fixed-R feasibility gate
  → mode-specific stop/add/partial/full-fix management
```

What is implemented in production today is deliberately simpler:

```text
Outer touch arms side
→ directional candle confirms
→ one signal
→ side re-arms after Mean return
```

That production rule is a conservative visual baseline, not claimed as a faithful GGI replica.

## Practical conclusion

The Gemini code is useful only as a negative baseline or a simple independent indicator. It should not replace Apex or Reversal research code. Its exact signal fidelity on the supplied overlap is zero.

The next useful data is the promised BTC Futures 5m Risk/Standard pair with identical loaded history. It will test whether Standard remains a downstream subset/filter and provide more accepted/rejected candidates for learning the fixed-R gate.
