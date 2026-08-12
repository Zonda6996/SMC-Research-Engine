# Preregistration: GGI-adjacent proprietary G2 state detector v1

Дата фиксации: 2026-08-05. Этот документ создан до первого расчёта G2.

## Цель

Проверить одну структурно новую причинную гипотезу, а не ретюнить OWN1 и не угадывать exact bar GGI. G2 должен находить состояние: длительное движение на одной стороне Mean, затухание adverse continuation, сильная встречная свеча и подтверждённый failed continuation. Главный критерий — торговая математика под frozen DM3 V2; близость к GGI вторична.

## Frozen G2 rule

BUY и SELL зеркальны. BUY episode начинается после последнего Mean touch, когда цена остаётся ниже Mean. Внутри episode причинно отслеживаются новые минимумы и величина каждого нового adverse extension.

Candidate BUY на закрытии бара `i` требует одновременно:

1. не менее 10 полных баров с последнего Mean touch;
2. `close_i < Mean_i`;
3. bullish candle: `close_i > open_i`;
4. `body_i >= 1.5 × SMA20(body)`;
5. накоплено минимум два adverse extension шага нового episode low;
6. последний adverse extension не больше предыдущего — continuation ослабевает;
7. recovery от episode low до close не меньше `0.25 × (Mean - lowerInner)`.

Candidate сам не является сигналом. Сигнал BUY появляется только на закрытии следующего бара `i+1`, если:

1. новый episode low не сформирован;
2. `close_(i+1) > close_i`;
3. весь бар остаётся до Mean (`high_(i+1) < Mean_(i+1)`), то есть target ещё не был достигнут до входа;
4. close остаётся ниже Mean.

Entry — open бара `i+2`. На side действует 40-bar cooldown. Mean touch завершает episode; invalid band и отсутствие next bar не создают сигнал. SELL полностью зеркален.

Параметры заморожены один раз из ранее подтверждённых OWN1/SIG1 ориентиров: drought 10, body 1.5×, cooldown 40. Recovery 0.25 Inner width — минимальное геометрическое подтверждение, а не searched grid. Никаких альтернативных G2-вариантов после результата в этом протоколе нет.

## Frozen execution and costs

- DM3 V2 без изменений: next-open entry; 25% moving Mean wick partial; static signal-bar opposite Inner wick full; static `12 × SMA(TR,55)` stop; adverse-first; no BE; no add.
- Gross R берётся из общего DM3 replay.
- Base net proxy вычитает консервативные 6 bps на вход и 6 bps на совокупный выход, нормированные на planned stop risk. Partial и final exit суммарно закрывают одну позицию, поэтому turnover = 2 notionals.

## Data protocol

Development/reference chronology:

- BTC 2h full20k: первые 70% — descriptive development, последние 30% — chronological test.

Transfer datasets, без настройки:

- ONDO 2h;
- ONDO 15m;
- BTC 15m;
- XRP 3m.

Эти transfer-наборы ранее исследовались другими гипотезами, поэтому они являются research validation, а не sealed OOS. Отсутствующие ETH/SOL/XRP/AAVE/BNB 1h/2h CSV не подменяются агрегированными JSON.

## Benchmarks

На каждой ячейке одинаковым DM3 V2 считаются:

- G2;
- exact GGI arrows;
- frozen OWN1;
- deterministic G2-matched random null: same dataset, side, calendar month и ATR55 quintile с записанными fallback tiers, 100 draws.

GGI proximity: exact, ±1 и ±3 бара той же стороны — только diagnostics.

## Frozen verdict

- **PROMOTE TO FULL HOLDOUT:** BTC 2h chronological test `meanNetR > 0`, `PF_net > 1`, `G2 - matched null meanNetR > 0`; минимум 3 из 4 transfer datasets имеют `meanNetR > 0`; pooled transfer `meanNetR >= +0.03R`; best-1%-removed pooled transfer meanNetR > 0.
- **REGIME-SPECIFIC:** BTC 2h test проходит, но только 1–2 transfer datasets положительны либо pooled transfer ниже +0.03R.
- **REJECT G2:** BTC 2h test meanNetR <= 0, или pooled transfer meanNetR <= 0, или matched null равен/лучше G2 на BTC 2h test.

Full:Stop и win rate не могут повысить verdict при отрицательном net expectancy.

## Запрещено в рамках G2 v1

- менять thresholds после просмотра результата;
- добавлять RSI/Stochastic/volume/HTF filters;
- выбирать лучший timeframe;
- оптимизировать exact совпадение с GGI;
- открывать или называть sealed данные без отдельного frozen протокола;
- менять production Reversal/Apex.
