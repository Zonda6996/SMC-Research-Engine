# Zonda Reversal: актуальный реестр edge-гипотез

## Runtime, к которому относится реестр

Старое описание `Outer touch → next/opposite candle` удалено как устаревшее. Текущий causal trigger — `signal-arrows-1.0-own2-extension`:

```text
relative volume 20 >= 1.4
absolute distance from Apex Mean >= 3%
penetration of Inner >= -0.35 band-half-width
LONG только bullish signal candle; SHORT только bearish
entry = next-bar open
```

Apex: `apex-1.2-cross-oos-sigma-4`. Replay: `signal-arrows-replay-1.2-geo4-moving-close`. Safe/Risk используют moving Mean partial и opposite Inner close full; Standard — static full. Полная frozen спецификация и baseline — `docs/HANDOFF.md`, machine-readable результат — `temp/zonda-profitability-cycle.json`.

## Проверено

### H1 — Apex contraction/regime guard

**Fixed definition:** existing G2 sequence score `>=3/4`:

1. failed continuation за 8 bars;
2. direction-adjusted Mean slope за 8 bars `>-0.25` среднего TR;
3. average range последних 8 bars меньше предыдущих 8;
4. signal candle directional.

Ни один параметр не подбирался grid search. Universe: SOL/BTC/ETH/XRP/BNB, 30m/1h/2h; chronological 65/35 split; BingX 7 bps/side.

| Management | Train net mean | OOS net mean | OOS 95% CI | Status |
|---|---:|---:|---|---|
| Safe | -0.067R | -0.040R | [-0.133,0.056] | CLOSE |
| Risk | -0.129R | +0.076R | [-0.054,0.217] | HOLD only |
| Standard | +0.024R | -0.049R | [-0.212,0.115] | CLOSE |

Risk OOS положителен на пяти assets, но train отрицателен, CI включает ноль и long отрицателен. Это кандидат для нового untouched paper-forward, не улучшение runtime и не GO.

## Заблокировано до сопоставимой реализации

### H2 — свежий sweep нетопового 4h liquidity pool

Механизм и causal data существуют в IMP2/FROZEN, но текущая реализация использует STATIC2/14-day management и несовместима с текущими Safe/Risk/Standard. Нельзя переносить её старые результаты в current runtime. Следующая проверка допустима только после trade-level parity adapter, без смены thresholds: rank `<2/3`, sweep `<=48h`, entry within `±25%` band width.

### H3 — HTF/Fibonacci/POI context

Causal components существуют отдельно, но нет валидированного point-in-time adapter от current OWN2 candidate к контексту и нет доказанной runtime-comparable occupancy/execution. До такого adapter статус `BLOCKED`; post-hoc сборка по открытому OOS запрещена.

## Не допущено

- Absorption/orderflow: локальные OHLCV не содержат достаточного tick/orderflow observable.
- Новые stop/exit variants: IMP1 показал малый leverage management; без нового механизма не переоткрывать.
- Любой free feature/grid search, asset/TF/side selection после OOS, оптимизация по WR.

## Promotion gate

Минимум: aggregate OOS net mean `>=+0.05R`, показанная uncertainty, приемлемая частота, отсутствие зависимости от одного asset/TF/side/cluster и устойчивость после costs. WR — только вспомогательная метрика.
