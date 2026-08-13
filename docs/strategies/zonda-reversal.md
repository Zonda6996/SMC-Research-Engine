# Стратегия: Zonda Reversal + Apex (АКТИВНАЯ ЛИНИЯ)

> **Что это:** нормативная спека активной research-стратегии — разворотные стрелки на
> конверте Apex. Механика движка/тейков — в `docs/INDICATOR.md`; отвергнутое — в
> `docs/NEGATIVE-KNOWLEDGE.md`; текущий фокус/следующий шаг — в `docs/HANDOFF.md`.
> **Как часто меняется:** по ходу активного research. **Baseline-таблицы живут здесь**,
> не в HANDOFF.

---

## 1. Runtime (заморожен для измерения)
- Триггер сигнала: `signal-arrows-1.0-own2-extension` (OWN2), порог `relVol ≥ 1.4`.
- Полосы: `apex-1.2-cross-oos-sigma-4`. Реплей: `signal-arrows-replay-1.2-geo4-moving-close`.
- Режимы Safe/Risk/Standard — неизменны (см. INDICATOR §4). Вход = open следующего бара.
- Frozen HEAD профиля baseline: `609ecfee2496f7b5083be7578857ac959943d63d`.

## 2. Universe / costs / split (для baseline)
- Binance USDT-M futures cache: SOL/BTC/ETH/XRP/BNB × 30m/1h/2h, 20k баров на серию.
- Cost canon: BingX VIP0 taker 5 bps + slippage 2 bps = **7 bps на исполненную сторону**;
  `costR = turnoverNotional × 0.0007 / oneR`. Funding в OHLCV отсутствует, не выдумывается.
- Split: первые 65% календарного span каждой серии — train, последние 35% — OOS.
- CI: trade-level bootstrap, 2000 resamples, seed `20260807`; кластеры (same-side 4h) — отдельно.

## 3. Frozen baseline (после costs, OOS)

| Mode | OOS N | Net mean | 95% CI | PF | Net total | vendor WR |
|---|---:|---:|---|---:|---:|---:|
| Safe | 398 | -0.063R | [-0.130, 0.003] | 0.779 | -25.49R | 83.7% |
| Risk | 422 | -0.016R | [-0.100, 0.072] | 0.961 | -6.97R | 73.0% |
| Standard | 322 | +0.017R | [-0.105, 0.133] | 1.032 | +5.64R | 47.5% |

Costs переводят Risk из gross `+0.006R` в net `-0.016R`. Высокий vendor-style WR
(Partial+Full)/(Partial+Stop+Full) **не** компенсирует слабый expectancy.

**Breadth:** результат не держится на SOL (Safe SOL OOS -0.034R, Risk -0.064R); плюс
концентрируется в XRP/short (Risk XRP +0.207R, но ETH -0.166R; long -0.147R, short +0.159R).

## 4. Активный кандидат — H1 (Apex contraction/regime guard)
Единственная предзарегистрированная гипотеза (без grid search). G2-score `>=3/4`:
failed continuation 8 bars; direction-adjusted Mean slope 8 bars `> -0.25` среднего TR;
range последних 8 bars < предыдущих 8; направленная signal candle.

| H1 mode | Train mean | OOS mean | OOS 95% CI | PF | Decision |
|---|---:|---:|---|---:|---|
| Safe | -0.067R | -0.040R | [-0.133, 0.056] | 0.858 | CLOSE |
| Risk | -0.129R | +0.076R | [-0.054, 0.217] | 1.209 | **HOLD** |
| Standard | +0.024R | -0.049R | [-0.212, 0.115] | 0.909 | CLOSE |

H1 Risk: OOS point estimate > +0.05R, все 5 asset means положительны, НО train
отрицателен, CI включает ноль, long остаётся отрицательным → это sign flip, **не**
доказанное улучшение.

## 5. Вердикт
**HOLD research / NO-GO production.** Baseline закрыт как trading edge (runtime оставить
frozen). H1 Risk — research-only кандидат для нового untouched paper-forward.
H2 (свежий sweep нетопового 4h пула) и H3 (HTF/Fib/POI) — **BLOCKED**: нет causal-adapter,
несовместимы с текущим management; старые результаты переносить нельзя.

## 6. Следующий шаг
Заморозить ровно **H1 Risk** как research-only candidate; собрать новый untouched
paper-forward до **200 finalized trades** с funding, cluster-equal метрикой и отдельным
long/short gate. Score/параметры не менять до checkpoint. Дорожная карта фаз 0–5 —
в HANDOFF (архивная детализация).

## 7. Ограничения измерения (не забывать)
- Нельзя выбирать asset/TF/сторону после просмотра результата.
- Vendor parity ≠ profitability — это две разные ветки с раздельными метриками.
- Один рыночный импульс на N алертов ≈ одно наблюдение, не N независимых.
- Exact-bar vendor parity ограничена (нет golden CSV/timestamps по SOL 30m/1h).
