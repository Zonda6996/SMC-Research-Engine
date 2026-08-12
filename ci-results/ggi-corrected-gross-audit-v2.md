# GGI corrected gross/net audit v2

Дата: 2026-08-04

## Что изменено относительно прошлых результатов

Старые holdout numbers нельзя использовать напрямую: в старом replay Full засчитывался по wick Inner, а BE работал как наивный next-bar OHLC stop. Это противоречило найденной BTC 15m terminal semantics.

Новый replay зафиксирован заранее:

```text
Shapes: common BUY/SELL из CSV
Entry: next-bar open
Partial: wick touch moving Mean
Full: candle close beyond moving opposite Inner
Stop: adverse wick, stop-first
Add: 50% initial + 50% midpoint; average=(entry+add)/2
Safe envelope: 8/10/12/14/16 × SMA(TR,55)
Risk: 0.694 × Safe
BE bounds:
  optimistic-initial-stop — после Partial не применять буквальный OHLC BE
  next-bar-blended-be    — со следующей свечи stop на blended average
  next-bar-entry-be      — со следующей свечи stop на initial entry
Costs: 0 / 3 / 6 / 10 bps per one-way fill
```

Второй non-overlap filter не применяется: raw exported Shapes уже отражают state/gating.

## Масштаб

Обработано 23 datasets:

- BTC/ONDO: 15m, 1h, 2h;
- ETH/SOL/XRP/AAVE/BNB: 1h, 2h;
- BNB 3m и SP500 1m;
- BTC/ETH/SOL/XRP/BNB 5m, последние 20,000 bars.

Проверено 60 cells: Safe/Risk × 5 stop multipliers × 3 BE bounds × no-add/with-add.

## Основной corrected holdout: ETH/SOL/XRP/AAVE/BNB 1h/2h

### Safe, no-add, central 12×TR55

При BE `next-bar-entry-be`:

```text
908 trades
mean gross: +0.0296R
PF:         1.278
block bootstrap q05: -0.0009R
base-cost mean: +0.0199R
base-cost PF:   1.185
```

Однако pooled значение скрывает timeframe split:

| TF | Trades | Mean gross R | PF | Mean net R при 6 bps/fill | PF net | Break-even one-way cost |
|---|---:|---:|---:|---:|---:|---:|
| 2h | 517 | +0.0669 | 1.759 | +0.0615 | 1.660 | 68.6 bps |
| 1h | 599 | +0.0013 | 1.046 | -0.0057 | 0.950 | 9.0 bps |

2h остаётся сильным после corrected semantics. 1h находится около нуля и после базовых costs становится отрицательным.

При `next-bar-blended-be` результаты практически такие же для no-add, потому что без add blended average равен entry. Различие BE bounds проявляется в основном после add.

### 2h corrected result

Для Safe no-add central 12×TR55:

- ETH 2h: `+0.067R`, PF `1.57`;
- SOL 2h: `+0.084R`, PF `2.00`;
- XRP 2h: `+0.040R`, PF `1.42`;
- AAVE 2h: `+0.101R`, PF `2.96`;
- BNB 2h: `+0.052R`, PF `1.45`.

Все 5 holdout assets положительны gross. При 6 bps one-way costs все пять остаются gross-positive after costs в этой центральной diagnostic cell. Это пока сильный promising result, но не окончательная private-stop реконструкция: `12×TR55` — baseline envelope point, не найденная формула автора.

### 1h corrected result

- ETH 1h: `-0.035R`, PF `0.77`;
- SOL 1h: `+0.056R`, PF `1.90`;
- XRP 1h: `-0.072R`, PF `0.46`;
- AAVE 1h: `-0.003R`, PF `0.97`;
- BNB 1h: `+0.004R`, PF `1.03`.

1h снова неоднороден. SOL 1h остаётся исключением, XRP 1h — устойчиво слабый. Нельзя говорить о едином 1h edge.

## BE bounds и sensitivity

Для corrected holdout pooled equal-dataset mean gross по Safe no-add:

| Stop | Optimistic no-literal-BE | Next-bar blended BE | Next-bar entry BE |
|---:|---:|---:|---:|
| 8 | отрицательный | слабый плюс | слабый плюс |
| 10 | отрицательный | плюс | плюс |
| 12 | отрицательный | плюс | плюс |
| 14 | отрицательный | плюс | плюс |
| 16 | отрицательный | плюс | плюс |

Это существенный результат: знак зависит от того, как интерпретировать пользовательское BE. Поэтому optimistic-bound результат не является допустимым final verdict, а conservative BE bounds нужно уточнить дальше. При этом на 2h corrected result остаётся устойчиво положительным и после 6 bps cost в обеих next-bar BE bounds.

Для with-add BE semantics важны сильнее. В некоторых cells entry-BE даёт плюс, а blended-BE — около нуля или минус. Поэтому add нельзя оценивать по raw return без точной формулы BE и без risk-normalized sizing.

## Net cost budget

Cost tiers в новом JSON:

```text
0 bps  — gross diagnostic
3 bps  — low
6 bps  — base
10 bps — stressed
```

Это расходы на каждый one-way fill, включая entry, add, partial и final exit. Funding пока не добавлялся, потому что для точного расчёта нужны funding settlements и корректные mode-specific holding intervals.

Практический вывод:

- **2h:** central corrected Safe no-add имеет большой запас: break-even около `68.6 bps` one-way; при 6 bps mean `+0.0615R`, PF `1.66`.
- **1h:** запас мал: около `9.0 bps` one-way; обычные costs уже могут съесть edge.
- **5m:** central pooled corrected result отрицателен ещё gross (`-0.009R`), а при 6 bps становится около `-0.070R`; текущий stop baseline/BE всё ещё недостаточно faithful для verdict.
- **3m/1m:** gross выглядит положительно в этой proxy-модели, но break-even cost порядка нескольких bps; после 6 bps net становится отрицательным. Без реальных fills и комиссии эти TF нельзя считать пригодными.

## Важное ограничение текущей реализации

В машинном audit `meanHoldingHours` для aggregate cells намеренно не интерпретируется, потому что summary объединяет разные timeframe. Dataset-level holding bars/hours сохранены в JSON. Следующим шагом нужно вынести holding/time-in-market в отдельную корректную агрегацию по dataset и ввести overlap-adjusted exposure.

Также текущий audit использует proxy stop `SMA(TR,55)`, а не private Safe stop. Поэтому:

- positive 2h result — evidence в пользу устойчивого GGI path-management при reasonable volatility envelope;
- это не доказательство точной торговой доходности private Safe/Risk;
- отрицательный 5m result не является окончательным отрицательным verdict против GGI.

## Текущий вердикт

```text
2h: PROMISING — corrected gross и base-cost result устойчивы на пяти holdout assets.
1h: UNRESOLVED/WEAK — heterogeneous, base costs обычно убирают pooled edge.
5m: UNRESOLVED — corrected proxy gross около нуля/ниже; exact stop и BE ещё не восстановлены.
3m/1m: COST-UNVIABLE under current 6 bps tier; require real fee/slippage inputs.
```

Следующие наиболее весомые работы:

1. anti-repaint snapshot diff на последовательных TradingView exports;
2. exact Safe-stop modifier validation на новом независимом screenshot+CSV пакете;
3. time-in-market и overlap-adjusted risk accounting;
4. funding/commission values пользователя и повторный net audit;
5. после этого — go/no-go matrix по режимам и timeframe.

Машинный результат: `ci-results/ggi-corrected-gross-audit-v2.json`.
