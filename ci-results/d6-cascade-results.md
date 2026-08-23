# D6 cascade reversion — TERMINAL OOS REVEAL

# Вердикт линии: `INCONCLUSIVE DATA`

> Событие: ΔOI_8h ≤ −15% И ΔP_8h ≤ −3% → LONG next-open (min-gap 8 баров). OOS от 2025-02-12T03:00:00.000Z. Prereg `a7fa407a…`.

## ARM H24 (фикс-горизонт 24 бара, net %) — `INCONCLUSIVE DATA`
- N=54; mean 0.6529%; total 35.26%; PF 1.157; WR 38.9%; maxDD 56.5%.
- **UTC-day cluster CI95: [-3.1893%; 4.7754%]**, median 0.5811%.
- Gross-медиана дескриптивно: 0.7529%.

## ARM CANON (движок safe, netR @5bps + funding) — `INCONCLUSIVE DATA`
- N=53; mean -0.1171R; total -6.21R; PF 0.646; WR 58.5%; maxDD 10.5R.
- Исходы: {"partial-stop":10,"full-tp":34,"stop":9}.
- **UTC-day cluster CI95: [-0.3308; 0.0608]R**, median -0.1165R.
- Gross@0 mean дескриптивно: -0.1332R.

## Funding-sign диагностика (в гейты не входит)
- H24: paired delta -0.9275%/opportunity, CI95 [-2.8230; 0.69376], retained N=22, executed mean -0.6740%.
- CANON: paired delta 0.0032R/opportunity, CI95 [-0.1530; 0.1722], retained N=21, executed mean -0.2875R.

## Гейты и терминальность
- GO_line ⇔ хотя бы одна co-primary рука: N≥100 И lower95>0. Обе руки объявлены в prereg заранее.
- Корпус/OOS сожжены для этой гипотезы; ретюны и спасы запрещены.

## Provenance
- prereg `a7fa407a2dae04dd01759633051a9556290118a47ec4e3684a79721f5f41f039`; acquisition manifest корпуса `5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50`; seed 23082026, samples 10000.