# Стратегия: Zonda Reversal + Apex (АКТИВНАЯ ЛИНИЯ)

> **Что это:** нормативная спека активной research-стратегии — разворотные стрелки на
> конверте Apex. Механика движка/тейков — в `docs/INDICATOR.md`; отвергнутое — в
> `docs/NEGATIVE-KNOWLEDGE.md`; текущий фокус/следующий шаг — в `docs/HANDOFF.md`.
> **Как часто меняется:** по ходу активного research. **Baseline-таблицы живут здесь**,
> не в HANDOFF.

---

## OWN2 + funding-sign filter — новый BTC/ETH/SOL perpetual 1h protocol holdout

Новый корпус был заморожен до outcomes: preregistration SHA-256 `6442965a30ddb0546b82cbd29529ab27d1de79539dc143f4503d261d40f183d9`, acquisition manifest `80ea6a481a3d987210ee36c1365f21990d9f497cb8423527114ec5d6617b3586`, единый cutoff `2025-09-17T17:00:00Z`. Канонический OWN2 разрешён по docs/tests/code как relVol≥1.4 и передан детектору явно (его runtime-default 0 не использован); сигнал строился только из OHLCV, vendor Shapes/GGI columns полностью игнорировались. Official Binance USD-M funding получен без синтетической cadence; все три candle-ряда имеют 23104 exact-aligned 1h строк и ноль QA-ошибок.

На holdout допущена 101 baseline opportunity (BTC 34 / ETH 34 / SOL 33), retained 56, vetoed 45. Net @5 bps + actual funding: baseline **−18.81186R** (−0.18626R/opportunity), filtered **−6.59726R** (−0.11781R/executed; −0.06532R/opportunity). Отсев убрал особенно плохую группу (vetoed counterfactual −12.21461R) и дал paired delta **+0.12094R/opportunity**, UTC-day joint bootstrap CI95 **[0.00607; 0.23890]**, breadth **3/3**. Но filtered expectancy остался отрицательным, baseline N<250 и retained N<100. По frozen порядку gates итог **`INCONCLUSIVE DATA`**, не GO и не KILL. Последние 35% — честный protocol holdout внутри этого корпуса, но не гарантированно globally untouched: BTC/ETH/SOL и пересекающиеся даты могли встречаться в прошлых исследованиях. Ретюн по раскрытым outcomes запрещён. Полные артефакты: `ci-results/own2-funding-sign-btc-eth-sol-results.{md,json}`, `data/own2-funding-sign-btc-eth-sol/manifest.json`.

## OWN2 + funding-sign filter (предыдущий frozen design, coverage stop)

Проверка была preregistered как paired-фильтр канонического OWN2: LONG только при последнем settled funding <0, SHORT только при >0, zero/missing = veto; strict timestamp `< decision`, 5 bps/side, actual direction-aware funding cashflows, veto=0 в метрике per baseline opportunity, UTC-day cluster bootstrap 10k seed 25082026. Но S1 untouched OOS до outcomes не прошёл coverage gate: 4/5 frozen series — spot и лишь AVAX futures 1h совместим с perpetual funding; это 1 symbol и 168 primary events против требований ≥3 symbols и ≥250 opportunities. Подмена spot-свечей perpetual-свечами изменила бы frozen corpus. Поэтому verdict **`INCONCLUSIVE DATA`**, outcomes не читались, S1 остаётся sealed (`reveal=0`). Нужен новый all-perpetual preregistered holdout. Полный отчёт: `ci-results/own2-funding-sign-report.md`.

## Граница vendor benchmark и новой цели

Exact-bar воспроизведение vendor shapes больше не является активной исследовательской целью.
Все RE/H1 результаты и артефакты сохраняются; подтверждённые Apex-геометрия и механика остаются
валидной основой. Vendor shapes допускаются только как внешний reference benchmark после
экономического verdict и никогда не используются как train target нового индикатора.

