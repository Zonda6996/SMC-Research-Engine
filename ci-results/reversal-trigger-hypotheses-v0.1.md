# Zonda Reversal — trigger hypotheses v0.1

Дата: 2026-07-30
Статус: pre-implementation research protocol. Production/defaults не меняются.

## Что уже наблюдается

1. BUY на bullish candle, SELL на bearish candle — необходимое, но явно недостаточное условие.
2. Сигнал связан с зонами Apex/перекупленности-перепроданности, но автор называет индикатор фильтром и пользователь подтвердил дополнительную упрощённую fear/greed формулу.
3. Safe и Risk на одном участке дают сигнал, Standard — нет. Значит прежнее предположение «Risk Mode меняет только менеджмент» нельзя считать доказанным для signal detector.
4. Safe/Risk различаются add/stop; Standard имеет fixed plan и может иметь отдельную eligibility/stat table.
5. Есть partial-only outcomes; outcome нельзя использовать как признак trigger — это будущее и даст look-ahead.

## Разделение модели

```text
Observable inputs at closed bar
→ ReversalSignalDetector(mode)
→ ReversalTradePlan(mode)
→ ReversalPositionManager(mode)
→ Metrics
```

Detector нельзя обучать по full/stop исходу. Trade manager нельзя использовать для объяснения появления сигнала.

## Первая группа проверяемых trigger-гипотез

Все признаки вычисляются каузально на закрытии текущей свечи.

### H0 — текущий baseline

- Apex outer touch arms;
- BUY только bullish, SELL только bearish;
- re-arm на mean.

Нужен как контроль, уже не считается копией.

### H1 — режимный Apex edge

- Safe: arm на outer edge;
- Risk: arm на inner edge или меньшем penetration;
- Standard: более строгий outer penetration/close-reclaim.

Почему проверяем: режимы дают разные signal availability на одном участке.

### H2 — fear/greed oscillator threshold

Кандидаты без подгонки одного числа:

- RSI-like normalized momentum;
- stochastic position within rolling high/low;
- signed volume/momentum blend;
- distance from Apex mean normalized by Apex width.

Проверка идёт семействами порогов и плато. Самый точный single threshold не принимается.

### H3 — exhaustion + directional confirmation

- Apex touch/penetration;
- замедление направленного momentum или уменьшение тела;
- затем первая directional candle обратно.

Это соответствует слову «страх/жадность» и наблюдаемому сигналу не обязательно на первом касании.

### H4 — reclaim edge

- wick проходит edge;
- close возвращается внутрь зоны или выше/ниже edge;
- directional candle подтверждает.

Ранее reclaim-family не дала trading edge, но здесь критерий другой: совпадение vendor events, а не прибыльность. Поэтому можно повторно проверить только как reconstruction hypothesis.

### H5 — multi-bar state machine

- extreme state armed;
- допускается N баров ожидания;
- сигнал возникает при combination fear/greed recovery + directional candle;
- state expires на mean crossing или противоположном extreme.

Нужна из-за примеров, где label появляется после развития движения, а не строго на touch bar.

## Dataset protocol

### Train observations

- переданные screenshots и следующие точные точки пользователя;
- для каждого positive: symbol/feed/TF/mode/timestamp и 20–30 предшествующих баров;
- минимум один matched negative в том же режиме и близком Apex state.

### OOS observations

До подбора откладываются:

- другая дата BTC;
- минимум ETH или SOL;
- минимум два TF;
- Safe/Risk/Standard представлены отдельно.

### Метрики reconstruction

- event precision: доля наших сигналов, совпавших с vendor;
- event recall: доля vendor signals, найденных нами;
- median timing error в барах;
- false positives на matched no-signal;
- разрезы symbol/TF/mode.

Сначала нужен переносимый reconstruction score. PnL запускается только потом.

## Условия перехода к торговому тесту

1. Формула и mode mapping фиксируются до OOS.
2. Положительные и отрицательные случаи различаются не только на BTC/одной дате.
3. Нет look-ahead: только закрытые bars на момент label.
4. После reconstruction — отдельный costs/OOS replay:
   - standalone Reversal;
   - confluence/veto для POI;
   - Safe/Risk dynamic manager;
   - Standard fixed manager.
5. Production defaults не меняются, пока net result не переносится по времени, активам и без лучшего 1% сделок.

## Что требуется следующим

Для кодирования detector всё ещё не хватает точных timestamp для Reversal shots 12–18 и одного-двух matched no-signal на тех же TF/mode. По картинке можно зафиксировать уровни и lifecycle, но нельзя безошибочно привязать OHLC-бар к архиву.
