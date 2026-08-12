# GGI 5m multi-asset state and proxy audit v1

Дата: 2026-08-04

## Главный вывод

Пять 5m экспортов содержат общие GGI BUY/SELL Shapes; Safe/Risk не меняют метки. Пользователь подтвердил:

- пока позиция активна, следующий сигнал не появляется;
- dashboard считает текущие 20,000 баров;
- Safe и Risk применяют к одной последовательности меток разный stop/management, поэтому terminal outcomes и иногда число завершённых Trades отличаются.

Safe/Risk screenshots были собраны правильно именно для сравнения management на одинаковых labels. Предыдущая трактовка CSV как mode-specific была ошибочной и удалена.

Frozen proxy-management не воспроизвёл реальные 5m dashboard outcomes: он систематически классифицирует слишком много сделок как Partial и слишком мало как Full fix. Поэтому его слабый PnL на BTC/ETH/SOL нельзя считать отрицательным verdict для настоящего GGI. Это falsification текущей BE/full semantics, а не labels.

## 1. Входные данные и общие labels

Каждый CSV содержит около 20,420 строк. Dashboard считает внутреннее окно текущих 20,000 баров; небольшая разница между counts CSV и dashboard может появляться на границе окна и из-за текущей незавершённой сделки.

| Asset | Full CSV BUY | Full CSV SELL | Total labels | Safe Trades | Risk Trades |
|---|---:|---:|---:|---:|---:|
| BTC | 49 | 41 | 90 | 84 | 89 |
| ETH | 35 | 42 | 77 | 74 | 81 |
| SOL | 49 | 31 | 80 | 76 | 79 |
| XRP | 51 | 27 | 78 | 78 | 81 |
| BNB | 56 | 46 | 102 | 99 | 100 |

Главное: Shapes — общая последовательность BUY/SELL. Safe/Risk screenshots нужны для сравнения того, как два management-режима классифицируют и завершают эти сигналы. Различия `Trades` не доказывают разные labels: они отражают dashboard window, текущую активную сделку и различную длительность/завершённость позиций.

## 2. Dashboard Safe и Risk

### Safe

| Asset | Trades | Partial | Stop | Full | WR | Full/Stop |
|---|---:|---:|---:|---:|---:|---:|
| XRP | 78 | 27 | 11 | 40 | 85.9% | 3.64 |
| SOL | 76 | 24 | 14 | 38 | 81.6% | 2.71 |
| ETH | 74 | 24 | 14 | 36 | 81.1% | 2.57 |
| BTC | 84 | 30 | 13 | 41 | 84.5% | 3.15 |
| BNB | 99 | 26 | 14 | 59 | 85.9% | 4.21 |
| **Total** | **411** | **131** | **66** | **214** | **83.9%** | **3.24** |

### Risk

| Asset | Trades | Partial | Stop | Full | WR | Full/Stop |
|---|---:|---:|---:|---:|---:|---:|
| XRP | 81 | 29 | 18 | 34 | 77.8% | 1.89 |
| SOL | 79 | 29 | 16 | 34 | 79.7% | 2.13 |
| ETH | 81 | 30 | 17 | 34 | 79.0% | 2.00 |
| BTC | 89 | 34 | 20 | 35 | 77.5% | 1.75 |
| BNB | 100 | 28 | 26 | 46 | 74.0% | 1.77 |
| **Total** | **430** | **150** | **97** | **183** | **77.4%** | **1.89** |

Risk dashboard содержит на 19 завершённых Trades больше, на 31 Stop больше и на 31 Full меньше. Метки при этом общие. Разница согласуется с более коротким Risk stop, иной длительностью позиций, текущим 20k dashboard window и числом незавершённых/завершённых сделок.

## 3. Минимальный payoff, необходимый для profitability

Если каждый Stop равен `-1R`, а Partial условно считать `0R`, средний Full должен превышать:

### Safe

```text
XRP  0.275R
SOL  0.368R
ETH  0.389R
BTC  0.317R
BNB  0.237R
Pooled 0.308R
```

Если средний Partial равен хотя бы `+0.1R`, pooled Safe Full threshold падает до `0.247R`.

### Risk

```text
XRP  0.529R
SOL  0.471R
ETH  0.500R
BTC  0.571R
BNB  0.565R
Pooled 0.530R
```

При Partial `+0.1R` pooled Risk threshold равен `0.448R`.

Это сильное косвенное evidence в пользу Safe: moving Inner Full обычно визуально существенно больше `0.25–0.40R`. Но dashboard counts не дают фактический average Full R и average Partial R, поэтому точный expectancy всё ещё требует правильного replay.

## 4. Signal-only endpoint study

