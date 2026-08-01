# Zonda Apex / Zonda Reversal — research handoff

**Дата:** 2026-08-01

**Назначение:** точка входа для независимого исследователя, который должен приблизиться к поведению оригинальных TradingView-индикаторов или найти более сильную причинную модель, не выдавая гипотезу за факт.

## 1. Что реконструируется

### Zonda Apex

Индикатор экстремумов с пятью рядами:

```text
Upper Outer
Upper Inner
Mean
Lower Inner
Lower Outer
```

Наблюдаемые настройки оригинала: source `hlc3`, Lookback `200`, Inner Multiplier `5.6`, Outer Amplitude `9.6`. Текущая причинная аппроксимация находится в `src/core/signals/ApexEngine.ts`:

```text
mean = ALMA(hlc3, 200, 0.85, 6)
s = ALMA(trueRange / close, 122, 0.625, 4)
inner = mean * exp(±5.6 * s)
outer = mean * exp(±9.6 * s)
```

Версия: `apex-1.2-cross-oos-sigma-4`. Это близкая реконструкция, не доказанная точная private formula.

### Zonda Reversal

Редкие финальные BUY/SELL labels приватного GGI Buy/Sell. В оригинальном CSV:

```text
first Shapes column  = BUY
second Shapes column = SELL
non-zero value        = 1
```

Текущий production `detectReversals()` — минимальный baseline, а не vendor replica. Он не должен меняться без прохождения описанного ниже гейта.

## 2. Canonical exact corpus

Каталог: `data/vendor-exports/`.

`manifest.json` фиксирует exchange, symbol, market kind, timeframe, role, row/label counts, UTC range и SHA-256. Parser `ci/research/lib/exactIndicatorExport.ts` проверяет:

- точный header;
- строгую chronology и неизменный TF step;
- OHLC/band validity;
- `Lower Outer < Lower Inner < Mean < Upper Inner < Upper Outer`;
- BUY/SELL exclusivity;
- row/label counts, ranges and hashes.

Текущий canonical corpus:

| Dataset | Role | Rows | BUY | SELL |
|---|---|---:|---:|---:|
| BTC perpetual 15m | development | 14,683 | 38 | 31 |
| BTC perpetual 1h | development | 9,764 | 27 | 17 |
| ETH perpetual 15m | holdout asset | 16,990 | 46 | 29 |
| SOL spot 15m | holdout market kind | 17,865 | 38 | 25 |
| BTC perpetual 5m | holdout TF | 19,428 | 44 | 37 |
| BTC perpetual 4h | holdout TF | 7,690 | 18 | 20 |
| **Total** |  | **86,420** | **211** | **159** |

Total exact labels: **370**. Старое число 61,820/268 относится к предыдущим shorter exports и больше не является canonical total.

Official Bybit V5 volume alignment для тех же timestamps лежит в `data/vendor-exports/volume/`: 100% coverage, negligible OHLC drift. SOL Spot нельзя смешивать с Futures aggregate.

## 3. Что установлено по Apex

- На BTC development candidate `devSigma=4` дал width MAE 1.93% по 15m/1h и улучшил sigma 3.5.
- Без retune sigma 4 выиграл на каждом holdout:
  - ETH 15m: 2.38% → 2.13%;
  - SOL spot 15m: 2.06% → 1.84%;
  - BTC 5m: 2.31% → 2.13%;
  - BTC 4h: 1.68% → 1.55%.
- Mean MAE на holdouts: 0.068–0.604%.
- Это доказывает переносимую геометрическую близость Apex, но не торговую прибыльность.

Воспроизведение: `npm run research:integrity` или отдельно `npx tsx --test tests/exactIndicatorExport.test.ts tests/apexOosRegression.test.ts`.

## 4. Что уже отвергнуто по Reversal

### Per-bar baselines

Directional candle даёт 100% recall, но примерно 0.5% precision. Direction + Inner touch/current-prev, RSI recovery и distance thresholds остаются на единицах процентов precision. Reversal не является обычным bar classifier.

### Causal searches V1–V6

Все варианты прошли chronological selection и затем провалили sealed/group holdouts:

1. **V1 bounded state machine** — Inner/RSI arm, recovery, neutral re-arm. Futures holdouts precision 2.41–6.25%, recall 5.26–22.22%, count inflation до 3.56×.
2. **V2 long-memory episode** — oscillator arm, dwell, cross/recovery, re-arm. Sealed F1 12.77% → 3.70%; holdout recall 7.89–14.89%.
3. **V3 recovery grammar** — sealed F1 16.39% → 5.48%; holdout recall 7.41–9.33%.
4. **V4 global cooldown** — strongest rejected family. Sealed F1 21.92% → 7.69%; ETH/BTC5 precision about 11%, BTC4h 5.66%.
5. **V5 OHLC fear/greed proxy** — failed sealed and holdouts; count inflation.
6. **V6 volume-aware fear/greed score** — sealed produced zero matches; volume weight did not survive selection.

Also rejected:

