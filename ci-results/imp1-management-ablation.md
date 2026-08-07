# IMP1 - management ablation on OUR signals, calibrated geometry, NET of 0.05%/fill fees

Signals fixed (own2Raw + gate). Only management varies. 60/40 time split per series;
train ranks, holdout only reports. R basis: variant-own worst-case stop = -1R.

| variant | TRAIN | HOLDOUT | description |
|---|---|---|---|
| STATIC2 | n  657 | mean R 0.0145 | total     9.5R | WR 57.8% | PF 1.05 | n  353 | mean R 0.0530 | total    18.7R | WR 60.9% | PF 1.29 | static TP 2 steps (std-like), with partial |
| NOADD-MEAN | n 1385 | mean R -0.0050 | total    -6.9R | WR 66.6% | PF 0.97 | n  868 | mean R 0.0373 | total    32.4R | WR 70.5% | PF 1.30 | no add, all out at mean |
| MEANEXIT | n 1385 | mean R -0.0093 | total   -12.8R | WR 74.0% | PF 0.94 | n  868 | mean R 0.0288 | total    25.0R | WR 76.6% | PF 1.28 | take everything at mean touch |
| TIME48 | n 1415 | mean R -0.0130 | total   -18.4R | WR 60.6% | PF 0.91 | n  908 | mean R 0.0257 | total    23.4R | WR 63.8% | PF 1.26 | BASE + time stop 48 bars |
| HALFMEAN | n  820 | mean R -0.0170 | total   -14.0R | WR 59.4% | PF 0.92 | n  451 | mean R 0.0526 | total    23.7R | WR 67.8% | PF 1.39 | 50% at mean, rest to inner band, BE |
| WIDE | n  758 | mean R -0.0202 | total   -15.3R | WR 64.4% | PF 0.88 | n  404 | mean R 0.0632 | total    25.5R | WR 69.8% | PF 1.93 | stop 3 steps, otherwise BASE |
| TIGHT | n  906 | mean R -0.0207 | total   -18.8R | WR 51.5% | PF 0.94 | n  482 | mean R 0.0742 | total    35.7R | WR 60.8% | PF 1.31 | stop 1.5 steps, otherwise BASE |
| BASE | n  820 | mean R -0.0218 | total   -17.9R | WR 58.7% | PF 0.92 | n  451 | mean R 0.0675 | total    30.5R | WR 65.9% | PF 1.44 | vendor safe machinery (calibrated reference) |
| NOADD | n  831 | mean R -0.0238 | total   -19.7R | WR 52.0% | PF 0.91 | n  456 | mean R 0.0821 | total    37.4R | WR 59.0% | PF 1.49 | no averaging-in, same stop |
| NOPART | n  736 | mean R -0.0281 | total   -20.6R | WR 60.3% | PF 0.93 | n  358 | mean R 0.1465 | total    52.5R | WR 75.7% | PF 1.61 | no partial - full position to inner band |
## Verdict (appended post-run)

1. NO management variant creates edge on train: all 10 sit at
   -0.03..+0.01 mean R net. On holdout ALL 10 are positive
   (+0.03..+0.15). That pattern = REGIME effect, not management skill:
   the recent 40% window favors mean-reversion everywhere. Ranking by
   holdout would be self-deception (NOPART's +0.15 has the WORST train
   rank - classic noise).
2. Only robust reading: STATIC2 is the sole variant non-negative on
   BOTH halves; and management choice moves mean R by only ~0.04R
   total spread. The exit wrapper is a ~zero-sum knob, exactly like
   the vendor's own machinery (GEO4/GEO5).
3. => The lever that remains is SELECTION, not management: which
   extension signals to take. ZC5's liquidity-context filter (+0.18R,
   54 fwd trades) is the only thing so far that moved mean R by an
   order of magnitude more than any management tweak.
4. Next: IMP2 - cross the extension universe with zone/liquidity
   context (sweep of non-top pool, distance-to-pool, HTF alignment) as
   a FILTER, same train/holdout protocol, fees included. Target:
   mean R > +0.05 net on BOTH halves before any live consideration.
