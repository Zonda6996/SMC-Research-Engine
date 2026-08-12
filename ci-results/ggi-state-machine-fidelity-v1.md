# GGI terminal state-machine fidelity v1

Дата: 2026-08-04

## Цель

Проверить узкую causal-гипотезу о том, почему прежний BTC 15m replay давал `20 Partial / 17 Stop / 48 Full`, тогда как реальный Safe dashboard показывает `24 / 17 / 44`.

На этом этапе stop не подбирался заново. Зафиксирован прежний диагностический Safe proxy:

```text
entry = next-bar open
Safe stop proxy = 1.5 × расстояние от entry до противоположной Outer
Risk stop proxy = 0.694 × Safe proxy
add = midpoint(entry, stop)
```

Тестировались только terminal semantics:

- Partial: wick или close пересекает moving Mean;
- Full: wick или close пересекает moving opposite Inner;
- Full-first или BE-first на неоднозначной свече;
- BE в ту же свечу, со следующей свечи или отключён как OHLC stop;
- BE на initial entry или blended average после add.

## BTC 15m: точное совпадение terminal counts

Dashboard:

```text
85 Trades
24 Partial
17 Stop
44 Full fix
80.0% WR
```

Единственное содержательное изменение относительно прежнего fit, которое дало точное совпадение:

```text
Partial = wick touch moving Mean
Full    = close beyond moving opposite Inner
BE      = не моделируется как буквальный OHLC stop
Stop    = initial stop, stop-first
```

Результат:

```text
85 Trades
24 Partial
17 Stop
44 Full fix
80.0% WR
```

Прежний Full-by-wick вариант давал:

```text
20 Partial
17 Stop
48 Full fix
```

Следовательно, четыре спорные сделки — ровно те случаи, где цена касалась moving Inner тенью, но не подтверждала Full закрытием свечи и позже завершалась в категории Partial. Это существенно более простое объяснение swap `48→44 Full` и `20→24 Partial`, чем специальная asset-specific dashboard поправка.

## Что это доказывает, а что нет

Поддержано данными:

1. Для BTC 15m terminal taxonomy идеально согласуется с `Mean by wick / Full by close`.
2. Стоп-счёт не меняется: все 17 чистых Stop уже были локализованы правильно.
3. Full не обязательно является простым wick touch Inner. Для совпадения нужен подтверждённый close.
4. Буквальный OHLC BE после Partial не согласуется с dashboard: варианты same-bar/next-bar BE превращают слишком много будущих Full в Partial.

Пока не доказано:

1. Что private Pine действительно использует close для Full на всех режимах и рынках.
2. Что BE отсутствует. Пользователь подтвердил BE после Partial; результат означает только, что dashboard/Pine BE нельзя воспроизвести наивным `low/high touched entry/avg` по OHLC.
3. Что stop proxy является private Safe stop. Он остаётся диагностическим приближением.
4. Что совпадение BTC 15m означает прибыльность.

Наиболее аккуратная интерпретация BE: позиция действительно переводится в BE, но его активация/исполнение, вероятно, зависит от confirmed state или нижнего timeframe path, который не идентифицируется из одной OHLC-свечи. Поэтому для terminal dashboard fidelity его нельзя добавлять как немедленный wick stop.

## Проверка правила на пяти 5m CSV без refit

Правило `Mean wick / Inner close` было перенесено без изменения на последние 20,000 bars пяти экспортов. Результаты ниже используют common BUY/SELL labels. Safe/Risk отличаются только stop proxy.

### Safe proxy

| Dataset | Dashboard P/S/F | Replay P/S/F | Комментарий |
|---|---:|---:|---|
| BTC 5m | 30 / 13 / 41 | 28 / 21 / 40 | Full близко; stop proxy слишком короткий/неверный |
| ETH 5m | 24 / 14 / 36 | 33 / 14 / 27 | Stop точно; Partial/Full taxonomy не переносится |
| SOL 5m | 24 / 14 / 38 | 32 / 14 / 32 | Stop точно; 6 Full классифицированы как Partial |
| XRP 5m | 27 / 11 / 40 | 24 / 17 / 36 | stop proxy не совпадает |
| BNB 5m | 26 / 14 / 59 | 26 / 19 / 54 | Partial точно; 5 Stop↔Full отличаются |

Наиболее информативные совпадения:

- ETH и SOL: ровно совпадает количество Stop (`14`), значит на этих выборках stop proxy попал в dashboard stop count, но terminal Full требует ещё одной state-детали.
- BNB: ровно совпадает Partial (`26`), а Full отличается только на 5 сделок.
- BTC: Full отличается только на 1, Partial — на 2; основная ошибка сосредоточена в Stop.

### Risk proxy

Risk использован только как переносимая геометрическая проверка `RiskDistance = 0.694 × SafeDistance`, а не как точная private формула.

| Dataset | Dashboard P/S/F | Replay P/S/F |
|---|---:|---:|
| BTC 5m | 34 / 20 / 35 | 29 / 28 / 32 |
| ETH 5m | 30 / 17 / 34 | 31 / 21 / 22 |
| SOL 5m | 29 / 16 / 34 | 32 / 20 / 26 |
| XRP 5m | 29 / 18 / 34 | 26 / 24 / 27 |
| BNB 5m | 28 / 26 / 46 | 29 / 31 / 39 |

Risk proxy систематически даёт больше Stop и меньше Full, чем dashboard. Это ожидаемо, если исходный Safe proxy не является private Safe formula: умножение ошибочной базы на правильный ratio `0.694` не восстанавливает точный Risk stop.

## Важная проверка active-state трактовки

Если поверх уже экспортированных common Shapes дополнительно отбрасывать метки, которые возникают до завершения proxy-сделки, BTC 15m оставляет только 64 из 85 меток. Это противоречит dashboard `85 Trades`.

Следовательно, правило пользователя «пока сигнал активен, другой не появляется» уже встроено в экспортированную последовательность Shapes. Второй non-overlap фильтр применять нельзя: это двойная фильтрация и искусственное уменьшение Trades.

## Вердикт fidelity-этапа

1. BTC 15m terminal counts теперь воспроизведены точно: `24 / 17 / 44`.
2. Ключевой новый кандидат — **Partial по wick Mean, Full только по confirmed close beyond Inner**.
3. Наивный OHLC BE опровергнут как replay-правило dashboard, но реальный BE не опровергнут.
4. Common Shapes уже отражают state/gating; повторный sequential filter ошибочен.
5. Перенос на 5m частично поддерживает правило, но не даёт универсального точного совпадения. Остаток связан прежде всего с неточной private stop formula и, вероятно, дополнительной confirmed-state логикой Full/BE.
6. Gross profitability пока не пересчитывается по этому exact-count fit: совпадение terminal категорий ещё не даёт точных exit prices при BE и не идентифицирует Safe stop.

Машинный ledger всех 85 BTC 15m сделок, полный semantic grid и transfer-таблицы находятся в `ci-results/ggi-state-machine-fidelity-v1.json`.