Track S1/S2 завершён с **`KILL_VALIDATION_NO_EDGE`**. Реализована причинная stateful
Apex event machine; Shapes полностью игнорировались. Допустима была только threshold-free рука
`primary-threshold-free-all-confirmed-events`. Train: N=4845, meanR −8.2535,
CI95 [−14.0245; −0.0548]. Validation: N=799, meanR −0.2001, CI95 [−0.5861; 0.0530],
PF 0.7163, WR 0.5006, breadth 0/2 symbols и 1/5 series. Integrity прошла. Это validation
kill, не OOS-провал: S1 untouched OOS reveal count 0 и остаётся sealed. Stateful-память edge
не создала; A0/A1 не тестировались и не являются winners. Прежний benchmark ниже сохранён.

### Track S3: profile→freeze→internal holdout (завершён)

На primary >=15m диагностический winners-vs-losers profile (2897 resolved observations,
17 independent series) выделил два candidate: `newAdverseExtremes` (Cliff delta −0.161,
CI95 [−0.196; −0.125], q=0.005) и `lastExtensionIncrementOverInner` (delta −0.163,
CI95 [−0.195; −0.123], q=0.005). Это был diagnostic profile, не доказательство доходности.

До reveal заморожена ровно одна v2-рука: `admit = (newAdverseExtremes <= 1)`. Threshold 1 —
label-free empirical median по 2770 development events; PnL-grid не применялся. Internal holdout
ONDO/VIRTUAL раскрыт ровно один раз. При 5 bps/side unfiltered v1: resolved 259, meanR −0.09033,
CI95 [−0.24971; 0.05873], PF 0.84025, WR 0.44788, maxDD 39.17770R. Frozen v2: admitted 187,
resolved 184, meanR +0.00227, CI95 [−0.15046; 0.13710], PF 1.00472, WR 0.52717,
maxDD 22.85845R. Paired delta meanR v2−v1 = +0.09260, CI95 [−0.02065; 0.20599]. Breadth:
1/2 positive symbols и 1/2 positive series.

v2 улучшил point estimate, PF, WR и DD относительно v1, но CI v2 и paired-delta пересекают
ноль, а preregistered breadth gate не пройден. Frozen verdict: **`KILL` — не edge**.
«Истощение расширения» полезно как risk/filter lead, но статистически не подтверждено как
прибыльный индикатор. Этот internal holdout сожжён; дальнейший тюнинг, subgroup search или
ретюн порога на нём запрещены. S1 untouched OOS не вскрывался и остаётся sealed (`reveal=0`).

### Track S4: loss-source diagnostic → recovery freeze → новый holdout (завершён)

Диагностика development отделила источник потерь без PnL-grid: gross meanR уже слегка
отрицателен (**−0.0146R**), fee drag составляет **−0.0798R** и является главным incremental
drag, net meanR **−0.0944R**. Почти все стопы прошли через favorable excursion:
**1434/1456 stop outcomes = favorable-then-stop**. Повторные события не являются причиной
убытка. Следовательно, проблема не сводится ни к комиссиям, ни к repeats: комиссия усиливает
уже отрицательный gross, а главный наблюдаемый path pattern — потеря возникшего favorable excursion.

До reveal была заморожена одна label-free v2-рука:
`recoveryFromExtremeOverInner >= 0.3203983409316291` (development median, один operator,
без PnL/subgroup rescue). Новый независимый holdout был заранее выбран label-free по 24h
quote volume: ZECUSDT, 1000PEPEUSDT и BOMEUSDT, 1h, по 20 000 баров; acquisition/schema
проверки прошли без замен и интерполяции.

На единственном reveal при 5 bps/side v1: resolved 399, meanR **−0.02205**,
CI95 **[−0.14444; 0.09872]**. Frozen v2: admitted 182, resolved 174, meanR **−0.00032**,
CI95 **[−0.19157; 0.23155]**. Paired delta v2−v1 = **+0.02173**,
CI95 **[−0.14912; 0.22548]**; breadth **2/3 symbols и 2/3 series**. Recovery filter
улучшил point estimate, но v2 примерно ноль, CI v2 и delta пересекают ноль, поэтому
preregistered verdict: **`KILL` — не edge**.

Этот новый holdout сожжён: запрещены его повторное использование, threshold/feature/operator
retune, subgroup/asset/TF/side rescue и исключение серий по reveal. S1 untouched OOS по-прежнему
не читался (`reveal=0`). Вся research-линия не закрыта; закрыта только эта frozen recovery-filter
гипотеза как входной edge.

