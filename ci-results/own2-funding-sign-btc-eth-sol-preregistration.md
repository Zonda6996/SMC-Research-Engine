# Immutable preregistration — OWN2 + funding-sign, BTC/ETH/SOL perpetual 1h

**Статус:** FROZEN BEFORE ANY OWN2 OUTCOME COMPUTATION OR READING on this corpus.

## Independence

Новый frozen корпус состоит из трёх пользовательских Binance perpetual `.P` 1h CSV. Он новый как формально зафиксированный protocol corpus для этого эксперимента, но **не гарантированно globally untouched**: его календарный период частично/полностью пересекается с ранее просмотренными исследованиями проекта по BTC/ETH/SOL и OWN2. Последние 35% являются честным chronological protocol holdout относительно этого запуска и не используются для настройки, однако это ограничивает силу внешнего заявления об абсолютной независимости.

## Frozen universe and data

- BTCUSDT perpetual 1h: `csv/BINANCE_BTCUSDT.P, 60.csv`, expected 23 104 data rows, SHA-256 `951065dc48e419e0f5d9e457a49a35273d4683697795b846e9a60e2bcc8d046b`.
- ETHUSDT perpetual 1h: `csv/BINANCE_ETHUSDT.P, 60.csv`, expected 23 104 data rows, SHA-256 `ea7945859ffe6fad7ee0d0792de617e6362841aaacb5627009e34555c18a3fb5`.
- SOLUSDT perpetual 1h: `csv/BINANCE_SOLUSDT.P, 60.csv`, expected 23 104 data rows, SHA-256 `2bd807c921e6df886feff8e37afe07275ffbc99cc4bcce5863d4b3ce27876d85`.
- Declared common timestamp span: `1704067200..1787238000` seconds (`2024-01-01T00:00:00.000Z..2026-08-20T07:00:00.000Z`).
- Only `time, open, high, low, close, Volume` may enter OWN2. Vendor GGI lines/shapes are forbidden as labels, features, selection criteria or gates.

## Frozen chronological split

One common calendar cutoff for all symbols is computed as 65% of the declared inclusive endpoint span, then rounded up to the first 1h timestamp not earlier than the exact boundary:

- exact 65% boundary: `2025-09-17T16:57:00.000Z`;
- frozen operational cutoff: **`2025-09-17T17:00:00.000Z`** (`1758128400000` ms);
- development: decision timestamp `< cutoff`, QA only;
- primary holdout: decision timestamp `>= cutoff`.

No parameter, operator, threshold, symbol, side or subgroup may be selected from development outcomes. The rule is transferred unchanged from the AVAX experiment. No retune after reveal.

## Canonical baseline resolved before outcomes

Documentation (`docs/strategies/zonda-reversal.md` and prior funding-sign preregistration), tests and current detector establish the canonical rule as:

- Apex `apex-1.2-cross-oos-sigma-4`;
- OWN2 `signal-arrows-1.0-own2-extension`;
- `warmupBars=200`, `relativeVolumePeriod=20`, **explicit `minimumRelativeVolume=1.4`**, `minimumDistanceMeanPct=3` with the detector's frozen adaptive gate, `minimumPenetrationInner=-0.35`, directional candle and correct side of Mean;
- canonical Safe replay: `stepDivisor=1`, `stopSteps=2`, `dynamic-partial`, `partialFraction=0.25`, add enabled, moving Mean/opposite-Inner management, fixed stop, conservative intrabar order, `maxHoldingBars=2000`;
- entry at next-bar open; baseline admission/replay is generated once and is identical for baseline and filtered arms.

The current detector default is `minimumRelativeVolume=0.0`; therefore relying on the default would reproduce the historical wiring bug. **Primary must pass `minimumRelativeVolume: 1.4` explicitly.** A no-relVol legacy-bug arm, if computed, is secondary diagnostic only and cannot affect the verdict.

## Frozen funding rule

Use official Binance USD-M real settled funding for each exact symbol and period. At decision time, only the latest settlement with `settlementTimestamp < decisionTimestamp` is available:

- LONG retained iff latest strictly-prior rate `< 0`;
- SHORT retained iff latest strictly-prior rate `> 0`;
- zero or missing = veto;
- no magnitude, z-score, age, symbol, side or cadence filter;
- no future settlement, interpolation or silently assumed cadence.

Actual direction-aware funding cashflows are included in both arms for every real settlement crossed by the actual position state (entry/add/partial/exit).

## Frozen estimand, costs and statistics

- Baseline and filtered use identical OWN2 generation and Safe execution.
- Primary costs: 5 bps per executed side. Gross 0 bps is diagnostic.
- Opportunity table is defined by admitted baseline holdout opportunities. Retained rows carry the same trade outcome in both arms; vetoed rows have filtered exposure/R = 0.
- Primary estimand: paired delta net R per baseline opportunity, `filteredNetOrZero - baselineNet`.
- Also report mean per executed trade and total R.
- Joint UTC-calendar-day cluster bootstrap, 10 000 samples, seed `25082026`, percentile CI95. A sampled day moves all symbols and both paired values together.

## Frozen gates

`GO` iff all hold:
1. pooled baseline holdout opportunities `>=250`;
2. retained holdout trades `>=100`;
3. filtered net expectancy per executed retained trade `>0`;
4. CI95 lower bound of paired delta per baseline opportunity `>0`;
5. positive paired improvement breadth `>=2/3` symbols.

If an N gate fails: `INCONCLUSIVE DATA`. Otherwise any failure: `KILL`. Only all gates: `GO`.

## Required reporting

Raw OWN2 candidates → admitted baseline opportunities/trades → retained/vetoed; aggregate and per-symbol gross/net totalR, meanR/trade, meanR/baseline-opportunity, PF, WR, maxDD, fundingR, costs and holding; retained baseline counterfactual and vetoed counterfactual; long/short, concentration/top trades and latest-rate age; paired CI and breadth. Recall is not compared with expectancy.

## Frozen provenance hashes

- `src/core/signals/ApexEngine.ts`: `0857b29aef879a3de56641f4a49cf405ffad8226df19f6e24e8ab91597cb2af7`
- `src/core/signals/ArrowSignalEngine.ts`: `9d53614d2068ffc3db3bd52cfc9e6b03c06cc49684c459b5e3408a3933218217`
- `src/core/signals/ArrowTradeReplay.ts`: `5b74d0a0d4d3b0ebb07859b6879295264d6c4e1e2f231b33a1335b71f7fe5fc2`
- `ci/research/lib/own2FundingSignResearch.ts`: `5e4c5be1f9362b16847c3399ce8c5cb8c7abbd9b221ec793b48292d34109ef38`
- `tools/shared/fundingFetcher.ts`: `6750ec5aafdf98c3f89810e54e89298ddf8885fe2de1901fdde357b13569f034`

This file must be hashed before funding acquisition and before any OWN2 outcomes are computed or read.
