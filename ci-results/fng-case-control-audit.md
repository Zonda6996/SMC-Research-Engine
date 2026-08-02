# F&G case-control audit results

Pre-registration: `fng-case-control-preregistration.md` (committed before this script existed). 12 frozen features, controls = same-episode bars excluding ±2, max-T permutation 2000 perms seed 4242.

## btc-perp-15m [development]

Labeled episodes 58; labels outside episodes 11; dropped (no controls) 0; median controls/episode 87.

| feature | AUC | median case | median control |
|---|---|---|---|
| rsi14 | 0.501 | 43.3962 | 43.1247 |
| roc10 | 0.481 | -0.0012 | -0.0012 |
| atrNorm14 | 0.549 | 0.0031 | 0.0029 |
| atrRegime | 0.597 | 1.0777 | 0.9876 |
| devSma50 | 0.417 | -0.0072 | -0.0053 |
| volPressure | 0.618 | 0.9035 | 0.6680 |
| signedVolPress | 0.470 | -0.1494 | -0.1108 |
| bandPos | 0.414 | 0.1112 | 0.1645 |
| stoch14 | 0.559 | 44.4824 | 43.2548 |
| rangePos50 | 0.456 | 0.2387 | 0.2700 |
| fngComposite | 0.454 | 0.4244 | 0.4587 |
| recoveryHW | 0.464 | 0.3671 | 0.3974 |

Max |AUC-0.5| = 0.118 (volPressure); max-T null q95 = 0.103; **p = 0.0140**.

## btc-perp-1h [development]

Labeled episodes 30; labels outside episodes 13; dropped (no controls) 1; median controls/episode 68.

| feature | AUC | median case | median control |
|---|---|---|---|
| rsi14 | 0.468 | 42.3753 | 43.0873 |
| roc10 | 0.515 | -0.0014 | -0.0022 |
| atrNorm14 | 0.496 | 0.0058 | 0.0058 |
| atrRegime | 0.507 | 1.0576 | 1.0491 |
| devSma50 | 0.411 | -0.0139 | -0.0108 |
| volPressure | 0.708 | 1.6594 | 0.7117 |
| signedVolPress | 0.511 | -0.0926 | -0.1139 |
| bandPos | 0.436 | 0.1211 | 0.1592 |
| stoch14 | 0.570 | 49.9695 | 41.8727 |
| rangePos50 | 0.446 | 0.2396 | 0.2790 |
| fngComposite | 0.451 | 0.4337 | 0.4500 |
| recoveryHW | 0.443 | 0.3772 | 0.4058 |

Max |AUC-0.5| = 0.208 (volPressure); max-T null q95 = 0.133; **p = 0.0010**.

## eth-perp-15m [holdout-diagnostic]

Labeled episodes 64; labels outside episodes 10; dropped (no controls) 1; median controls/episode 62.

| feature | AUC | median case | median control |
|---|---|---|---|
| rsi14 | 0.497 | 42.2646 | 42.4303 |
| roc10 | 0.472 | -0.0019 | -0.0014 |
| atrNorm14 | 0.539 | 0.0042 | 0.0040 |
| atrRegime | 0.557 | 1.0593 | 0.9840 |
| devSma50 | 0.442 | -0.0091 | -0.0074 |
| volPressure | 0.703 | 1.4284 | 0.6424 |
| signedVolPress | 0.477 | -0.1000 | -0.1019 |
| bandPos | 0.482 | 0.1146 | 0.1298 |
| stoch14 | 0.578 | 49.4149 | 43.2149 |
| rangePos50 | 0.507 | 0.2626 | 0.2661 |
| fngComposite | 0.457 | 0.4225 | 0.4563 |
| recoveryHW | 0.512 | 0.4615 | 0.4286 |

Max |AUC-0.5| = 0.203 (volPressure); max-T null q95 = 0.103; **p = 0.0005**.