## 1. Runtime (заморожен для измерения)
- Триггер сигнала: `signal-arrows-1.0-own2-extension` (OWN2), порог `relVol ≥ 1.4`.
- Полосы: `apex-1.2-cross-oos-sigma-4`. Реплей: `signal-arrows-replay-1.2-geo4-moving-close`.
- Режимы Safe/Risk/Standard — неизменны (см. INDICATOR §4). Вход = open следующего бара.
- Frozen HEAD профиля baseline: `609ecfee2496f7b5083be7578857ac959943d63d`.

## 2. Universe / costs / split (для baseline)
- Binance USDT-M futures cache: SOL/BTC/ETH/XRP/BNB × 30m/1h/2h, 20k баров на серию.
- Cost canon: BingX VIP0 taker 5 bps + slippage 2 bps = **7 bps на исполненную сторону**;
  `costR = turnoverNotional × 0.0007 / oneR`. Funding в OHLCV отсутствует, не выдумывается.
- Split: первые 65% календарного span каждой серии — train, последние 35% — OOS.
- CI: trade-level bootstrap, 2000 resamples, seed `20260807`; кластеры (same-side 4h) — отдельно.

## 3. Frozen baseline (после costs, OOS)

| Mode | OOS N | Net mean | 95% CI | PF | Net total | vendor WR |
|---|---:|---:|---|---:|---:|---:|
| Safe | 398 | -0.063R | [-0.130, 0.003] | 0.779 | -25.49R | 83.7% |
| Risk | 422 | -0.016R | [-0.100, 0.072] | 0.961 | -6.97R | 73.0% |
| Standard | 322 | +0.017R | [-0.105, 0.133] | 1.032 | +5.64R | 47.5% |

Costs переводят Risk из gross `+0.006R` в net `-0.016R`. Высокий vendor-style WR
(Partial+Full)/(Partial+Stop+Full) **не** компенсирует слабый expectancy.

**Breadth:** результат не держится на SOL (Safe SOL OOS -0.034R, Risk -0.064R); плюс
концентрируется в XRP/short (Risk XRP +0.207R, но ETH -0.166R; long -0.147R, short +0.159R).

## 4. Активный кандидат — H1 (Apex contraction/regime guard)
Единственная предзарегистрированная гипотеза (без grid search). G2-score `>=3/4`:
failed continuation 8 bars; direction-adjusted Mean slope 8 bars `> -0.25` среднего TR;
range последних 8 bars < предыдущих 8; направленная signal candle.

| H1 mode | Train mean | OOS mean | OOS 95% CI | PF | Decision |
|---|---:|---:|---|---:|---|
| Safe | -0.067R | -0.040R | [-0.133, 0.056] | 0.858 | CLOSE |
| Risk | -0.129R | +0.076R | [-0.054, 0.217] | 1.209 | **HOLD** |
| Standard | +0.024R | -0.049R | [-0.212, 0.115] | 0.909 | CLOSE |

H1 Risk: OOS point estimate > +0.05R, все 5 asset means положительны, НО train
отрицателен, CI включает ноль, long остаётся отрицательным → это sign flip, **не**
доказанное улучшение.

## 5. Вердикт
**HOLD research / NO-GO production.** Baseline закрыт как trading edge (runtime оставить
frozen). H1 Risk — research-only кандидат для нового untouched paper-forward.
H2 (свежий sweep нетопового 4h пула) и H3 (HTF/Fib/POI) — **BLOCKED**: нет causal-adapter,
несовместимы с текущим management; старые результаты переносить нельзя.

## 6. Следующий шаг
Исследовать управление **favorable-then-stop** — сохранение уже возникшего favorable excursion —
как отдельную causal management-гипотезу, сначала только на development и с новой preregistration.
Это не очередной входной фильтр; конкретное торговое правило здесь не задаётся и сейчас не
реализуется. S4 holdout ZEC/1000PEPE/BOME не переиспользовать и не ретюнить; S1 untouched OOS
не открывать (`reveal=0`).

