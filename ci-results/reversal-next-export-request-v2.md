# Следующий TradingView export для Reversal — минимальный информативный запрос

Дата: 2026-08-01

## Что уже доказано

- В проекте есть 61 820 строк и 268 exact BUY/SELL labels с OHLC и Apex/GGI линиями.
- Простые per-bar условия не работают.
- State machine только на inner/outer touch, RSI/Stoch, dwell, recovery и re-arm тоже не прошла group holdout:
  - v1 Futures OOS: 5.60% precision / 18.07% recall;
  - v2 long-memory Futures OOS: 6.89% precision / 12.65% recall.
- Значит, проблема не в недостатке ещё одного RSI-порога. В экспортированных OHLC/Apex полях пока отсутствует или не наблюдается важное состояние.

## Самый ценный следующий export

Нужен **один непрерывный CSV на 15m и один на 1h**, лучше BTCUSDT.P Bybit Futures, за тот же период, но с дополнительными plot/series из самого GGI Buy/Sell. Не нужен новый набор монет до тех пор, пока не откроется скрытое состояние.

Сохранять в CSV:

1. `time, open, high, low, close, volume`.
2. Все текущие Apex/GGI линии:
   - Mean;
   - Upper Inner;
   - Lower Inner;
   - Upper Outer;
   - Lower Outer.
3. **Каждую доступную числовую plot-серию самого GGI Buy/Sell**, даже если она не отображается на графике.
4. Отдельные plot-серии BUY и SELL без объединения:
   - raw condition до `plotshape`, если Pine/Data Window её показывает;
   - финальный BUY/SELL shape;
   - любые `0/1`, `true/false`, score или oscillator series.
5. Если индикатор экспортирует только видимые plots — включить в Style все числовые plot-линии и значения в Data Window, затем экспортировать.

## Обязательные поля для проверки гипотезы

Если они доступны в Data Window, особенно важны:

- fear/greed score и его сглаженная версия;
- buy-side / sell-side score;
- threshold или trigger line;
- internal state/armed/pending/rearm/cooldown counters;
- volume/volatility/momentum components;
- `request.security` higher-timeframe series, если они выводятся отдельным plot;
- любые невидимые plot-серии, которые меняются только возле настоящего сигнала.

Не надо вручную вводить значения. Нужен именно экспорт CSV из TradingView/Data Window.

## Как получить максимально различающий датасет

- Не брать только последние 300 строк.
- Минимум 10 000 строк на TF; лучше тот же длинный диапазон, что уже экспортирован.
- Включить несколько обычных зон без сигнала и несколько BUY/SELL.
- BTC Futures 15m/1h — первичный источник для reconstruction.
- После нахождения скрытой series один ETH Futures 15m и один SOL Spot 15m нужны только как OOS-проверка.

## Что не нужно сейчас

- Скриншоты сделок и trade-plan: они не раскрывают trigger formula.
- Новые Fib/SMC/ликвидность поля: они могут помочь собственному Edge, но не восстановлению Reversal.
- Ещё одна сетка RSI/Stoch thresholds на тех же полях: v2 уже показала, что это не решает задачу.

## Если GGI Buy/Sell не экспортирует скрытые series

Тогда нужен пакет **matched screenshots + CSV**:

- 20 настоящих BUY и 20 настоящих SELL;
- для каждого 50–100 баров слева и 20 справа;
- 40 matched no-signal эпизодов с тем же Apex/price geometry;
- точный TF, symbol, feed, Risk Mode;
- значения Data Window на сигнальном баре и 5–10 баров до него.

Но сначала стоит проверить именно дополнительные plot-серии: это даст больше информации на один пользовательский шаг и позволит реконструировать состояние, а не угадывать его по цене.
