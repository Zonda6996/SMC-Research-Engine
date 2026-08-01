# Строгий критик — Reversal cycle v4

Дата: 2026-08-01

## Вердикт

**REJECT production. CONTINUE reconstruction.**

V4 лучше предыдущих каузальных семейств, но не близок к vendor fidelity.

## Почему отклонено

1. **Validation optimism:** fit 14.77/23.64%, validation 17.02/30.77%, sealed 6.52/9.38% precision/recall. Family/parameter selection нестабильны во времени.
2. **Cross-TF failure:** BTC 4h 5.66% precision / 7.89% recall. Общая баровая формула должна переноситься значительно лучше.
3. **Market-kind failure:** SOL Spot pred/original ratio 2.21 и precision 5.04%.
4. **Cooldown is necessary, not sufficient:** общий минимум между labels 52–60 баров воспроизводится, best grid выбирает 72, но first-eligible recovery всё ещё ставит много неправильных сигналов.
5. **Outer is not trigger:** среди 370 labels current/previous exact Outer touch = 0. На сигнальном баре median distance от mean ≈0.66–0.74 Inner half-width. Следовательно, сигнал рисуется после возврата внутрь, а Outer может лишь формировать предшествующее состояние.
6. **No hidden score exported:** новые CSV добавили exact Outer, но не fear/greed/internal state series. Нельзя утверждать, что closed vendor score восстановлен.

## Методологическая критика прошлых циклов

- V1/V2 переоценивали роль короткого pending: label offset от первого Inner median 14–29 и p90 55–91.
- Полные grids содержали много коррелирующих вариантов и создавали multiple-testing pressure; sealed collapse это проявил.
- Gate 15% precision / 40% recall — минимальный инженерный порог, а не доказательство точной копии. Даже PASS потребовал бы дополнительного untouched export.
- Event precision важнее bar accuracy, но exact-bar matching может несправедливо отвергать backplotted Pine pivot. Нужно отдельно проверить centered pivot + negative offset.

## Единственная следующая приоритетная гипотеза

**Backplotted confirmed pivot:**

```text
extreme/score pivot на баре t
→ подтверждается правыми N барами
→ Pine рисует shape на t через offset=-N
→ causal alert возможен только на t+N
```

Она объясняет одновременно:

- невозможность causal same-bar reconstruction;
- стабильность исторических labels при повторном export;
- minimum inter-signal gap около 2N;
- сигнал после длительного episode;
- отсутствие Outer touch на shape-баре.

Следующий цикл обязан сравнить labels с centered pivots price/Apex-distance/RSI/Stoch/composite для left/right 2–50 и отдельно отчитать:

- visual label fidelity на backplotted bar;
- causal availability delay `rightBars`;
- exact/±1 timing;
- OOS по ETH/SOL/BTC5/BTC4;
- число лишних pivot labels.

До результата этой проверки расширять causal RSI/cooldown grids запрещено.