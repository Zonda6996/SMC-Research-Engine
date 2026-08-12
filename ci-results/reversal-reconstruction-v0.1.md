# Zonda Reversal — reconstruction v0.1

Дата: 2026-07-31

## Что сделано

- Оцифрованы 16 наблюдений Reversal и 11 новых Apex anchors из BTC/ETH/SOL скриншотов.
- Все указанные пользователем времена переведены из Казахстана (UTC+5) в UTC.
- 11 Reversal events сопоставлены с точными Binance Spot candles; 5 пока unresolved:
  - ETH 45m: Binance archive не содержит нестандартный 45m TF;
  - SOL 31.07: дневной Spot archive ещё не опубликован на момент проверки;
  - SOL 20–21.07 no-signal: есть только окно, нет точного candidate timestamp.
- Добавлен research-only detector family H0/H1/H3/H4/H5 в `src/core/signals/ReversalResearch.ts`.
- Production `detectReversals()` и все defaults не менялись.

## Главная находка

Текущий H0 (касание внешней Apex границы → направленная свеча → re-arm у mean) не совпал ни с одним из 11 точных событий даже при допуске ±4 бара. H1/H3/H4/H5 в текущей edge-anchored постановке также дали 0/11.

Это сильное отрицательное знание: **Reversal не является простым событием у текущей внешней Apex границы**. Более того, несколько эталонных сигналов находятся заметно внутри текущей реконструкции Apex:

- BTC 26.07 15m SELL: high примерно на 0.47% ниже model outer upper;
- BTC 23.07 15m BUY: low примерно на 0.63% выше model outer lower;
- BTC 25.07 1h BUY: low примерно на 2.56% выше model outer lower;
- ETH 22.07 1h SELL: high примерно на 3.48% ниже model outer upper;
- SOL 15.07 30m SELL: high примерно на 2.74% ниже model outer upper;
- SOL 25.07 5m SELL: high примерно на 0.73% ниже model outer upper.

Следовательно, минимум одна из предпосылок неверна:

1. сигнал взводится существенно раньше и сохраняет состояние дольше текущих 8 баров;
2. detector использует внутреннюю/скрытую линию или другую версию Apex;
3. используется отдельный fear/greed oscillator, а Apex только визуальный контекст/менеджмент;
4. TradingView label timestamp — не момент первичного extreme condition;
5. на скриншотах vendor Apex и Reversal могут иметь разные внутренние band calculations.

## Что НЕ следует делать

- Не заменять production detector новым H1/H3/H4/H5: данных для precision нет, recall у текущих постановок нулевой.
- Не подгонять один коэффициент ширины Apex так, чтобы он накрыл все сигналы: расстояния и знаки неоднородны, а SOL 5m SELL визуально вообще не касается красной зоны.
- Не использовать outcome (partial/full/stop) для объяснения появления сигнала — это look-ahead.
- Не принимать vendor Winrate за честную прибыльность: Partial считается победой наравне с Full fix.

## Следующий исследовательский шаг

Приоритет теперь не перебор edge threshold, а проверка двух семейств:

### A. Long-memory state machine

- найти последнее достижение inner/outer Apex до сигнального бара;
- измерить lag в барах по всем positive;
- проверить expiry на mean crossing, локальном swing/reclaim и oscillator recovery;
- сравнить с точным no-signal window SOL 20–21.07.

### B. Отдельный fear/greed detector

Только наблюдаемые каузальные признаки:

- normalized distance from mean;
- RSI/stochastic momentum;
- return/volume volatility z-score;
- body/wick exhaustion;
- recovery from rolling extreme.

Выбор сначала по event reconstruction (precision/recall/timing), затем отдельный OOS и только потом PnL.

## Mode mapping

- Safe и Risk в прямых A/B примерах имеют одинаковый signal timestamp; различаются add/stop.
- SOL 31.07 показывает один и тот же BUY в Safe, Risk и Standard.
- Старый BTC пример Standard no-signal остаётся противоречием; рабочая гипотеза пользователя — Standard появляется только когда fixed plan может обеспечить около 1:2 от средней цены после add. Это относится к eligibility/trade plan и пока не переносится в detector.

## Apex

Новые BTC/SOL anchors записаны в `ci-results/reversal-observed-events-2026-07-31.json`. Они дают следующую cross-TF calibration wave после завершения Reversal event analysis. Текущие Apex defaults пока сохраняются.