## sol-spot-15m [holdout-diagnostic]

Labeled episodes 52; labels outside episodes 11; dropped (no controls) 0; median controls/episode 78.

| feature | AUC | median case | median control |
|---|---|---|---|
| rsi14 | 0.497 | 43.4272 | 43.3083 |
| roc10 | 0.429 | -0.0039 | -0.0020 |
| atrNorm14 | 0.488 | 0.0045 | 0.0047 |
| atrRegime | 0.554 | 1.0460 | 1.0019 |
| devSma50 | 0.449 | -0.0096 | -0.0083 |
| volPressure | 0.697 | 1.2558 | 0.7027 |
| signedVolPress | 0.457 | -0.2027 | -0.0915 |
| bandPos | 0.417 | 0.1136 | 0.1766 |
| stoch14 | 0.553 | 47.2106 | 43.6492 |
| rangePos50 | 0.475 | 0.2468 | 0.2794 |
| fngComposite | 0.475 | 0.4263 | 0.4487 |
| recoveryHW | 0.520 | 0.3984 | 0.3810 |

Max |AUC-0.5| = 0.197 (volPressure); max-T null q95 = 0.108; **p = 0.0005**.

## btc-perp-5m [holdout-diagnostic]

Labeled episodes 69; labels outside episodes 12; dropped (no controls) 0; median controls/episode 67.

| feature | AUC | median case | median control |
|---|---|---|---|
| rsi14 | 0.457 | 43.1110 | 42.9872 |
| roc10 | 0.423 | -0.0015 | -0.0007 |
| atrNorm14 | 0.503 | 0.0017 | 0.0016 |
| atrRegime | 0.561 | 1.0606 | 0.9931 |
| devSma50 | 0.407 | -0.0039 | -0.0032 |
| volPressure | 0.637 | 1.2262 | 0.6642 |
| signedVolPress | 0.391 | -0.2872 | -0.1137 |
| bandPos | 0.460 | 0.1109 | 0.1373 |
| stoch14 | 0.538 | 47.6438 | 42.3738 |
| rangePos50 | 0.457 | 0.2399 | 0.2571 |
| fngComposite | 0.451 | 0.4325 | 0.4594 |
| recoveryHW | 0.492 | 0.3700 | 0.3917 |

Max |AUC-0.5| = 0.137 (volPressure); max-T null q95 = 0.104; **p = 0.0030**.

## btc-perp-4h [holdout-diagnostic]

Labeled episodes 27; labels outside episodes 11; dropped (no controls) 0; median controls/episode 92.

| feature | AUC | median case | median control |
|---|---|---|---|
| rsi14 | 0.500 | 40.7922 | 41.3576 |
| roc10 | 0.456 | -0.0086 | -0.0077 |
| atrNorm14 | 0.489 | 0.0140 | 0.0149 |
| atrRegime | 0.487 | 1.0636 | 1.0804 |
| devSma50 | 0.491 | -0.0422 | -0.0331 |
| volPressure | 0.676 | 1.4725 | 0.7608 |
| signedVolPress | 0.429 | -0.1501 | -0.0714 |
| bandPos | 0.487 | 0.0795 | 0.1061 |
| stoch14 | 0.554 | 42.4583 | 38.0577 |
| rangePos50 | 0.463 | 0.2066 | 0.2381 |
| fngComposite | 0.491 | 0.4587 | 0.4738 |
| recoveryHW | 0.468 | 0.3097 | 0.3765 |

Max |AUC-0.5| = 0.176 (volPressure); max-T null q95 = 0.144; **p = 0.0105**.

## Pre-registered verdict

**WEAK SIGNAL (significant but below AUC 0.70 threshold on both dev datasets)**

Holdout tables are consistency diagnostics only; the corpus is hypothesis-seen. Stop/TP reverse-engineering deferred: requires vendor trade exports with visible TP/stop levels (data request recorded in the pre-registration).