На общих GGI labels pooled next-open fixed-horizon return:

| Horizon | Mean | One-sided p for positive edge |
|---|---:|---:|
| 6h | -0.087% | 0.909 |
| 12h | -0.269% | 0.999 |
| 24h | -0.406% | 0.998 |
| 48h | -0.680% | 1.000 |

Это подтверждает прежний рисунок: GGI не является простым endpoint directional forecast. Возможный edge должен находиться в path-dependent Mean/Inner management.

## 5. Frozen proxy-management на общих labels

Использован прежний envelope без refit. Safe/Risk proxy применяются к одной общей последовательности Shapes, как и требовалось. Результат остаётся diagnostic sensitivity, потому что stop и BE/full semantics ещё не совпадают с private GGI:

```text
Safe stop = 8/10/12/14/16 × SMA(TR,55)
Risk proxy = 0.694 × Safe
Partial = moving Mean
BE = blended average со следующего бара
Full = moving opposite Inner
```

Из 20 stop-first конфигураций только 4 дали pooled mean > 0 и PF > 1. Центральная Safe 12 no-add:

```text
418 trades
Mean -0.0024%
PF 0.991
Dashboard-like WR 88.8%
294 Partial / 44 Stop / 77 Full / 3 End
```

По dataset:

| Dataset | Mean | PF | Proxy outcomes Full/Partial/Stop |
|---|---:|---:|---:|
| BTC | -0.067% | 0.742 | 12/65/12 |
| ETH | -0.071% | 0.765 | 13/55/7 |
| SOL | -0.068% | 0.815 | 12/56/9 |
| XRP | +0.068% | 1.297 | 14/57/6 |
| BNB | +0.106% | 1.551 | 26/61/10 |

Сравнение с real Safe dashboard pooled:

```text
Real dashboard: 131 Partial / 66 Stop / 214 Full
Proxy replay:   294 Partial / 44 Stop /  77 Full
```

Это слишком большое и направленное расхождение, чтобы использовать proxy PnL как verdict. Replay массово превращает настоящие Full fix в Partial/BE.

Широкий Safe 14/16 proxy становится положительным, но выбирать его нельзя: stop envelope не совпадает с private stop и holdout не должен использоваться для post-hoc selection.

## 6. Что именно теперь нужно восстановить

Уже подтверждено:

```text
одна активная позиция блокирует появление следующей общей GGI метки
Safe и Risk используют общие BUY/SELL labels
Safe/Risk отличаются management и terminal outcomes
RiskDistance ≈ 0.694 × SafeDistance
Add ≈ midpoint(Entry, Stop)
Partial = moving Mean
после Partial -> BE
Full = moving opposite Inner
```

Главная неизвестность теперь не BUY/SELL edge и не dashboard arithmetic, а причинный порядок management:

1. когда Full получает приоритет над Partial/BE;
2. same-bar Mean + Inner semantics;
3. активируется ли BE по close/confirmed condition, а не по wick;
4. на каком historical line value считается Full;
5. учитывает ли dashboard импульсный Full без регистрации промежуточного Partial;
6. точная private Safe stop distance.

## 7. Вердикт

Это не тупик. Новый пакет доказал две вещи:

1. Safe 5m dashboard имеет очень сильную outcome structure на всех пяти активах: pooled `214 Full / 66 Stop`, WR `83.9%`.
2. Текущий proxy replay неверен именно по terminal taxonomy: `77 Full` вместо `214`. Поэтому его отрицательные BTC/ETH/SOL PnL нельзя применять к настоящему GGI.

По простому payoff bound Safe выглядит вероятно gross-положительным, если средний Full больше `0.308R` при нулевом Partial или `0.247R` при среднем Partial `+0.1R`. Для Risk требование заметно выше — около `0.53R` без учёта Partial.

Но окончательный net verdict требует exact trade ledger или исправленной causal state machine. На 5m после gross reconciliation обязательно рано добавить fees/slippage.

## 8. Следующий шаг

Приоритет теперь не новый набор активов и не подбор ATR:

1. восстановить same-bar Partial/Full/BE priority по BTC 15m, где dashboard уже полностью совмещён;
2. перенести одно правило без refit на эти пять 5m Safe dashboards;
3. replay общей последовательности labels вести отдельно с Safe и Risk management, учитывая dashboard window и текущую незавершённую сделку;
4. проверить counts и terminal categories;
5. вычислить actual gross R и payoff distribution;
6. затем добавить 5m fees/slippage.

Артефакты:

- `ci-results/ggi-five-minute-holdout-v1.json`
- `ci/research/runGgiFiveMinuteHoldoutV1.ts`
