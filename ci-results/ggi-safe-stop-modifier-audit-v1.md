# GGI Safe-stop causal modifier audit v1

Дата: 2026-08-04

## Цель

Проверить, можно ли объяснить остаточные ошибки простого volatility baseline

```text
SafeDistance = 12.291783 × SMA(TrueRange, 55)
```

одним общим причинным модификатором без asset-specific коэффициентов, свободного перебора периодов и использования будущих данных.

Это исследование относится только к реконструкции приватного Safe stop. Оно не является проверкой качества BUY/SELL labels и не меняет отдельно полученный profitability verdict.

## Дизайн проверки

Линейные модели обучались только на четырёх исходных development observations:

```text
ONDO 15m BUY
AVAX 1h BUY
LTC 2h BUY
BNB Spot 15m SELL
```

Текущий независимый пакет использовался для falsification/ranking:

```text
LINK 2h BUY
DASH 1h SELL
1000PEPE 15m BUY
1000PEPE 1h SELL
DOGE 30m SELL
INJ 1h SELL
TAO 15m BUY
```

AAVE 2h сохранён в machine result, но исключён из clean ranking как state-affected/anomalous observation.

Проверены только заранее ограниченные causal scalar families:

```text
ATR14 / ATR55
ATR55 / ATR100
Outer width / ATR55
Inner width / ATR55
Outer width expansion относительно 20 прошлых баров
направленное расстояние Entry→Mean / ATR55
направленное расстояние Entry→Inner / ATR55
adverse swing 20 / ATR55
current True Range / ATR55
range5 / range20
```

Каждый кандидат использовался отдельно. Многомерная модель на этой малой выборке намеренно не строилась.

## Baseline

```text
SafeDistance = 12.291783 × SMA(TR,55)
Validation MAE:              1.2368 ATR55-множителя
Validation max abs error:    3.0837 ATR55-множителя
```

Baseline остаётся полезным volatility envelope, но ранее уже был отвергнут как точная приватная формула.

## Лучший проверенный scalar

Лучшим по текущему validation MAE оказался:

```text
directionalMeanGapAtr55
```

Формула, обученная только на исходных четырёх observations:

```text
SafeDistance = ATR55 ×
  (12.666599 - 0.076980 × directionalMeanGapAtr55)
```

где `directionalMeanGapAtr55` — причинное направленное расстояние от Entry до текущего GGI Mean, нормированное на ATR55.

Результат:

```text
Validation MAE:              1.1982 ATR55-множителя
Validation max abs error:    2.9744 ATR55-множителя
MAE improvement vs baseline: 3.12%
```

Это слишком малое улучшение. Оно не решает структурные расхождения: например, ошибка INJ всё ещё около `+2.97 × ATR55`, а PEPE 1h — около `+1.61 × ATR55`.

## Рейтинг верхних кандидатов

| Feature | Validation MAE | Max abs error | Improvement vs baseline |
|---|---:|---:|---:|
| directionalMeanGapAtr55 | 1.1982 | 2.9744 | +3.12% |
| directionalInnerGapAtr55 | 1.2065 | 3.0446 | +2.45% |
| currentTrOverAtr55 | 1.2205 | 3.0484 | +1.32% |
| adverseSwing20OverAtr55 | 1.2312 | 3.0578 | +0.45% |
| range5OverRange20 | 1.2476 | 3.0923 | -0.88% |

Остальные width/volatility-regime candidates также не улучшили baseline или ухудшили его.

## Вердикт

```text
NO MEANINGFUL SAFE-STOP MODIFIER IDENTIFIED
```

Ни один из проверенных причинных scalar modifiers не дал practically meaningful улучшения. Лучший результат `+3.12%` существенно ниже заранее установленного будущего acceptance gate `≥25%` снижения MAE.

Следовательно:

1. точная приватная Safe-stop formula остаётся неидентифицированной;
2. нельзя заявлять, что stop является просто `12.3 × ATR55`;
3. нельзя заявлять, что добавление положения относительно Mean решило реконструкцию;
4. для profitability audit разумно продолжать использовать заранее заданный stop envelope, а не выдавать proxy за формулу автора;
5. дальнейшая подгонка по текущим observations остановлена.

## Замороженный кандидат для следующего независимого пакета

Только для строгой будущей проверки без refit заморожен:

```text
status: candidate_not_validated
feature: directionalMeanGapAtr55
SafeDistance = ATR55 ×
  (12.666599 - 0.076980 × directionalMeanGapAtr55)
```

Он выбран после просмотра текущего validation package, поэтому не является validated model.

Acceptance gate на следующем полностью новом пакете:

```text
1. минимум 8–12 новых matched Safe setups;
2. минимум 25% снижение MAE против fixed ATR55 baseline;
3. отсутствие устойчивого bias по BUY/SELL и timeframe;
4. max absolute distance error < 12% на clean observations;
5. никаких изменений формулы после получения пакета.
```

Если gate не выполнен, candidate окончательно отклоняется и точную Safe-stop реконструкцию следует считать непрактичной без новых наблюдаемых полей/состояний индикатора.

## Что прислать для независимой проверки

Для каждого из 8–12 новых активных setups нужны:

```text
Symbol/feed
Timeframe
Direction BUY/SELL
Signal timestamp + timezone
Entry
Safe stop
Risk stop
Safe add
Risk add
Mean/partial
Full target
State: new / active / add / partial / closed
CSV того же symbol/timeframe, содержащий signal row
```

Требования к пакету:

- не использовать ONDO/AVAX/LTC/BNB/LINK/DASH/PEPE/DOGE/INJ/TAO observations из текущего fit/ranking;
- оба направления;
- минимум два timeframe, желательно 2h и 15m/1h;
- желательно 4–6 ликвидных активов;
- Safe и Risk должны относиться к одному и тому же сигналу;
- точные числа лучше записать текстом, а не восстанавливать по пикселям.

Machine-readable result: `ci-results/ggi-safe-stop-modifier-audit-v1.json`.