- current/previous Outer-touch trigger: **0 of 370 labels** touch Outer on current/previous bar;
- standard centered/backplotted pivots;
- Gemini EMA100/ATR100 replica: zero exact and ±1 matches on checked slice;
- more identical exports to expose internals: public `BUY`/`SELL` series are exact aliases of final Shapes; score/state/threshold/counter series are not exposed.

Canonical verdict: `ci-results/reversal-automated-strict-critic.md` — V1–V6 all FAIL. Research-only code is retained for negative knowledge and causal building blocks, not endorsement.

## 5. Strongest positive structural evidence

The evidence supports a process closer to:

```text
first entry into an Inner/extreme episode
→ long-lived causal state; repeated touches do not necessarily reset age
→ hidden recovery/confirmation candidate stream
→ mode-specific acceptance
→ emit first accepted candidate once
→ global lock approximately 53–54 bars
→ re-arm after lock plus valid episode/neutral condition
```

Important observations:

- Positive labels occur well after the first Inner episode contact: median offset roughly 14–29 bars, p90 55–91.
- Minimum Risk-mode global gaps are stable in **bars**, not time: 54 on 3m, 53 on 5m, 54 on 15m; other slices about 52–60.
- Safe and Risk labels were exact-identical on a controlled 5,520-row Spot 15m overlap; different dashboard win rates therefore come from management, not entries.
- Across controlled Spot15/Futures3/Futures5 mode pairs: Risk 151, Standard 97, exact shared 88. Standard keeps 58.3% of Risk labels; 90.7% of Standard labels match Risk exactly; nine Standard-only labels are real.
- Therefore Standard is not a static mask after final Risk emission. Plausible stateful gate:

```text
base candidate
→ Standard feasibility check
  accepted: emit, consume episode, start lock
  rejected: remain armed, allow a later replacement candidate
```

Candidate Standard features must be causal: reward to Mean/target band, stop distance to episode extreme or known swing, fixed reward/risk feasibility, add-entry feasibility and same-bar ordering. Realized future outcome is forbidden.

## 6. Recommended next experiment — not a command

`ci-results/reversal-v7-deferred-research-brief.md` records the next narrow experiment. It was deliberately not run. An independent researcher may improve or reject it.

Recommended order:

1. Build episodes with reset only at Mean; separately test a causal neutral band.
2. Compare label/no-label episode-age distributions and per-age-bin hazard by side, asset and TF.
3. Test fixed age windows without oscillator/volume.
4. Add a narrow global lock set `{52,53,54,55,56,60}`.
5. Only if age survives sealed/OOS, add one recovery family and then one episode-conditioned volume family.
6. Model Standard as a pre-consumption stateful acceptance gate.

Do not repeat a broad weighted-composite or unbounded hyperparameter grid.

## 7. Evaluation protocol

### Split and selection

- Development: BTC perpetual 15m/1h.
- For each development series: first 50% fit, next 25% validation, final 25% sealed.
- Choose family/config using fit+validation only.
- Run selected candidate once on sealed.
- Then run unchanged on ETH Futures 15m, BTC Futures 5m/4h and separately SOL Spot 15m.

### Metrics

For each dataset and aggregate report:

- exact-bar directional precision/recall/F1;
- ±1-bar precision/recall as secondary timing diagnostic;
- predictions, truth, count ratio;
- BUY and SELL separately;
- inter-signal gap distribution;
- per-dataset results, not only aggregate.

Use one-to-one matcher `ci/research/lib/eventMetrics.ts`; one prediction cannot match multiple labels.

### Existing advancement gate

For every Futures holdout:

```text
precision >= 15%
recall >= 40%
count ratio in [0.5, 2.0]
```

Also reject severe sealed collapse or a candidate whose result depends on one dataset/side. Passing this gate only allows a deeper review; it does not prove exact source recovery or profitability.

## 8. Separation from independent strategy research

Vendor reconstruction asks: “Can we predict the original labels?”

Independent edge research asks: “Can a causal rule make money after costs?”

Never mix these objectives. For example, Outer-touch + directional candle may be tested as an independent strategy, but zero current/previous Outer touches among vendor labels means it is not vendor-trigger evidence. Strategy reports need entry/exit definitions, costs, adverse intrabar ordering, expectancy/R distribution and walk-forward validation, not only win rate.

## 9. Expected deliverables from the next researcher

Work on a new `research/*` branch and commit/push:

1. preregistered hypothesis and fixed search space;
2. causal TypeScript implementation;
3. unit tests for no-lookahead, one-shot/lock/re-arm and prefix stability;
4. machine-readable result JSON or CSV;
5. concise Markdown report with fit/validation/sealed/holdout tables;
6. strict critic verdict and production recommendation;
7. explicit list of any additional data needed and which competing hypotheses it distinguishes.

Do not modify `src/core/signals/ApexEngine.ts`, production `detectReversals()`, visualizer defaults or `SPEC.md` conclusions unless the gate passes and the project owner explicitly approves production promotion.
