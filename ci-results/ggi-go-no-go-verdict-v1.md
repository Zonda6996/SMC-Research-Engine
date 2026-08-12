# GGI Buy/Sell — provisional go/no-go verdict v1

Дата: 2026-08-04

## Короткий ответ

```text
GGI 2h:        CONDITIONAL GO для forward validation, не для заявления о готовой системе.
GGI 1h:        NO-GO как универсальный режим; допускается только asset-specific research.
GGI 5m:        NO-GO для торговли по текущей реконструкции; fidelity недостаточна.
GGI 3m/1m:     NO-GO при текущих cost assumptions.
Exact replica: NO-GO / NOT ACHIEVED.
```

Самый важный практический результат исследования: **реальные GGI labels с corrected moving management дают сильный и межактивный результат на 2h**, но до final production verdict остаются три критических неизвестных: repaint, exact BE execution и exact private Safe stop. Поэтому сейчас оправдан не запуск как доказанной системы, а узкий forward-test 2h с реальными уровнями GGI.

## Что является установленным

### Сигналы и management

- Shapes из CSV — реальные общие BUY/SELL labels GGI.
- Второй non-overlap filter применять нельзя: active-position gating уже встроен в Shapes.
- Entry для исследования: next-bar open.
- Partial: wick touch moving Mean.
- Full: candle close beyond moving opposite Inner.
- Dashboard terminal arithmetic:

```text
Trades = Partial + Stop + Full fix
Winrate = (Partial + Full fix) / Trades
```

- На BTC 15m corrected terminal semantics дали точное совпадение:

```text
85 Trades / 24 Partial / 17 Stop / 44 Full / 80.0% WR
```

- Safe/Risk labels общие; режимы отличаются management.
- Надёжные black-box отношения:

```text
RiskDistance ≈ 0.694 × SafeDistance
Add ≈ midpoint(Entry, Stop)
```

### Что не восстановлено

- Точная формула private Safe stop.
- Точная execution semantics BE после Partial.
- Доказательство отсутствия repaint/recalculation на закрытых исторических свечах.
- Venue-specific funding и реальные пользовательские fee/slippage assumptions.

## Profitability matrix

| Область | Evidence | Costs | Fidelity risk | Решение сейчас |
|---|---|---|---|---|
| 2h Safe no-add | 5/5 holdout assets положительны в central corrected cell; pooled `+0.0669R`, PF `1.759` | при 6 bps/fill `+0.0615R`, PF `1.660`; break-even около `68.6 bps` one-way | exact stop/BE и repaint не закрыты | **CONDITIONAL GO: forward validation** |
| 2h Risk | stop ratio подтверждён, но private Safe base и BE ещё proxy | cost budget в целом выглядит достаточным в corrected grid | выше, чем no-add Safe, из-за более короткого stop | **RESEARCH ONLY** до live reconciliation |
| 2h with-add | add geometry подтверждена | больше fills; результат чувствителен к BE at entry vs blended average | exact BE после add неизвестен | **HOLD** |
| 1h pooled | около `+0.0013R`, PF `1.046` gross | при 6 bps `-0.0057R`, PF `0.950`; break-even около 9 bps | heterogeneous assets | **NO-GO universal** |
| SOL 1h | положительный локальный результат | может переживать умеренные costs | один asset, selection risk | **ASSET-SPECIFIC RESEARCH ONLY** |
| XRP/ETH 1h | отрицательные central results | costs ухудшают | — | **NO-GO** |
| 5m pooled | corrected central gross `-0.0091R`, PF `0.929` | около `-0.0703R` при base costs | exact stop/BE особенно важны | **NO-GO current reconstruction** |
| 3m/1m proxy | отдельные gross-positive примеры | break-even cost лишь несколько bps, при 6 bps отрицательно | выборка мала | **NO-GO** |
| Standard | geometry около 1.14R без add / 2R после add; stateful acceptance gate | полноценного corrected multi-asset net audit нет | mode state ещё не восстановлен | **NOT EVALUATED / HOLD** |

## Почему 2h заслуживает продолжения

Центральная corrected 2h cell Safe 12×TR55, no-add, next-bar entry BE:

```text
517 trades
ETH 2h:  +0.067R, PF 1.57
SOL 2h:  +0.084R, PF 2.00
XRP 2h:  +0.040R, PF 1.42
AAVE 2h: +0.101R, PF 2.96
BNB 2h:  +0.052R, PF 1.45
Pooled:  +0.0669R, PF 1.759
6 bps:   +0.0615R, PF 1.660
```

Плюс не сосредоточен в одном активе: все пять independent holdout assets положительны. Запас до break-even costs велик относительно 1h/5m. Это наиболее весомое evidence за всё исследование.

Однако stop `12×TR55` — не формула автора, а центральная точка заранее заданного volatility envelope. Поэтому корректная формулировка: **2h path-management устойчив в разумной окрестности volatility stops**, а не «точная Safe-стратегия доказана».

## Почему нельзя дать final GO прямо сейчас

### 1. Repaint не проверен live

Все backtests используют исторические TradingView exports. Если закрытые Shapes исчезают или bands пересчитываются после новых свечей, historical результат завышен. Инструмент сравнения готов, но последовательных snapshots ещё нет.

### 2. BE подтверждён концептуально, но не воспроизведён точно

Пользователь подтвердил Partial → BE. Наивный OHLC wick BE не совпадает с dashboard. На 2h next-bar BE bounds дают хороший результат, но реальная механика может зависеть от lower-TF path, confirmed state или blended average после add.

