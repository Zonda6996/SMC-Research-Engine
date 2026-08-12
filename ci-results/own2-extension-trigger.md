# OWN2 - extension trigger (REV1 params) + trade-state cooldown (Nikita observation)

Raw condition: correct side of Mean, pen >= -0.35 half-widths, distMean >= 3%, volRatio >= 1.4. State: no signal while trade open + 5 bars after exit. Params from REV1 medians, fixed a priori.

## 1. Recall vs forward GGI arrows (1h/2h FWD1 series)

BOTH 22, GGI-only 672, OWN2-only 530.
Recall: 3.2% (OWN1 was 20.5%). Acceptance: 4.0%.
Signal rate: median 1.1 signals/month/series (GGI ~2-3).

## 2. Standalone economics on FWD1 series (P25/S12, gross)

n=459, mean R 0.0353, WR 83.2%, P/S/F 126/77/256

## 3. ZC5 causal zone confluence with OWN2 trigger (12 majors, 14m)

| group | n | mean R | WR | P/S/F |
|---|---|---|---|---|
| in-any | 196 | -0.1095 | 83.2% | 75/33/88 |
| out | 25 | 0.0359 | 96.0% | 10/1/14 |
| SELECTIVE | 5 | 0.4925 | 100.0% | 1/0/4 |

Total signals 221. SELECTIVE pass rate 2.3%. Bootstrap P(SELECTIVE <= out): 0.0799.

## SELECTIVE trades

| date | symbol | side | R | outcome | rank |
|---|---|---|---|---|---|
| 2026-02-14T21:00 | DOGEUSDT | S | 1.237 | Full fix | 0.56 |
| 2026-07-05T01:00 | ADAUSDT | S | 0.879 | Full fix | 0.65 |
| 2026-07-21T05:00 | ADAUSDT | S | 0.541 | Full fix | 0.54 |
| 2025-07-11T08:00 | AVAXUSDT | S | -0.787 | Partial | 0.56 |
| 2026-02-23T10:00 | AVAXUSDT | L | 0.593 | Full fix | 0.52 |
## Interpretation notes (appended post-run)

1. FAILURE, recorded honestly: recall vs forward arrows COLLAPSED to
   3.2% (OWN1: 20.5%). Root cause is the trade-state cooldown: P25/S12
   trades stay open for days-weeks on 1h/2h, so the state machine
   suppresses nearly every subsequent raw signal (1.1 signals/month
   survives vs ~12 raw). GGI's interval behaviour (Nikita's observation)
   must be implemented differently - per-side, or reset on band touch,
   or vendor trades resolve much faster than our P25/S12 replay.
2. The RAW extension condition (pen/dist/vol, no state) was not measured
   separately in this run - that was a design mistake: two changes at
   once (new raw condition + state gate), so the failure cannot be
   attributed cleanly. Next run must ablate: raw-only vs raw+state.
3. Zone confluence with OWN2 got WORSE (in-any -0.11 vs out +0.04):
   extension signals inside zones with the heavy-pool caveat unfiltered.
   SELECTIVE n=5 - too small to mean anything (+0.49R, p=0.08).
4. Lesson: OWN1 (body-after-dryness) remains the best open trigger we
   have for zone confluence (ZC5 SELECTIVE +0.179R, n=54). OWN2 as
   parameterised does not replace it and does not replicate GGI.
