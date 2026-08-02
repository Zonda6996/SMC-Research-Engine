# Pre-registration: N1 volume-transform family (strong-form search)

Branch: research/fng-case-control. Committed BEFORE any transform is computed.
Family, statistics, corpus roles and success criteria are FROZEN below.

## Question

volPressure (vol/SMA50) is an OOS-CONFIRMED discriminator (7/8 batch-2) at AUC
0.59-0.76. N1 asks: does a BETTER causal transform of the same volume information
reach STRONG discrimination - AUC >= 0.70 on both development datasets - which is
the pre-declared bar for authorizing a detector experiment (N2)?

## Corpus roles (FROZEN)

- Development (selection happens here ONLY): btc-perp-15m, btc-perp-1h (original
  corpus, volumes from data/vendor-exports/volume/*.json).
- Diagnostic (reported, no selection): remaining 4 original datasets + all 8
  batch-2 datasets (batch-2 is hypothesis-seen for volume ideas since the OOS run;
  it can DISCONFIRM stability but cannot confirm anything new).
- Any transform selected here inherits "development-grade" status. A future N2
  detector still requires genuinely fresh data for confirmation.

## Transform family (10, FROZEN; all causal at bar i; W denotes window)

t1  vp50        volume/SMA(vol,50)                  [baseline, confirmed]
t2  vp20        volume/SMA(vol,20)
t3  vp100       volume/SMA(vol,100)
t4  vz50        (volume - SMA(vol,50)) / SD(vol,50)  [spike z-score]
t5  vz20        z-score, W=20
t6  logvp50     ln(1 + vp50)
t7  vmax10      volume / max(vol, i-10..i-1)         [local dominance]
t8  vrank200    causal percentile rank of volume over trailing 200 bars
t9  svz50       sign(close-open) * vz50, side-mirrored [signed spike]
t10 vp50_2bar   (vol_i + vol_{i-1}) / (2*SMA(vol,50)) [2-bar burst]

Side mirroring: only t9 is directional (SELL episodes: sign flipped). t1-t8, t10
are side-symmetric.

## Statistics (FROZEN; identical case-control machinery as prior audits)

- Same episode grammar, case/control definition, ±2 buffer, warm-up handling.
- Per-transform AUC on each dataset; on development datasets additionally a
  max-T permutation p across the 10 transforms (2,000 perms, mulberry32 seed 4242)
  to account for family-wise selection.
- Selection rule: the WINNER is the transform with the highest minimum AUC across
  the two development datasets (maximin), reported with max-T p.

## Success criteria (FROZEN)

- STRONG: winner's AUC >= 0.70 on BOTH development datasets AND max-T p <= 0.05 on
  both -> authorizes drafting N2 (pre-registered detector experiment; NOT built in
  this session).
- NO IMPROVEMENT: winner fails the bar -> volPressure stands as-is; detector line
  waits for richer data (e.g. vendor intermediate series); result recorded.
- Diagnostic tables on the 12 non-development datasets are reported either way;
  if the winner shows sign reversal (AUC < 0.5) on >= 3 diagnostic datasets, the
  STRONG verdict is downgraded to FRAGILE regardless of development numbers.

## Out of scope

No detector, no grids beyond the 10 transforms above, no exit-logic analysis,
no combination/stacking of transforms.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit.
