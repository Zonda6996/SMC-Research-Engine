# Funding-only research — preregistration (FROZEN)

Заморожено до просмотра результатов прогона. Линия независима от Apex/Zonda/Reversal и не использует OHLCV, CVD, VWAP, OI, ATR или volatility как признаки сигнала. Price/mark используется только для исполнения и PnL.

## Протокол

- Universe: `BTCUSDT`, `ETHUSDT`, `SOLUSDT` (Binance USD-M perpetual).
- Источник: официальные Binance USD-M settlement funding rates и mark-price execution data.
- Общая история: максимально длинный общий качественный календарный интервал, одинаково доступный всем трём символам; фактические границы фиксируются manifest после QA, без выбора по PnL.
- Event clock: каждый уникальный фактический settlement. Решение сразу после settlement `s`; вход по первому доступному mark-price observation строго после `s`; удержание до следующего фактического settlement, включение funding cashflow этого следующего settlement, выход по первому mark-price observation строго после него.
- Никакого forward-fill, синтетических settlements, assumed 8h cadence, threshold/z-score, SL/TP, magnitude/side/symbol filters.
- Arms: primary `CONTRARIAN` (`rate(s)>0` → short, `<0` → long, `0` → no trade); paired control `CONTINUATION` — противоположное направление на тех же non-zero событиях.
- Funding cashflow для позиции direction `d∈{-1,+1}` на settlement rate `r`: `-d*r` от fixed notional.
- Price return: `d*(exitMark/entryMark-1)`; fee drag: `2*oneWayCostBps/10000`; net = price + funding − fees.
- Costs: 0 bps/side (диагностический gross ceiling) и 5 bps/side (primary target); costs не оптимизируются.
- Split: единый календарный cutoff для всех symbols, определённый как первый общий settlement timestamp, на котором достигнуто не менее 65% pooled eligible event-times; все trades с decision settlement до cutoff — development, остальные — sealed OOS. Cutoff фиксируется до расчёта arm PnL. Development только для QA/описания, без выбора arm/параметров. OOS раскрывается один раз.
- Primary metric: equal-symbol pooled mean net return на fixed notional: среднее трёх per-symbol mean returns (каждый symbol имеет равный вес). Дополнительно: bps/trade, арифметическая fixed-notional equity, осторожная compounded/continuous equity, PF, win rate, max drawdown, holding duration, price-only/funding/fees decomposition. Sharpe не заявляется.
- Dependence-aware inference: paired cluster bootstrap с UTC settlement day как блоком, совместно по всем symbols/arms, fixed seed `24082026`, `10000` resamples. Общие settlement shocks сохраняются. CI percentile 95%.

## Frozen evidence gates

- Event gate: минимум 250 OOS trades на каждый symbol и 750 pooled.
- Breadth: минимум 2/3 symbols с положительным OOS mean net return primary arm при 5 bps/side.
- `GO` только если одновременно: event gate; breadth; lower 95% cluster-bootstrap CI для equal-symbol pooled CONTRARIAN mean net return > 0; lower 95% paired CI для CONTRARIAN minus CONTINUATION > 0.
- Если event gate не выполнен: `INCONCLUSIVE DATA`.
- Иначе любое нарушение GO-gates: `KILL`.
- После OOS reveal запрещены retune, exclusions, subgroup rescue и изменение метода.

## QA / provenance

Manifest должен содержать source URLs/type, hashes, row counts, actual UTC bounds, duplicate/conflict audit, monotonicity, missing execution joins, interval/cadence histogram и общий cutoff. Любой conflicting duplicate, non-monotonic output либо подмена недоступного официального источника блокирует reveal и даёт `BLOCKED DATA` с точной причиной.
