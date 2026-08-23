# E5 reproduce — LDO 15m GGI Buy/Sell на Binance SPOT (канонический движок)

OWN2 (relVol 1.4, лонг+шорт), `replayArrowSignals` mode=safe, net 7bps. Фид — **Binance spot**
(архивы data.binance.vision, без лимита 20k), как у вендора. Движок/детектор не тронуты (§2.1).
ДИАГНОСТИКА: сверяем «сошлось/нет» с эталонной таблицей вендора. БЕЗ плацебо/OOS.

**Result R** = Σ netR; **Result %** = Σ(netR·risk%); **Avg stop %** = средний netR·risk% по стоп-сделкам; WR = (take+partial)/(take+partial+stop). Trades = финализированные (как у вендора).

### Таблица вендора (Binance spot, эталон)

| GGI | Trades | WR | Take | Stop | Result % | Avg stop % | Result R |
|---|---|---|---|---|---|---|---|
| LONG | 41 | 58.5% | 24 | 17 | +7.96% | -1.9% | +4.20R |
| SHORT | 48 | 66.7% | 32 | 16 | +20.37% | -1.82% | +11.17R |
| TOTAL | 89 | 62.9% | 56 | 33 | +28.32% | -1.86% | +15.25R |

## SPOT last-40000 (~40k гипотеза)

свечей=40000 · 2025-06-26 → 2026-08-16 (~417д) · OWN2-кандидатов=717

### BASE (канон Safe: partial25%+moving, add, stop2x)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 75 | 84.0% | 43 | 12 | -79.62% | -12.38% | -10.50R | 0/0 |
| SHORT | 93 | 79.6% | 52 | 19 | -113.77% | -11.10% | -10.85R | 0/1 |
| TOTAL | 168 | 81.5% | 95 | 31 | -193.40% | -11.59% | -21.35R | 0/1 |

### MEANFIX -add (fix100%@mean, no add, stop2x)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 124 | 76.6% | 95 | 29 | -69.98% | -7.76% | -11.61R | 0/0 |
| SHORT | 144 | 81.9% | 118 | 26 | -8.05% | -7.46% | -0.40R | 0/0 |
| TOTAL | 268 | 79.5% | 213 | 55 | -78.03% | -7.62% | -12.01R | 0/0 |

### MEANFIX -add stop1x (короче, НЕ канон — арм с WR≈62%)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 156 | 63.5% | 99 | 57 | -53.04% | -3.97% | -18.43R | 0/0 |
| SHORT | 176 | 67.0% | 118 | 58 | -11.08% | -3.78% | -4.18R | 0/0 |
| TOTAL | 332 | 65.4% | 217 | 115 | -64.12% | -3.88% | -22.61R | 0/0 |

## SPOT last-20000 (~20k, окно как у baseline)

свечей=20000 · 2026-01-20 → 2026-08-16 (~208д) · OWN2-кандидатов=369

### BASE (канон Safe: partial25%+moving, add, stop2x)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 42 | 81.0% | 23 | 8 | -86.92% | -12.19% | -8.27R | 0/0 |
| SHORT | 43 | 79.1% | 23 | 9 | -55.01% | -10.31% | -5.33R | 0/1 |
| TOTAL | 85 | 80.0% | 46 | 17 | -141.93% | -11.19% | -13.61R | 0/1 |

### MEANFIX -add (fix100%@mean, no add, stop2x)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 64 | 71.9% | 46 | 18 | -67.08% | -7.46% | -9.55R | 0/0 |
| SHORT | 72 | 81.9% | 59 | 13 | +6.95% | -6.79% | +0.44R | 0/0 |
| TOTAL | 136 | 77.2% | 105 | 31 | -60.13% | -7.18% | -9.11R | 0/0 |

### MEANFIX -add stop1x (короче, НЕ канон — арм с WR≈62%)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 81 | 60.5% | 49 | 32 | -36.15% | -3.65% | -12.48R | 0/0 |
| SHORT | 87 | 64.4% | 56 | 31 | -12.27% | -3.51% | -4.45R | 0/0 |
| TOTAL | 168 | 62.5% | 105 | 63 | -48.41% | -3.58% | -16.94R | 0/0 |

## FUTURES 20000 (perp, референс baseline)

свечей=20000 · 2026-01-21 → 2026-08-17 (~208д) · OWN2-кандидатов=285

### BASE (канон Safe: partial25%+moving, add, stop2x)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 35 | 82.9% | 19 | 6 | -61.63% | -11.98% | -4.66R | 0/0 |
| SHORT | 36 | 80.6% | 20 | 7 | -1.15% | -10.69% | -0.88R | 0/1 |
| TOTAL | 71 | 81.7% | 39 | 13 | -62.78% | -11.29% | -5.54R | 0/1 |

### MEANFIX -add (fix100%@mean, no add, stop2x)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 52 | 75.0% | 39 | 13 | -37.87% | -7.40% | -6.02R | 0/0 |
| SHORT | 60 | 80.0% | 48 | 12 | +0.84% | -7.32% | -0.14R | 0/0 |
| TOTAL | 112 | 77.7% | 87 | 25 | -37.02% | -7.36% | -6.16R | 0/0 |

### MEANFIX -add stop1x (короче, НЕ канон — арм с WR≈62%)

| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |
|---|---|---|---|---|---|---|---|---|
| LONG | 70 | 60.0% | 42 | 28 | -33.57% | -3.93% | -10.08R | 0/0 |
| SHORT | 75 | 64.0% | 48 | 27 | -9.29% | -3.79% | -1.81R | 0/0 |
| TOTAL | 145 | 62.1% | 90 | 55 | -42.86% | -3.86% | -11.89R | 0/0 |