## 7. Ограничения измерения (не забывать)
- Нельзя выбирать asset/TF/сторону после просмотра результата.
- Vendor parity ≠ profitability — это две разные ветки с раздельными метриками.
- Один рыночный импульс на N алертов ≈ одно наблюдение, не N независимых.
- Exact-bar vendor parity ограничена (нет golden CSV/timestamps по SOL 30m/1h).

## 8. Vendor-референс автора (full-fix-at-mean) + сверка с RE9

> Записано со слов автора (2026-08-18). Стратегия: вход по стрелке GGI Buy/Sell, **полная
> фиксация у зоны mean** (тейк = возврат к средней), **без partial и без добора** — остаётся
> только тейк ИЛИ стоп. Всё тестировалось на **Binance SPOT**. «Avg stop» = средняя дистанция
> стоп-лосса в %, и это его **риск-юнит**: `Result R ≈ Result% / AvgStop%` (точно на LDO:
> 28.32 / 1.86 = 15.23 ≈ +15.25R). Ранее его таблицы с partial завышали winrate (после partial
> уход по стопу засчитывался как +1 «хорошая»); здесь partial нет — учёт чистый.

**LDO m15** (референс-эталон):

| GGI | LONG | SHORT | TOTAL |
|---|---|---|---|
| Trades | 41 | 48 | 89 |
| Winrate | 58.5% | 66.7% | 62.9% |
| Take / Stop | 24 / 17 | 32 / 16 | 56 / 33 |
| Result | +7.96% | +20.37% | +28.32% |
| Avg stop | -1.9% | -1.82% | -1.86% |
| Result R | +4.2R | +11.17R | **+15.25R** |

**AVAX m5** — стоп ~1.7% (стабильный): Trades 67, WR 91.0%, Take/Stop 61/6, Result +23.24%, Avg stop -1.70%, **+12.62R**.
**AVAX m5** — стоп ~0.35% (короче): Trades 68, WR 47.1%, Take/Stop 32/36, Result +10.73%, Avg stop -0.35%, **+26.25R** (короче стоп → WR падает, но R растёт: тот же ход в % стоит больше R).
**ONDO m5**: Trades 92, WR 83.7%, Take/Stop 77/15, Result +22.71%, Avg stop -2.14%, **+12.12R**.
**VIRTUAL m5** (фаворит автора): Trades 108, WR 78.7%, Take/Stop 85/23, Result +26.55%, Avg stop -1.58%, **+15.24R**.

### Сверка с RE9 (наш прогон на вендор-стрелках, `ci-results/re9-vendor-shape-meanfix.*`)
- **Winrate совпал:** наш VIRTUAL 5m WR **80.0%** ≈ авторский **78.7%** (доля стопов ~20% vs 21.3%).
  ⇒ Логика «вход по его стрелке → выход у mean → стоп» **воспроизведена**; спор «наш детектор
  генерит мусор» закрыт — тут детектор не участвует, входы = его стрелки.
- **Расхождение R (+1.54R наш vs +15.24R автор) — НЕ в наборе сделок, а в масштабе R.** Два драйвера (гипотеза, ⚠ §2.2 — подтвердить прогоном):
  1. **Издержки.** Движок вычитает 7 bps/side ≈ 0.14% round-trip ≈ **−0.09R/сделку** при стопе ~1.6% ⇒ ≈ −8R на серию. Таблицы автора — gross (spot, без комиссии тестера). Только это поднимает наш VIRTUAL с ~+1.5R до ~+10R gross.
  2. **Определение стопа / риск-юнита.** Наш канон-стоп `2×step` (band-derived) ≠ его фиксированный «Avg stop» ~1.6–2.1%. R = Result%/stop% → при другом знаменателе тот же ход даёт другой R.
- **Exchange (spot vs futures) — НЕ причина:** WR уже совпал на нашем **futures**-фиде.
- **Открытый вопрос (единственный неизвестный):** точное правило стопа автора. Тейк известен (mean), add/partial нет.

### Следующий шаг для reproduce (нужны данные)
Перепрогон RE9 в двух правках: **gross (costs=0)** + **фиксированный %-стоп = его AvgStop** (и sweep стопа), на **spot**-CSV его фаворитов. Требуемые CSV — см. `docs/HANDOFF.md` (RE9-блок).

