# Stateful Apex S4 — диагностика источника потерь

- Verdict: **DIAGNOSTIC_CANDIDATE_ONLY / NO_ARM**.
- Только S1 train TF>=15m: 15 series / 6 symbols / 2770 events.
- Seals: S1 untouched OOS files/rows/events/labels/features = **0/0/0/0/0**; ONDO/VIRTUAL = **0/0/0/0/0**; Vendor Shapes after parser discard = **0**.
- Cutoff: **не выбран**. PnL-grid: **не запускался**.

## Expectancy decomposition

- gross=-0.0146, fees=0.0798, net=-0.0944 R/event; CI95(net)=[-0.1798, 0.0096].
- stop contribution=-0.5519, target contribution=0.5374, fee contribution=-0.0798.
- P(stop)=0.5519, P(target)=0.4481, gross breakeven target probability=0.4547, net=0.4899.
- Primary attribution: **вход/геометрия и stop/path уже дают отрицательный gross expectancy**.
- favorable-then-stop=1434/1456; never-favorable-before-stop=22/1456; collisions=0; fee-flips=0.

## Path / geometry / repeats

- MFE median=0.6694, MAE median=1.0169, reward:risk median=1.1035.
- Frozen episodes=20130; emissions per episode 0/1=17360/2770; invariant <=1: PASS.
- Breadth agreement with pooled sign: symbols=0.8333, series=0.8000; max |symbol contribution|=0.3915.

## Preregistered statistical screens

- PASS stop/path: barsSinceInner ↔ stopBeforeTarget, effect=0.0870, CI=[0.0369,0.2140], q=0.0212.
- PASS stop/path: barsSinceInner ↔ favorableThenStop, effect=0.0907, CI=[0.0406,0.2191], q=0.0212.
- PASS fee: barsSinceInner ↔ costR, effect=0.1962, CI=[0.1586,0.3230], q=0.0005.
- PASS stop/path: newAdverseExtremes ↔ stopBeforeTarget, effect=0.1504, CI=[0.0654,0.2490], q=0.0036.
- PASS stop/path: newAdverseExtremes ↔ favorableThenStop, effect=0.1503, CI=[0.0646,0.2526], q=0.0095.
- PASS fee: newAdverseExtremes ↔ costR, effect=0.2760, CI=[0.3499,0.4687], q=0.0005.
- PASS stop/path: lastExtensionIncrementOverInner ↔ stopBeforeTarget, effect=0.1551, CI=[0.0467,0.2745], q=0.0232.
- PASS stop/path: lastExtensionIncrementOverInner ↔ favorableThenStop, effect=0.1386, CI=[0.0263,0.2595], q=0.0466.
- PASS fee: lastExtensionIncrementOverInner ↔ costR, effect=0.3059, CI=[0.2550,0.4305], q=0.0005.
- PASS fee: previousExtensionIncrementOverInner ↔ costR, effect=0.3325, CI=[0.0629,0.3222], q=0.0080.
- PASS stop/path: recoveryFromExtremeOverInner ↔ stopBeforeTarget, effect=-0.1402, CI=[-0.2532,-0.0839], q=0.0027.
- PASS stop/path: recoveryFromExtremeOverInner ↔ favorableThenStop, effect=-0.1493, CI=[-0.2592,-0.0859], q=0.0036.
- PASS fee: rangeOverInner ↔ costR, effect=0.1592, CI=[0.0318,0.1822], q=0.0120.
- PASS fee: lowerWickOverInner ↔ costR, effect=0.1006, CI=[0.0182,0.1719], q=0.0223.
- PASS fee: trueRangeOverInner ↔ costR, effect=0.1596, CI=[0.0310,0.1820], q=0.0123.
- Иерархически выбран только диагностический future candidate (без cutoff/PnL): **recoveryFromExtremeOverInner → favorableThenStop**.

## Integrity

- Design SHA-256: `751fcedb42cf05d02ec480ce052abb7db813759a60651060da752661daf45464`.
- Runner SHA-256: `d73bc8d8cd61009542abb5e9f084a234c4fef6b2aedf33924060ea649a85ad10`.
- Allowed inventory and complete event/episode ledgers are in the JSON artifact.
- Association CI: 10000 deterministic hierarchical symbol→symbol-month resamples; BH FDR 5% separately within four preregistered families.
