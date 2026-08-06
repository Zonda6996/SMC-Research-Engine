# GGI / OWN1 next research verdict v1

Дата: 2026-08-05

## Короткий вывод

Главная задача остаётся правильно поставленной: не копировать GGI bar-for-bar, а создать собственный causal reversal signal с положительной и переносимой математикой. SUR1 не закрывает эту задачу: он опроверг только простое правило `Outer stretch + volume`, причём последующая SIG1-анатомия показала, что это была неверная модель места возникновения стрелки.

Сейчас выполнен новый диагностический слой: fixed-horizon path decomposition + одинаковый DM3 V2 replay для GGI arrows, замороженного OWN1 и deterministic random null. Полный независимый ETH/SOL/XRP/AAVE/BNB holdout пока не запущен, потому что десять исходных 1h/2h CSV отсутствуют в рабочем дереве. Результат поэтому честно помечен `PARTIAL_INPUT_COVERAGE`, а не выдан за OOS-доказательство.

## Что подтверждено

1. **Post-signal accounting остаётся воспроизводимым.**
   DM3 V2 использован одинаково для всех семейств: next-open, 25% moving-Mean wick partial, static signal-bar opposite-Inner wick full, static 12×SMA(TR,55) stop, adverse-first, no BE, no add.

2. **OWN1 не является доказанным money-printer.**
   Даже когда Full:Stop выглядит красиво, OWN1 нельзя принимать без expectancy/PF. На доступных данных OWN1 положителен на BTC 2h и ONDO 15m, но отрицателен на BTC 15m, ONDO 2h и XRP 3m; прежний pooled OOS OWN1 = -0.0349R.

3. **GGI path действительно отличается от случайных входов в некоторых доступных режимах, но это не universal proof.**
   В новом audit GGI на BTC 2h full имеет mean R +0.1509 против primary null +0.0540, ΔR +0.0969; на ONDO 2h +0.0228 против -0.1348, ΔR +0.1577. На ONDO 15m разница почти нулевая (+0.0043), а BTC 15m GGI отрицателен (-0.0934) и не показывает положительного edge относительно null. Это согласуется с regime dependence и не доказывает стабильную причинную формулу.

4. **MFE/MAE не дают права объявить OWN1 аналогом GGI.**
   Например, BTC 2h full: GGI MFE на 3-м баре 0.088R, OWN1 0.086R; разница в ранней траектории мала, тогда как GGI mean R намного выше. Следовательно, одной крупной reversal-candle анатомии недостаточно для селективности GGI.

5. **Региональная анатомия всё ещё полезна.**
   Рабочая модель следующего поиска: цена долго находится на одной стороне Mean; продолжение ослабевает; появляется встречная directional candle; затем нужен causal confirmation/failed-continuation gate. Это шире, чем OWN1 и не возвращается к SUR1.

## Что не доказано

- что внутреннее состояние GGI полностью отсутствует в OHLCV;
- что собственный сигнал рядом со стрелкой невозможен;
- что TV alerts — единственный путь;
- что текущий GGI edge универсален или сохранится после costs/funding;
- что OWN1 нужно дальше настраивать.

## Решение по следующему шагу

**OWN1 не ретюнить. SUR1 закрыт только в своей узкой формулировке. Следующий эксперимент — новый preregistered G2, ориентированный на торговую математику, а не exact arrow matching.**

G2 должен включать:

1. causal persistent-episode state относительно Mean;
2. нормированное ослабление continuation (скорость/размер новых экстремумов, contraction/expansion band geometry);
3. directional reversal candle;
4. только после этого — заранее заданный failed-continuation или next-bar confirmation;
5. frozen DM3 accounting и matched-null comparison;
6. promotion только при positive OOS mean R, PF > 1 после cost tier, положительном real-minus-null effect и приемлемой asset/time consistency.

Exact/±1/±3 близость к GGI оставить вторичной диагностикой. Успехом считается самостоятельная положительная математика, даже если сигнал появляется на соседней свече или в том же reversal region.

## Что требуется для полной проверки

Нужны исходные CSV для:

- ETH 1h/2h;
- SOL 1h/2h;
- XRP 1h/2h;
- AAVE 1h/2h;
- BNB 1h/2h.

Старые агрегированные JSON подтверждают размеры и итоговые числа, но не содержат per-trade path series и не могут заменить входы для нового regime-matched null.

Основной артефакт текущего этапа: `ci-results/ggi-own1-path-regime-audit-v1.{json,md}`.
