# OWN2-thinned big-corpus — FROZEN REVEAL (терминальный)

# Вердикт: `KILL`

## Замороженная рука
- Канонический OWN2 (relVol 1.4) → spacing **180 баров** → каждая стрелка = своя сделка.
- Стоп: **2×step**, step = 5.5·atr200 — ширина определяется ТФ и волатильностью (Amendment №3).
- Добор: **entry ∓ step** — ровно середина между entry и стопом.
- Менеджмент safe/dynamic-partial: частичка 25% у mean, полный тейк у противоположной внутренней полосы, fullFixAtMean=false.
- Primary: pooled mean (netR@5bps/side + фактический funding). Reference без прореживания — дескриптивно.

## Поток наблюдений
- Символов: 25; допущенных возможностей: 3619; resolved: 3615.
- Funding decisions: {"retain":2078,"veto-zero":10,"veto-missing":0,"veto-sign":1527}; retained 2078.

## Агрегат (primary, net@5bps + funding)
- N=3615, total -230.177R, mean -0.06367R/trade, PF 0.8153, WR 59.14%, maxDD 245.00R.
- Long/short: 1820/1795; исходы: {"full-tp":2195,"partial-stop":812,"stop":608}.
- **UTC-day cluster bootstrap CI95: [-0.09769, -0.02937]**, median -0.06377 (10000, seed 22082026).
- Дескриптивно: price-only net@5 mean -0.06908, gross@0 mean -0.06145.

## Secondary: funding-sign paired delta (диагностика)
- Paired delta 0.03851R/opportunity; paired UTC-day bootstrap CI95 [0.01960, 0.05778].
- Retained-executed: N=2078, mean -0.04378.

## Reference: без прореживания (spacing=0, net@5, дескриптив)
- N=16500, total -1197.62R, mean -0.07258, PF 0.8022, maxDD 1222.25R.

## Per symbol (primary netF5)
| symbol | resolved | totalR | meanR | PF | WR |
|---|---:|---:|---:|---:|---:|
| ACEUSDT | 80 | -5.02 | -0.0627 | 0.808 | 62.5% |
| COTIUSDT | 169 | 6.84 | 0.0405 | 1.147 | 66.3% |
| WLDUSDT | 93 | -14.05 | -0.1511 | 0.627 | 53.8% |
| BICOUSDT | 94 | -7.65 | -0.0814 | 0.755 | 57.4% |
| NEARUSDT | 184 | -12.41 | -0.0675 | 0.813 | 57.1% |
| UNIUSDT | 191 | -18.81 | -0.0985 | 0.734 | 57.6% |
| 1000SHIBUSDT | 166 | -16.55 | -0.0997 | 0.718 | 57.8% |
| 1000RATSUSDT | 84 | 0.08 | 0.0009 | 1.003 | 61.9% |
| TAOUSDT | 76 | -1.72 | -0.0227 | 0.934 | 59.2% |
| RIFUSDT | 87 | -9.26 | -0.1064 | 0.707 | 57.5% |
| BCHUSDT | 205 | -13.73 | -0.0670 | 0.806 | 59.0% |
| ONGUSDT | 81 | -7.94 | -0.0980 | 0.720 | 58.0% |
| FILUSDT | 186 | -8.90 | -0.0478 | 0.860 | 59.1% |
| LTCUSDT | 207 | 6.82 | 0.0330 | 1.109 | 65.2% |
| XLMUSDT | 201 | -7.81 | -0.0389 | 0.881 | 60.2% |
| XMRUSDT | 171 | -10.80 | -0.0632 | 0.828 | 57.9% |
| TRXUSDT | 220 | -22.10 | -0.1005 | 0.721 | 57.7% |
| DOTUSDT | 181 | -13.29 | -0.0734 | 0.781 | 60.2% |
| INJUSDT | 128 | -24.79 | -0.1936 | 0.536 | 51.6% |
| FETUSDT | 110 | -9.71 | -0.0883 | 0.741 | 57.3% |
| 1000BONKUSDT | 88 | -10.38 | -0.1180 | 0.662 | 58.0% |
| CRVUSDT | 173 | -17.05 | -0.0986 | 0.719 | 57.8% |
| PORTALUSDT | 75 | -6.10 | -0.0813 | 0.771 | 56.0% |
| HBARUSDT | 169 | -1.46 | -0.0086 | 0.973 | 63.3% |
| ETCUSDT | 196 | -4.39 | -0.0224 | 0.936 | 59.2% |

## Гейты и терминальность
- Gates: {"opportunitiesAtLeast250":true,"resolvedAtLeast100":true,"ciLowerPositive":false}.
- Классификация по prereg §5: event-gate fail → INCONCLUSIVE DATA; иначе GO ⇔ lower95>0, иначе KILL.
- Корпус сожжён для этой гипотезы: retune/spacing/стопа/подвыборок/исключений — запрещено (§6).

## Provenance
- prereg `fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886`; amendment1 `6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40`; amendment2 `1be3164acf82854e61fadc25cb4375d43a02628334d9822abde9e6da894dd17e`;
- amendment3 `3f958552f29550ed70087d15167e812a5e690a584151d29ed0f625dc5676f869`; acquisition manifest `5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50`.