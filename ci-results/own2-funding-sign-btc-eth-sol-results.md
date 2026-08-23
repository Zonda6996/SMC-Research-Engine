# OWN2 + funding-sign — BTC/ETH/SOL perpetual 1h frozen holdout

# Вердикт: `INCONCLUSIVE DATA`

## Простыми словами
Проверено заранее замороженное правило: OWN2-сделки LONG разрешались только после отрицательного funding, SHORT — только после положительного. Все остальные baseline-возможности получали нулевую экспозицию в filtered-руке. Порог relVol=1.4 передан детектору явно; vendor GGI lines/shapes не читались как признаки или метки.
Последние 35% общего календаря — честный protocol holdout этого запуска. Но это не обязательно globally untouched окно: BTC/ETH/SOL и пересекающиеся даты уже могли встречаться в прежних исследованиях. Поэтому даже положительный результат был бы слабее полностью нового внешнего корпуса.

## Данные и честность
- Preregistration SHA-256: `6442965a30ddb0546b82cbd29529ab27d1de79539dc143f4503d261d40f183d9`.
- Pre-outcome acquisition manifest SHA-256: `80ea6a481a3d987210ee36c1365f21990d9f497cb8423527114ec5d6617b3586`.
- Acquired-data manifest SHA-256 before outcomes: `33a52fbe8ec89a08fb6dbd8416dda03f7dee7bdf182335c87ff24e15c00d02d8`.
- Common exact timestamps: true; overlap 2024-01-01T00:00:00.000Z — 2026-08-20T15:00:00.000Z; cutoff 2025-09-17T17:00:00.000Z.
- Candle QA and official funding QA: `data/own2-funding-sign-btc-eth-sol/manifest.json`; no interpolation or assumed cadence.

## Поток наблюдений
- Pooled admitted baseline holdout opportunities/trades: 101/101.
- Retained: 56; vetoed: 45; retained rate 55.45%.
- Funding decisions: {"retain":56,"veto-sign":45,"veto-zero":0,"veto-missing":0}.
- BTCUSDT: {"rawCandidatesAll":441,"rawCandidatesHoldout":149,"admittedTradesAll":97,"admittedBaselineHoldout":34}; retained 16, vetoed 18.
- ETHUSDT: {"rawCandidatesAll":426,"rawCandidatesHoldout":151,"admittedTradesAll":104,"admittedBaselineHoldout":34}; retained 19, vetoed 15.
- SOLUSDT: {"rawCandidatesAll":403,"rawCandidatesHoldout":129,"admittedTradesAll":88,"admittedBaselineHoldout":33}; retained 21, vetoed 12.

## Aggregate economics
| arm | N | totalR | meanR/trade | meanR/baseline-opportunity | PF | WR | maxDD | fundingR | costsR | mean/median holding bars |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline gross 0 bps + actual funding | 101 | -17.53671 | -0.17363 | -0.17363 | 0.57540 | 0.52475 | 18.82059 | 0.00382 | 0 | 184.11/145.00 |
| baseline net 5 bps + actual funding | 101 | -18.81186 | -0.18626 | -0.18626 | 0.55292 | 0.52475 | 19.79858 | 0.00382 | 1.27516 | 184.11/145.00 |
| filtered net 5 bps, veto=0 per opportunity | 101 | -6.59726 | -0.06532 | -0.06532 | 0.68368 | 0.30693 | 7.83458 | 0.23718 | 0.69338 | 192.98/138.00 |
| filtered retained executed only | 56 | -6.59726 | -0.11781 | -0.06532 | 0.68368 | 0.55357 | 7.83458 | 0.23718 | 0.69338 | 192.98/138.00 |

