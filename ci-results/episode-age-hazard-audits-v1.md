# Episode-age hazard pre-detector audits (H1/H2/H3)

Branch: research/episode-age-hazard. Descriptive only: no detector, no parameter search, hazard uses development FIT slices only.

## (a) Per-age-bin first-label hazard - dev fit slices

Episode grammar identical to chronology v2 (first inner breach -> close through mean, 256-bar cap). Episodes censored after first label. Pre-registered kill criterion for H1: no bin (with >=50 bars exposure) reaching >=2x the overall hazard means the age variable alone cannot separate labeled from unlabeled episode-bars.

### btc-perp-15m (both)

- Episodes 53, labeled 25, overall hazard 11.489 per 1000 at-risk bars.
- Max bin ratio 2.51x at age 24-31.

| age bin | events | exposure | hazard/1000 | ratio |
|---|---|---|---|---|
| 0-7 | 4 | 408 | 9.804 | 0.85 |
| 8-15 | 4 | 355 | 11.268 | 0.98 |
| 16-23 | 5 | 277 | 18.051 | 1.57 |
| 24-31 | 6 | 208 | 28.846 | 2.51 |
| 32-47 | 1 | 304 | 3.289 | 0.29 |
| 48-63 | 2 | 231 | 8.658 | 0.75 |
| 64-95 | 2 | 227 | 8.811 | 0.77 |
| 96-127 | 1 | 103 | 9.709 | 0.85 |
| 128-191 | 0 | 63 | 0.000 | 0.00 |
| 192-256 | 0 | 0 | 0.000 | 0.00 |

### btc-perp-15m (long)

- Episodes 22, labeled 11, overall hazard 11.247 per 1000 at-risk bars.
- Max bin ratio 2.14x at age 24-31.

| age bin | events | exposure | hazard/1000 | ratio |
|---|---|---|---|---|
| 0-7 | 1 | 172 | 5.814 | 0.52 |
| 8-15 | 3 | 137 | 21.898 | 1.95 |
| 16-23 | 2 | 109 | 18.349 | 1.63 |
| 24-31 | 2 | 83 | 24.096 | 2.14 |
| 32-47 | 1 | 123 | 8.130 | 0.72 |
| 48-63 | 2 | 93 | 21.505 | 1.91 |
| 64-95 | 0 | 103 | 0.000 | 0.00 |
| 96-127 | 0 | 95 | 0.000 | 0.00 |
| 128-191 | 0 | 63 | 0.000 | 0.00 |
| 192-256 | 0 | 0 | 0.000 | 0.00 |

### btc-perp-15m (short)

- Episodes 31, labeled 14, overall hazard 11.686 per 1000 at-risk bars.
- Max bin ratio 2.74x at age 24-31.

| age bin | events | exposure | hazard/1000 | ratio |
|---|---|---|---|---|
| 0-7 | 3 | 236 | 12.712 | 1.09 |
| 8-15 | 1 | 218 | 4.587 | 0.39 |
| 16-23 | 3 | 168 | 17.857 | 1.53 |
| 24-31 | 4 | 125 | 32.000 | 2.74 |
| 32-47 | 0 | 181 | 0.000 | 0.00 |
| 48-63 | 0 | 138 | 0.000 | 0.00 |
| 64-95 | 2 | 124 | 16.129 | 1.38 |
| 96-127 | 1 | 8 | 125.000 | 10.70 |
| 128-191 | 0 | 0 | 0.000 | 0.00 |
| 192-256 | 0 | 0 | 0.000 | 0.00 |

### btc-perp-1h (both)

- Episodes 35, labeled 18, overall hazard 13.062 per 1000 at-risk bars.
- Max bin ratio 1.80x at age 8-15.

| age bin | events | exposure | hazard/1000 | ratio |
|---|---|---|---|---|
| 0-7 | 5 | 265 | 18.868 | 1.44 |
| 8-15 | 5 | 213 | 23.474 | 1.80 |
| 16-23 | 1 | 174 | 5.747 | 0.44 |
| 24-31 | 1 | 159 | 6.289 | 0.48 |
| 32-47 | 2 | 260 | 7.692 | 0.59 |
| 48-63 | 2 | 158 | 12.658 | 0.97 |
| 64-95 | 1 | 141 | 7.092 | 0.54 |
| 96-127 | 1 | 8 | 125.000 | 9.57 |
| 128-191 | 0 | 0 | 0.000 | 0.00 |
| 192-256 | 0 | 0 | 0.000 | 0.00 |

### btc-perp-1h (long)

- Episodes 17, labeled 10, overall hazard 14.265 per 1000 at-risk bars.
- Max bin ratio 2.23x at age 0-7.

