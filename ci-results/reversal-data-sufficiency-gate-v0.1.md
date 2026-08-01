# Reversal — data sufficiency gate v0.1

Дата: 2026-07-31

## Вывод после текущего раунда

Пытаться подгонять production Reversal сейчас нельзя. Мы проверили несколько независимых Pine-compatible семейств на 11 точных positive events и приблизительном SOL 5m no-signal окне:

- Apex outer/inner edge + directional candle: 0/11;
- простые RSI/Stochastic/MFI/CCI/volume/body rules: отдельные признаки покрывают максимум 6/11, но дают много ложных срабатываний;
- bounded 48-bar displacement/extreme state: до 3/11 в честной negative-check реализации, 8–15 сигналов в no-signal window;
- smoothed composite Fear/Greed OHLCV: максимум 3/11, при этом 1–4 false signals; лучший utility вариант 1/11 и 0 false signals;
- fast/slow composite spread + pivot/label offset: максимум 2/11 и 0 approximate false signals.

Это не означает, что данных «мало вообще». Это означает, что **точных наблюдений достаточно для отсечения наивных формул, но недостаточно для выбора оригинальной формулы**.

## Что полезного добавила фраза автора про стоп

Цитата про volatility-adaptive stop относится прежде всего к `TradePlan/PositionManager`, а не доказывает trigger Reversal.

Она поддерживает проверяемую геометрию:

```text
step / add distance = f(current volatility)
stop = mirrored/add-derived geometry
position size = fixed account risk / stop distance
```

То есть широкий стоп не должен означать больший денежный риск: при росте волатильности размер позиции уменьшается. Это важно для восстановления Safe/Risk/Standard, но не объясняет, почему появляется BUY/SELL.

Текущая структурированная выборка почти не содержит точных entry/add/stop уровней одновременно с signal bar, поэтому ATR/realized-vol/Apex-width коэффициент пока нельзя честно оценить.

## Что нужно прислать, чтобы перейти к финальному detector search

### Минимальный пакет, без бесконечных скриншотов

Нужно не «ещё много сигналов», а сбалансированный пакет:

1. **12 положительных сигналов**:
   - 4 BTC, 4 ETH/SOL, 4 других активов;
   - минимум 3 таймфрейма: 5m, 15m, 1h;
   - хотя бы 2 Safe, 2 Risk, 2 Standard.
2. **12 отрицательных matched cases**:
   - тот же актив и TF, где визуально была близкая экстремальная ситуация, но Reversal не появился;
   - минимум 4 из SOL 20–21 июля, но с точными bar timestamps.
3. **6 A/B mode cases**:
   - тот же актив, TF, timestamp и сигнал;
   - Safe/Risk/Standard на одном месте.
4. **6 планов с уровнями**:
   - signal timestamp, entry, add, stop, partial, full;
   - хотя бы 3 из них Safe/Risk A/B на одном сигнале.

Итого: **30–36 хорошо размеченных случаев**, а не сотни случайных скриншотов.

## Как снимать один правильный случай

На TradingView:

- Symbol/feed: например `BINANCE:SOLUSDT` Spot или точный Futures feed;
- TF;
- timezone Kazakhstan UTC+5;
- открыт бар сигнала;
- включена строка статуса;
- видны 30–50 свечей до сигнала и 10 после;
- записаны O/H/L/C/V сигнального бара и 5–10 соседних;
- отдельно записаны Apex lines, если они включены;
- для trade-plan screen: entry/add/stop/partial/full;
- для no-signal: точный бар, на котором ожидался label, и факт `no signal`.

Критически важно отличать:

```text
labelAt — где Pine рисует метку
alertAt — когда условие стало известно без look-ahead
```

Если используются `pivot`/`offset`, эти времена могут отличаться.

## Когда данных уже достаточно

Можно переходить к выбору формулы, если одновременно выполняются:

- минимум 12 positive и 12 negative точных случаев;
- минимум 3 актива и 3 TF;
- формула выбирается на train и проверяется на отложенном asset/TF;
- precision ≥ 70% и recall ≥ 70% на reconstruction set — ориентир, не математический закон;
- timing error обычно не больше 1 бара выбранного TF;
- Safe/Risk signal timing объясняется одинаково, если это наблюдается;
- Standard mode имеет отдельную проверяемую eligibility/plan-логику;
- выбранный вариант не требует будущих свечей, кроме явно измеренного визуального offset;
- stop geometry и trigger объясняются раздельно.

## Решение сейчас

1. **Не подгонять текущие 11 positive events.**
2. **Не менять production Reversal.**
3. Запросить у пользователя следующий пакет из 30–36 случаев по схеме выше.
4. Параллельно можно реализовать исследовательский composite/pivot framework, но не включать его в Apex veto и UI как «оригинальный Reversal».
5. После получения пакета провести один финальный controlled search, а не бесконечный перебор гипотез.

Ветка `redesign/terminal-ui` не затрагивалась.
