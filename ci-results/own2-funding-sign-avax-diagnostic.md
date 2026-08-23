# OWN2 + funding-sign — AVAX-only one-time diagnostic reveal

# `INCONCLUSIVE SMALL-N`

Точечное направление: **point estimate supports filter**. Это не общий GO: раскрыт один symbol, baseline N=105<250.

## Counts
- Raw OWN2 candidates: 462; baseline opportunities/executed trades: 105/105.
- Retained: 77; vetoed: 28; retained rate 73.33%.
- Decisions: {"retain":77,"veto-sign":28,"veto-zero":0,"veto-missing":0}.

## Economics (R)
| arm / cost | N | total R | mean R | PF | WR | max DD R |
|---|---:|---:|---:|---:|---:|---:|
| baseline gross 0 bps + actual funding | 105 | -11.38054 | -0.10839 | 0.68227 | 0.59048 | 14.69059 |
| baseline net 5 bps + actual funding | 105 | -12.18883 | -0.11608 | 0.66380 | 0.59048 | 15.44950 |
| filtered gross 0 bps, veto=0/opportunity | 105 | -5.40303 | -0.05146 | 0.78061 | 0.44762 | 7.88417 |
| filtered net 5 bps, veto=0/opportunity | 105 | -5.99183 | -0.05707 | 0.75981 | 0.44762 | 8.43824 |
| filtered net 5 bps, executed retained only | 77 | -5.99183 | -0.07782 | 0.75981 | 0.61039 | 8.43824 |

## Primary paired comparison
- Mean/total baseline net per opportunity: -0.11608 / -12.18883R.
- Mean/total filtered net per opportunity (veto=0): -0.05707 / -5.99183R.
- Paired delta mean/total: 0.05902 / 6.19700R.
- UTC-day bootstrap CI95 (10k, seed 25082026): [-0.00158, 0.12537], median 0.05847 R/opportunity.

## Selection effect and veto counterfactual
- Retained subset baseline-before-filter @5: N=77, total -5.99183R, mean -0.07782, PF 0.75981, WR 0.61039, DD 8.43824R.
- Vetoed counterfactual baseline @5: N=28, total -6.19700R, mean -0.22132, PF 0.45203, WR 0.53571, DD 7.43459R.

## Funding, sides, concentration
- Baseline decomposition: price gross -11.83234R; funding 0.45181R; fee drag 0.80829R.
- Retained decomposition: price gross -5.93564R; funding 0.53261R; fee drag 0.58879R.
- Latest settled-rate age, hours: min 1.00, median 5.00, p90 8.00, max 8.00.
- Baseline net @5 sides: long {"n":50,"totalR":-6.460029242015907,"meanR":-0.12920058484031816,"pf":0.6360568055018713,"wr":0.58,"maxDdR":8.369235880006277}, short {"n":55,"totalR":-5.728796355021668,"meanR":-0.10415993372766669,"pf":0.6904142439567058,"wr":0.6,"maxDdR":8.792676021302423}.
- Retained net @5 sides: long {"n":30,"totalR":-0.7621482086181385,"meanR":-0.025404940287271284,"pf":0.9121005911396449,"wr":0.6333333333333333,"maxDdR":4.715415760946401}, short {"n":47,"totalR":-5.229680448015822,"meanR":-0.11126979676629409,"pf":0.6786722814562499,"wr":0.5957446808510638,"maxDdR":8.58426920530722}.
- Concentration (share of absolute net R): baseline top day 0.0170, top trade 0.0170; retained top day 0.0230, top trade 0.0230.

## Ограничения простыми словами
Это один AVAX и небольшое число сделок. Результат может быть особенностью именно AVAX или данного периода; проверить переносимость на другие рынки невозможно. Bootstrap оценивает временную неопределённость внутри этой серии, но не заменяет независимые symbols. Поэтому независимо от знака point estimate итог остаётся `INCONCLUSIVE SMALL-N`, а не clean multi-symbol GO.

## Provenance
- Amendment SHA-256: `faf09ed3b260d96f3f0d45dec7d7f94b8f12208e6666f8e2da95c76f319e9a63`.
- Candle SHA-256: `63d3716eb8feb891c19786e5c27a989bdae78629c390474904f651098f488dae` (PASS).
- Funding rows: 2890, 2023-12-31T00:00:00.000Z — 2026-08-20T00:00:00.001Z, SHA-256 `b06393c2615176f21b26b4dc3a92cb6d769b69a125fd120cf884f63d41794947`.
- Machine-readable result: `ci-results/own2-funding-sign-avax-diagnostic.json`; data audit: `data/own2-funding-sign-avax/manifest.json`.