| age bin | events | exposure | hazard/1000 | ratio |
|---|---|---|---|---|
| 0-7 | 4 | 126 | 31.746 | 2.23 |
| 8-15 | 2 | 98 | 20.408 | 1.43 |
| 16-23 | 0 | 88 | 0.000 | 0.00 |
| 24-31 | 1 | 87 | 11.494 | 0.81 |
| 32-47 | 1 | 145 | 6.897 | 0.48 |
| 48-63 | 1 | 98 | 10.204 | 0.72 |
| 64-95 | 1 | 54 | 18.519 | 1.30 |
| 96-127 | 0 | 5 | 0.000 | 0.00 |
| 128-191 | 0 | 0 | 0.000 | 0.00 |
| 192-256 | 0 | 0 | 0.000 | 0.00 |

### btc-perp-1h (short)

- Episodes 18, labeled 8, overall hazard 11.817 per 1000 at-risk bars.
- Max bin ratio 2.21x at age 8-15.

| age bin | events | exposure | hazard/1000 | ratio |
|---|---|---|---|---|
| 0-7 | 1 | 139 | 7.194 | 0.61 |
| 8-15 | 3 | 115 | 26.087 | 2.21 |
| 16-23 | 1 | 86 | 11.628 | 0.98 |
| 24-31 | 0 | 72 | 0.000 | 0.00 |
| 32-47 | 1 | 115 | 8.696 | 0.74 |
| 48-63 | 1 | 60 | 16.667 | 1.41 |
| 64-95 | 0 | 87 | 0.000 | 0.00 |
| 96-127 | 1 | 3 | 333.333 | 28.21 |
| 128-191 | 0 | 0 | 0.000 | 0.00 |
| 192-256 | 0 | 0 | 0.000 | 0.00 |

## (b) Global inter-label gap shape near the minimum - all datasets

H2 (rolling-window extremum) predicts a soft floor: few gaps piled at 53-56 and a deficit through ~70. An explicit cooldown predicts a hard floor with visible mass directly at 53-56.

### btc-perp-15m

- 68 global gaps, min 57; mass at 53-56: 0; mass at 57-70: 4; gaps < 80: 7.
- Histogram 50-100: 57:1, 61:1, 62:1, 69:1, 75:1, 76:1, 77:1, 82:2, 88:1, 89:2, 90:1, 94:1, 98:1

### btc-perp-1h

- 43 global gaps, min 58; mass at 53-56: 0; mass at 57-70: 4; gaps < 80: 6.
- Histogram 50-100: 58:1, 60:1, 67:1, 69:1, 71:1, 74:1, 83:2, 87:1, 96:1

### eth-perp-15m

- 74 global gaps, min 57; mass at 53-56: 0; mass at 57-70: 4; gaps < 80: 9.
- Histogram 50-100: 57:1, 63:1, 64:1, 67:1, 73:1, 74:1, 76:1, 77:1, 79:1, 80:1, 83:1, 85:1, 87:1, 89:1, 90:2, 100:1

### sol-spot-15m

- 62 global gaps, min 60; mass at 53-56: 0; mass at 57-70: 5; gaps < 80: 5.
- Histogram 50-100: 60:1, 65:1, 66:1, 69:1, 70:1, 80:1, 81:1, 83:1, 85:1, 98:1

### btc-perp-5m

- 80 global gaps, min 52; mass at 53-56: 1; mass at 57-70: 2; gaps < 80: 4.
- Histogram 50-100: 52:1, 53:1, 64:1, 65:1, 86:1, 91:1, 93:1, 94:1, 96:1

### btc-perp-4h

- 37 global gaps, min 56; mass at 53-56: 1; mass at 57-70: 4; gaps < 80: 6.
- Histogram 50-100: 56:1, 57:2, 64:1, 66:1, 76:1, 81:1, 96:1

## (c) Cross-TF coincidence of BTC.P labels - overlapping UTC ranges

Window fixed a priori at +/-2 HTF bars. Pre-registered kill criterion for H3: clustering coefficient <= 1.5x on every pair.

### btc-perp-15m vs btc-perp-5m

- Overlap 2026-05-25T08:50:00.000Z .. 2026-07-31T19:45:00.000Z; HTF labels 34, LTF labels 81.
- Observed same-direction hit rate within +/-2 HTF bars: 14.7% (5/34); expected under independence 2.5%.
- Clustering coefficient: 5.84x.

### btc-perp-1h vs btc-perp-15m

- Overlap 2026-02-28T23:15:00.000Z .. 2026-07-31T21:00:00.000Z; HTF labels 16, LTF labels 69.
- Observed same-direction hit rate within +/-2 HTF bars: 0.0% (0/16); expected under independence 3.8%.
- Clustering coefficient: 0.00x.

### btc-perp-4h vs btc-perp-1h

- Overlap 2025-06-20T02:00:00.000Z .. 2026-07-31T16:00:00.000Z; HTF labels 12, LTF labels 44.
- Observed same-direction hit rate within +/-2 HTF bars: 25.0% (3/12); expected under independence 3.9%.
- Clustering coefficient: 6.35x.

## Notes

- (a) consumes only fit slices of the two development datasets; sealed and holdout data untouched.
- (b) and (c) are descriptive statistics of the existing 370 vendor labels; they fit no thresholds and are excluded from the detector multiple-testing budget.