## Per symbol (net 5 bps + actual funding)
| symbol | baseline N | retained | baseline total/mean | filtered total/mean executed | filtered mean/opportunity | paired delta/opportunity | improved |
|---|---:|---:|---:|---:|---:|---:|---|
| BTCUSDT | 34 | 16 | -7.88341/-0.23186 | -0.72730/-0.04546 | -0.02139 | 0.21047 | yes |
| ETHUSDT | 34 | 19 | -9.18369/-0.27011 | -4.34110/-0.22848 | -0.12768 | 0.14243 | yes |
| SOLUSDT | 33 | 21 | -1.74477/-0.05287 | -1.52886/-0.07280 | -0.04633 | 0.00654 | yes |

## Paired inference and gates
- Paired delta: total 12.21461R; mean 0.12094R per baseline opportunity.
- Joint UTC-day bootstrap CI95: [0.00607, 0.23890], median 0.11927 (10k, seed 25082026).
- Improvement breadth: 3/3 symbols.
- Gates: {"baselineOpportunities":false,"retainedTrades":false,"filteredNetExpectancyPositive":false,"pairedCiLowerPositive":true,"breadthAtLeastTwoOfThree":true}.
- Frozen classification: **INCONCLUSIVE DATA**.

## Counterfactuals, sides, concentration and rate age
- Retained baseline counterfactual: {"n":56,"totalR":-6.597255844547561,"meanR":-0.11780814008120645,"meanPerBaselineOpportunity":-0.06531936479750061,"pf":0.6836800426469417,"wr":0.5535714285714286,"maxDdR":7.834581464110987,"fundingR":0.23717900047634446,"costsR":0.6933849670690223,"meanHoldingBars":192.98214285714286,"medianHoldingBars":138}.
- Vetoed baseline counterfactual: {"n":45,"totalR":-12.214607797749382,"meanR":-0.2714357288388752,"meanPerBaselineOpportunity":-0.12093671086880577,"pf":0.42440930568338187,"wr":0.4888888888888889,"maxDdR":14.00198806055416,"fundingR":-0.2333616139471034,"costsR":0.581772909649683,"meanHoldingBars":173.06666666666666,"medianHoldingBars":161}.
- Baseline long/short: {"long":{"n":56,"totalR":-17.99673066496764,"meanR":-0.3213701904458507,"meanPerBaselineOpportunity":-0.17818545212839246,"pf":0.3811824052907703,"wr":0.44642857142857145,"maxDdR":20.902269353427876,"fundingR":-0.17769008180144344,"costsR":0.6700162657827167,"meanHoldingBars":177.42857142857142,"medianHoldingBars":161},"short":{"n":45,"totalR":-0.8151329773293103,"meanR":-0.018114066162873563,"meanPerBaselineOpportunity":-0.008070623537913964,"pf":0.9372724792649622,"wr":0.6222222222222222,"maxDdR":3.791934296376054,"fundingR":0.18150746833068457,"costsR":0.6051416109359885,"meanHoldingBars":192.42222222222222,"medianHoldingBars":144}}.
- Retained long/short: {"long":{"n":20,"totalR":-2.011831846489366,"meanR":-0.1005915923244683,"meanPerBaselineOpportunity":-0.01991912719296402,"pf":0.7440890339701183,"wr":0.6,"maxDdR":5.377767291450964,"fundingR":0.057177844035860854,"costsR":0.15957970078392814,"meanHoldingBars":183.3,"medianHoldingBars":204},"short":{"n":36,"totalR":-4.585423998058198,"meanR":-0.12737288883494996,"meanPerBaselineOpportunity":-0.04540023760453662,"pf":0.6471345327488419,"wr":0.5277777777777778,"maxDdR":5.33696209196541,"fundingR":0.18000115644048367,"costsR":0.5338052662850942,"meanHoldingBars":198.36111111111111,"medianHoldingBars":134}}.
- Concentration baseline: {"topTradeAbsShare":0.025034779386449532,"topUtcDayAbsShare":0.04651978154460578,"topTrades":[{"symbol":"SOLUSDT","decisionUtc":"2026-06-23T13:00:00.000Z","side":"long","netR":1.6358395075773409,"retained":true},{"symbol":"ETHUSDT","decisionUtc":"2026-04-14T14:00:00.000Z","side":"short","netR":1.31494794585004,"retained":true},{"symbol":"BTCUSDT","decisionUtc":"2026-08-18T13:00:00.000Z","side":"short","netR":-1.0362092791965958,"retained":true},{"symbol":"BTCUSDT","decisionUtc":"2026-06-23T13:00:00.000Z","side":"long","netR":-1.032214102916154,"retained":false},{"symbol":"ETHUSDT","decisionUtc":"2026-08-19T13:00:00.000Z","side":"short","netR":-1.028640898265921,"retained":true},{"symbol":"BTCUSDT","decisionUtc":"2026-01-19T23:00:00.000Z","side":"long","netR":-1.0285800113086254,"retained":false},{"symbol":"BTCUSDT","decisionUtc":"2026-06-01T16:00:00.000Z","side":"long","netR":-1.024653878180854,"retained":false},{"symbol":"BTCUSDT","decisionUtc":"2025-10-02T00:00:00.000Z","side":"short","netR":-1.0226800347638798,"retained":true},{"symbol":"BTCUSDT","decisionUtc":"2025-11-03T16:00:00.000Z","side":"long","netR":-1.0204862165285304,"retained":false},{"symbol":"BTCUSDT","decisionUtc":"2026-01-30T14:00:00.000Z","side":"long","netR":-1.020324740970512,"retained":false}]}.
- Concentration retained: {"topTradeAbsShare":0.04658481719061902,"topUtcDayAbsShare":0.0505392499529094,"topTrades":[{"symbol":"SOLUSDT","decisionUtc":"2026-06-23T13:00:00.000Z","side":"long","netR":1.6358395075773409,"retained":true},{"symbol":"ETHUSDT","decisionUtc":"2026-04-14T14:00:00.000Z","side":"short","netR":1.31494794585004,"retained":true},{"symbol":"BTCUSDT","decisionUtc":"2026-08-18T13:00:00.000Z","side":"short","netR":-1.0362092791965958,"retained":true},{"symbol":"ETHUSDT","decisionUtc":"2026-08-19T13:00:00.000Z","side":"short","netR":-1.028640898265921,"retained":true},{"symbol":"BTCUSDT","decisionUtc":"2025-10-02T00:00:00.000Z","side":"short","netR":-1.0226800347638798,"retained":true},{"symbol":"ETHUSDT","decisionUtc":"2025-09-22T07:00:00.000Z","side":"long","netR":-1.0148158574199042,"retained":true},{"symbol":"SOLUSDT","decisionUtc":"2025-11-12T19:00:00.000Z","side":"long","netR":-1.0137788806451913,"retained":true},{"symbol":"ETHUSDT","decisionUtc":"2026-01-30T18:00:00.000Z","side":"long","netR":-1.0103194029867972,"retained":true},{"symbol":"SOLUSDT","decisionUtc":"2026-05-13T16:00:00.000Z","side":"long","netR":-1.0088349368170462,"retained":true},{"symbol":"SOLUSDT","decisionUtc":"2026-01-02T10:00:00.000Z","side":"short","netR":-1.0070106528231637,"retained":true}]}.
- Latest settled-rate age hours: {"min":0.9999980555555555,"median":5.999996944444445,"p90":7.999998611111111,"max":8}.

## Интерпретация и ограничения
Размер выборки не прошёл заранее заданный N gate. По протоколу экономический знак не превращается ни в GO, ни в KILL: данных недостаточно.
Не сравниваем recall с expectancy: здесь вопрос только в деньгах на baseline opportunities. Нельзя ретюнить magnitude/z-score/age/side/symbol, исключать проигравший symbol или искать rescue на раскрытом holdout.

## Что дальше / чего не делать
- Не спасать правило подбором порогов на этих outcomes. Возврат возможен только с новой заранее мотивированной гипотезой и новым независимым корпусом.
- Сохранить JSON как полный machine-readable audit; этот Markdown — человекочитаемое объяснение.
