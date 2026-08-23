# E5 — GGI Buy/Sell + фикс у mean (канонический движок, диагностика)

OWN2-сигнал (relVol 1.4, лонг+шорт), `replayArrowSignals` mode=safe, net 7bps (в движке).
**НЕ** строгий reproduce (у нас 20k свечей; вендор TV мог видеть 20k/40k). БЕЗ плацебо/OOS —
это проверка «похоже ли на цифры автора». Честный слой (OOS+плацебо+«net Result R>0») — отдельно.

**Result R** = Σ netR; **Result %** = Σ (netR · risk%_сделки); WR = vendor-style (take+partial)/(take+partial+stop).

## LDO 5m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 73 | 50 | 13 | 0 | 81.9% | +3.66R | +27.97% | 0.050 | 1.17 | 29/44 | 124 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 124 | 109 | 15 | 0 | 87.9% | +0.08R | +4.25% | 0.001 | 1.00 | 53/71 | 36 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 119 | 101 | 18 | 0 | 84.9% | -0.45R | +3.27% | -0.004 | 0.98 | 48/71 | 36 |
| MEANFIX -add stop1x (короче, НЕ канон) | 142 | 102 | 40 | 0 | 71.8% | +0.01R | +7.27% | 0.000 | 1.00 | 59/83 | 25 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 127 | 104 | 23 | 0 | 81.9% | +1.37R | +11.76% | 0.011 | 1.05 | 54/73 | 34 |

## LDO 15m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 72 | 39 | 13 | 0 | 81.7% | -5.54R | -62.78% | -0.077 | 0.81 | 35/37 | 144 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 120 | 97 | 23 | 0 | 80.8% | -6.44R | -58.99% | -0.054 | 0.73 | 56/64 | 36 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 112 | 87 | 25 | 0 | 77.7% | -6.16R | -37.02% | -0.055 | 0.76 | 52/60 | 36 |
| MEANFIX -add stop1x (короче, НЕ канон) | 145 | 90 | 55 | 0 | 62.1% | -11.89R | -42.86% | -0.082 | 0.79 | 70/75 | 22 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 127 | 91 | 36 | 0 | 71.7% | -8.04R | -35.07% | -0.063 | 0.78 | 60/67 | 30 |

## AVAX 5m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 85 | 59 | 12 | 0 | 85.7% | +1.51R | +17.81% | 0.018 | 1.06 | 46/39 | 139 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 134 | 116 | 18 | 0 | 86.6% | -1.32R | +4.63% | -0.010 | 0.93 | 69/65 | 34.5 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 129 | 108 | 21 | 0 | 83.7% | -2.18R | -1.00% | -0.017 | 0.90 | 67/62 | 34 |
| MEANFIX -add stop1x (короче, НЕ канон) | 155 | 109 | 46 | 0 | 70.3% | -4.68R | -1.79% | -0.030 | 0.91 | 78/77 | 27 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 141 | 107 | 34 | 0 | 75.9% | -7.03R | -6.57% | -0.050 | 0.81 | 73/68 | 30 |

## AVAX 15m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 74 | 50 | 7 | 0 | 90.4% | +5.40R | +49.61% | 0.073 | 1.27 | 36/38 | 142 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 126 | 111 | 15 | 0 | 88.1% | +5.25R | +29.86% | 0.042 | 1.34 | 64/62 | 39.5 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 119 | 102 | 17 | 0 | 85.7% | +3.37R | +6.04% | 0.028 | 1.19 | 60/59 | 39 |
| MEANFIX -add stop1x (короче, НЕ канон) | 148 | 100 | 48 | 0 | 67.6% | -0.76R | -1.45% | -0.005 | 0.99 | 78/70 | 28 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 133 | 102 | 31 | 0 | 76.7% | -2.37R | -17.15% | -0.018 | 0.93 | 69/64 | 36 |

## ONDO 5m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 63 | 37 | 7 | 0 | 88.7% | -4.73R | -13.82% | -0.075 | 0.79 | 37/26 | 177 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 119 | 106 | 13 | 0 | 89.1% | -1.77R | +1.03% | -0.015 | 0.87 | 65/54 | 36 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 119 | 104 | 15 | 0 | 87.4% | +0.27R | +11.28% | 0.002 | 1.02 | 65/54 | 35 |
| MEANFIX -add stop1x (короче, НЕ канон) | 132 | 102 | 29 | 0 | 77.9% | +2.71R | +12.28% | 0.021 | 1.08 | 73/59 | 30 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 121 | 102 | 18 | 0 | 85.0% | +2.09R | +16.28% | 0.017 | 1.11 | 66/55 | 34 |

## ONDO 15m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 68 | 41 | 10 | 0 | 85.1% | -2.49R | -16.22% | -0.037 | 0.89 | 27/41 | 132 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 111 | 94 | 16 | 0 | 85.5% | -0.87R | -2.75% | -0.008 | 0.95 | 46/65 | 36 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 106 | 84 | 21 | 0 | 80.0% | -3.73R | -26.28% | -0.035 | 0.83 | 43/63 | 37 |
| MEANFIX -add stop1x (короче, НЕ канон) | 135 | 83 | 51 | 0 | 61.9% | -12.27R | -30.97% | -0.091 | 0.77 | 58/77 | 30 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 117 | 83 | 33 | 0 | 71.6% | -8.79R | -40.31% | -0.075 | 0.75 | 49/68 | 32 |

## VIRTUAL 5m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 79 | 53 | 11 | 0 | 85.9% | +2.33R | +6.17% | 0.030 | 1.10 | 37/42 | 157 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 136 | 117 | 19 | 0 | 86.0% | -2.51R | -15.25% | -0.018 | 0.88 | 64/72 | 31 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 126 | 107 | 19 | 0 | 84.9% | +2.81R | +8.05% | 0.022 | 1.14 | 59/67 | 31 |
| MEANFIX -add stop1x (короче, НЕ канон) | 161 | 114 | 47 | 0 | 70.8% | -0.44R | -3.51% | -0.003 | 0.99 | 73/88 | 28 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 143 | 111 | 32 | 0 | 77.6% | -3.01R | -8.09% | -0.021 | 0.91 | 65/78 | 31 |

## VIRTUAL 15m

| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE (Safe: partial25%+moving, add, stop2x) | 76 | 48 | 11 | 0 | 85.5% | +0.14R | -17.34% | 0.002 | 1.01 | 34/42 | 154 |
| MEANFIX +add (fix100%@mean, add on, stop2x) | 126 | 107 | 19 | 0 | 84.9% | -2.39R | -28.85% | -0.019 | 0.88 | 55/71 | 39.5 |
| MEANFIX -add (fix100%@mean, no add, stop2x) | 121 | 97 | 24 | 0 | 80.2% | -7.04R | -56.16% | -0.058 | 0.71 | 54/67 | 38 |
| MEANFIX -add stop1x (короче, НЕ канон) | 152 | 98 | 54 | 0 | 64.5% | -14.07R | -48.03% | -0.093 | 0.75 | 69/83 | 30 |
| MEANFIX -add stop1.5x (короче, НЕ канон) | 127 | 98 | 29 | 0 | 77.2% | -4.65R | -30.23% | -0.037 | 0.85 | 57/70 | 37 |