### RE10 (reproduce на SPOT-CSV автора) — РЕЗУЛЬТАТ, загадка решена
`ci/research/runRE10VendorReproduceSpot.ts` → `ci-results/re10-vendor-reproduce-spot.*`. Входы = реальные стрелки его SPOT-CSV.

| Серия | NET 2× (наш дефолт) | наш %-стоп @2× | GROSS при ≈его AvgStop | автор (gross) |
|---|---|---|---|---|
| LDO 15m | −0.57R | 7.09% | +10.9…+14.6R (@1.76–2.64%) | +15.25R @1.86% |
| AVAX 5m | +3.16R | 2.70% | +6…+10R (@1.3–2.0%) | +12.62R @1.70% |
| ONDO 5m | +2.29R | 3.79% | **+12.78R @1.89%** | +12.12R @2.14% |
| VIRTUAL 5m | +0.73R | 3.29% | **+13.14R @1.65%** | +15.24R @1.58% |

WR совпадают (ONDO 82.8/83.7%, VIRTUAL 81.1/78.7%). **Вывод:** разрыв RE9 (+1.5R наш vs +15R автор) объясняется **двумя чисто учётными факторами** — (1) издержки (наш net vs его gross), (2) наш канон-стоп 2× в 2–4× шире его фиксированного «Avg stop» ~1.6–2.1% (⇒ меньше R за тот же ход). При gross + его дистанции стопа его цифры **воспроизводятся** (ONDO/VIRTUAL — почти в точку). Значит его таблицы реальны, и движок правильно воспроизводит механику; прежний вывод «стратегия слаба» был артефактом net-издержек + слишком широкого стопа, а НЕ качества сигнала или биржи.

**Каветат (не снимать NO-GO преждевременно):** всё выше — **GROSS**. Узкий стоп повышает gross-R, но издержки в R растут (costR = turnover·bps/oneR, oneR↓ ⇒ costR↑) — это его же оговорка. **Не мерян NET при его дистанции стопа со спот-издержками** — это и есть решающий тест на edge. До него вердикт §5 (NO-GO production) не меняется.

### RE11 (net-edge на его стопе, свип издержек) — РЕШАЮЩИЙ РЕЗУЛЬТАТ
`ci/research/runRE11VendorNetEdge.ts` → `ci-results/re11-vendor-net-edge.*`. Стоп подобран под его AvgStop (LDO 1.76%, AVAX 1.68%, ONDO 2.07%, VIRTUAL 1.65% — совпадает с его 1.58–2.14%).

| комиссия bps/side | LDO totalR | AVAX totalR | ONDO totalR | VIRTUAL totalR | агрегат | meanR |
|---|---|---|---|---|---|---|
| 0 (gross) | +10.94 | +7.84 | +10.16 | +13.14 | **+42.1R** | +0.117 |
| 5 (VIP taker) | +5.19 | +3.56 | +5.19 | +6.10 | **+20.0R** | +0.055 |
| 7 (канон движка) | +2.89 | +1.86 | +3.20 | +3.28 | **+11.2R** | +0.031 |
| 10 (spot taker 0.1%) | −0.56 | −0.71 | +0.22 | −0.95 | **−2.0R** | −0.006 |

**Вывод:** edge на его стрелках/стопе **реален, но крошечный** (~+0.12R/сделку gross) и **линейно съедается издержками — точка безубытка ≈ 7–8 bps/side.** При спотовом тейкере 0.1% (10 bps) уходит в ноль/минус на всех 4 сериях. ⇒ Его gross-цифры не обман (воспроизведены), но живут только при **дешёвом исполнении** (maker-лимитки / VIP-tier / BNB-скидка). Вопрос переформулирован: не «работает ли стратегия», а «можно ли исполнять ≤ ~5 bps/side».

**Что это даёт вердикту §5:** NO-GO при taker-издержках **подтверждён и уточнён** (не «сигнал плохой», а «edge меньше издержек»). Условный GO возможен только при доказанном maker-исполнении + OOS/robustness (фавориты выбраны постфактум; его же «2 месяца в минус за год» = высокая дисперсия). Формальную смену вердикта — за автором.