### 3. Safe stop остаётся proxy

Ни `12.3×ATR55`, ни десять causal scalar modifiers не восстановили private stop. Лучший modifier улучшил MAE только на 3.12%, поэтому точная replica не достигнута.

### 4. Funding ещё отсутствует

Fees/slippage sensitivity добавлена по фактическим fills, но funding не включён. Для Bybit perpetuals нужны settlement-aligned данные и реальные holding intervals. На 2h cost cushion большой, но funding всё равно должен войти в final net result.

## Разделение двух разных целей

### Цель A: создать торгово пригодную систему на основе GGI labels

Статус:

```text
2h Safe no-add: PROMISING / CONDITIONAL GO TO FORWARD TEST
```

Для этой цели не требуется точная копия private stop, если независимый forward-test с реальными отображаемыми уровнями GGI подтверждает expectancy.

### Цель B: полностью скопировать private GGI

Статус:

```text
NOT ACHIEVED
```

Подтверждены terminal semantics, Risk/Safe ratio и add geometry, но Safe stop, BE execution и Standard state gate не восстановлены полностью.

Нельзя смешивать эти цели: неудача exact replica не аннулирует 2h trading evidence, а положительный 2h proxy audit не доказывает fidelity копии.

## Решение по следующему этапу

### Разрешённый этап: узкий 2h forward validation

Только:

```text
Assets: BTC, ETH, SOL, XRP, BNB (можно добавить AAVE)
Mode: Safe
Position: no-add как основной preregistered вариант
Entry: next-bar market/open proxy
Partial/Full: реальные уровни GGI
Stop/BE: реальные отображаемые уровни и state индикатора, а не reconstructed proxy
Costs: записывать каждый fill, fee, slippage и funding
```

Отдельный shadow ledger может вести with-add, но его нельзя смешивать с основной no-add серией до идентификации BE after add.

### Не разрешённый этап

- не оптимизировать stop по текущим holdout results;
- не выбирать активы задним числом по лучшему PF;
- не запускать 5m/3m/1m как рабочую систему;
- не объявлять `80% WR` доказательством прибыли;
- не выдавать `12×TR55` за private Safe stop;
- не считать отсутствие repaint доказанным без snapshots.

## Условия final GO

Все обязательны:

1. **Anti-repaint:** минимум две live серии — 2h и 5m/15m, по 4–10 snapshots; никаких historical Shape changes на закрытых барах. Historical band changes должны либо отсутствовать, либо не менять outcomes.
2. **2h forward sample:** заранее зафиксированный multi-asset ledger, минимум 100 завершённых сделок суммарно и разумное покрытие нескольких рыночных режимов.
3. **Net expectancy:** положительный результат после реальных fees, slippage и funding; PF желательно `>1.2`, а не пограничный `1.01`.
4. **Concentration:** результат не должен зависеть от одного актива, одной стороны или нескольких экстремальных сделок.
5. **BE reconciliation:** реальные dashboard/alert transitions должны определить хотя бы no-add BE semantics.
6. **Operational stability:** timestamps сигналов и уровни должны быть доступны причинно после закрытия signal candle.

## Условия NO-GO

Любого одного критического условия достаточно для остановки:

- historical BUY/SELL Shape repaint на закрытых свечах;
- material historical band recalculation, меняющая target/outcome ledger;
- 2h forward net expectancy `≤0` после заранее зафиксированного sample;
- PF `≤1` после реальных costs;
- положительный результат полностью исчезает при исключении одного актива;
- фактический BE/stop state невозможно получить причинно или исполнить;
- реальные one-way costs/funding систематически превышают доступный edge;
- frozen stop modifier снова проваливает независимый пакет и exact replica остаётся обязательной целью пользователя.

## Что требуется от Никиты сейчас

### Пакет 1 — anti-repaint, главный приоритет

Минимум:

```text
Один BTC/ETH/SOL 2h: 4 последовательных CSV
Один BTC/ETH/SOL 5m или 15m: 4 последовательных CSV
Safe/Risk dashboard screenshot на первом и последнем snapshot
```

Лучше 5–10 snapshots на серию: при сигнале, после закрытия signal candle, через 1/3/10 баров, после Partial и после Full/Stop.

### Пакет 2 — новый Safe-stop validation

8–12 полностью новых matched Safe/Risk setups, не повторяющих текущие observations. Нужны точные Entry, Safe/Risk Stop, Add, Mean, Full target, signal timestamp и CSV.

### Пакет 3 — реальные execution assumptions

```text
Биржа/тип аккаунта
maker/taker fee
обычно market или limit entry
оценка slippage по 2h активам
используется ли add реально
funding нужно учитывать как perpetual funding конкретной биржи
```

## Итог

```text
Продолжать исследование имеет смысл.
Ставка — только на 2h и только через forward validation.
Точную копию GGI пока считать не полученной.
1h/5m/3m/1m не запускать как универсальную систему.
```

Связанные артефакты:

- `ci-results/ggi-corrected-gross-audit-v2.md/.json`;
- `ci-results/ggi-state-machine-fidelity-v1.md/.json`;
- `ci-results/ggi-safe-stop-modifier-audit-v1.md/.json`;
- `ci-results/ggi-anti-repaint-collection-protocol-v1.md`;
- `ci/research/compareGgiExportSnapshots.ts`.
