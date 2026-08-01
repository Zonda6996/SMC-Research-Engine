# Reversal — следующий OHLCV-проход

Дата: 2026-07-31

## Границы исследования

Параллельную ветку `redesign/terminal-ui` не трогали. Работа выполнена на `fix/chart-restore-performance`.

Reversal проверяется только на стандартных данных свечи TradingView:

- open, high, low, close;
- volume;
- каузальные rolling transforms;
- никаких внешних данных, новостей, API sentiment или outcome.

## Первичный fingerprint

На 11 точных positive events посчитаны:

- RSI 7/14/21;
- Stochastic 14/28;
- MFI 14;
- CCI 20;
- ROC и импульс;
- ATR и volatility ratio;
- volume z-score, volume ratio, OBV slope;
- body/wick/close-location;
- rolling range;
- расстояние от Apex mean и внешних границ.

## Что уже видно

- Направление свечи подтверждается на 11/11 событиях.
- Stochastic recovery по широкому порогу — 6/11.
- Сжатие тела относительно предыдущей свечи — 6/11.
- MFI extreme — 5/11.
- Объём ниже среднего — 5/11.
- RSI recovery — 3/11.
- Простые экстремумы Stochastic/RSI/CCI и rolling range сами по себе покрывают мало событий.

Это пока не формула. Positive-only recall легко переоценить: любой слабый признак может часто встречаться случайно.

## Новая рабочая гипотеза

Reversal похож не на `Apex edge touch`, а на двухступенчатую OHLCV-машину:

```text
направленное/экстремальное состояние
→ ослабление продолжения или восстановление осциллятора
→ направленная свеча
→ BUY/SELL
```

Наиболее рациональное семейство для следующего теста:

```text
Stochastic recovery
+ body/wick/exhaustion state
+ directional candle
+ rolling extreme или normalized price displacement
```

Apex не считать обязательным входным условием. Его оставить отдельным контекстом и проверить только как дополнительный каузальный признак.

## Важная методологическая поправка

Сейчас нельзя выбирать между `Stoch recovery`, `body contraction`, `MFI` и их комбинациями: нет полноценного matched no-signal набора. Нужны отрицательные бары:

- тот же symbol и TF;
- близкое направление и volatility regime;
- похожее значение Stoch/MFI/RSI;
- но пользователь сообщает, что Reversal label не было.

Только после этого считать precision и false positives.

## Что делать следующим

1. Взять окно SOL 20–21 июля 5m и перебрать каждый закрытый бар как no-signal candidate.
2. Сравнить его признаки с positive SOL 5m и ближайшими BTC/ETH events.
3. Сформировать causal state machine с ограниченным memory window, без pivot look-ahead.
4. Отдельно проверить Pine-style historical repaint/offset: label может быть визуально отнесён назад после подтверждения.
5. Проверить OOS на одном отложенном активе/ТФ.
6. Только после reconstruction score подключать Safe/Risk/Standard trade manager.

Production `detectReversals()`, Apex defaults и дизайн-ветка не изменялись.
