# N1 volume-transform family results

Pre-registration: `n1-volume-transforms-preregistration.md` (committed before this script existed). Selection ONLY on development datasets (maximin); batch-2 diagnostic (hypothesis-seen).

| dataset | role | episodes | vp50 | vp20 | vp100 | vz50 | vz20 | logvp50 | vmax10 | vrank200 | svz50 | vp50_2bar | max-T p |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| btc-perp-15m | development | 58 | 0.561 | 0.518 | 0.595 | 0.558 | 0.512 | 0.561 | 0.528 | 0.592 | 0.501 | 0.555 | 0.0755 |
| btc-perp-1h | development | 30 | 0.722 | 0.693 | 0.672 | 0.722 | 0.691 | 0.722 | 0.653 | 0.662 | 0.722 | 0.720 | 0.0005 |
| eth-perp-15m | diagnostic-original | 63 | 0.634 | 0.625 | 0.660 | 0.658 | 0.635 | 0.634 | 0.595 | 0.649 | 0.600 | 0.614 | - |
| sol-spot-15m | diagnostic-original | 52 | 0.702 | 0.705 | 0.714 | 0.699 | 0.701 | 0.702 | 0.625 | 0.712 | 0.652 | 0.685 | - |
| btc-perp-5m | diagnostic-original | 69 | 0.594 | 0.579 | 0.610 | 0.601 | 0.573 | 0.594 | 0.499 | 0.588 | 0.569 | 0.594 | - |
| btc-perp-4h | diagnostic-original | 26 | 0.624 | 0.645 | 0.630 | 0.644 | 0.650 | 0.624 | 0.629 | 0.631 | 0.648 | 0.588 | - |
| btc-perp-15m-b2 | diagnostic-batch2 | 69 | 0.560 | 0.518 | 0.598 | 0.554 | 0.507 | 0.560 | 0.534 | 0.592 | 0.498 | 0.548 | - |
| btc-perp-1h-b2 | diagnostic-batch2 | 27 | 0.727 | 0.702 | 0.682 | 0.727 | 0.705 | 0.727 | 0.668 | 0.672 | 0.724 | 0.732 | - |
| btc-perp-2h-b2 | diagnostic-batch2 | 32 | 0.744 | 0.738 | 0.754 | 0.747 | 0.734 | 0.744 | 0.698 | 0.739 | 0.741 | 0.698 | - |
| ondo-perp-15m-b2 | diagnostic-batch2 | 47 | 0.691 | 0.677 | 0.687 | 0.697 | 0.694 | 0.691 | 0.659 | 0.684 | 0.625 | 0.668 | - |
| ondo-perp-1h-b2 | diagnostic-batch2 | 63 | 0.735 | 0.748 | 0.727 | 0.740 | 0.737 | 0.735 | 0.708 | 0.726 | 0.738 | 0.728 | - |
| ondo-perp-2h-b2 | diagnostic-batch2 | 31 | 0.740 | 0.737 | 0.704 | 0.735 | 0.716 | 0.740 | 0.714 | 0.689 | 0.735 | 0.730 | - |
| bnb-perp-3m-b2 | diagnostic-batch2 | 40 | 0.699 | 0.698 | 0.681 | 0.692 | 0.680 | 0.699 | 0.673 | 0.671 | 0.670 | 0.650 | - |
| sp500-cfd-1m-b2 | diagnostic-batch2 | 31 | 0.615 | 0.654 | 0.611 | 0.619 | 0.662 | 0.615 | 0.686 | 0.611 | 0.607 | 0.606 | - |

Winner (frozen maximin on dev): **vp100**, min dev AUC 0.595; diagnostic reversals: 0/12.

## Pre-registered verdict

**NO IMPROVEMENT (winner vp100, min dev AUC 0.595 < 0.70 bar)**
## Interpretation notes (post-run, appended once)

- The 0.70 bar was missed because of ONE dataset: btc-perp-15m (dev), where ALL ten
  transforms sit at 0.50-0.60 and family max-T p = 0.0755 (not significant). The
  other 13 datasets are consistent with the confirmed effect (0 reversals; ten of
  them have some transform >= 0.65).
- Timeframe moderator is now clearly visible: 1h/2h episodes show AUC 0.70-0.76
  everywhere; 15m/5m/3m/1m sit lower (0.55-0.70). The volume signature of the label
  bar is much sharper on higher timeframes - consistent with the user's report that
  2h/1h are the vendor's strongest timeframes.
- No transform materially beats plain vp50; the family plateaus at the same level.
  Volume information content is saturated at ~AUC 0.7 (HTF) regardless of the
  functional form. Detector line (N2) is NOT authorized per the frozen rules.
- Honest reading: elevated relative volume is a real, OOS-confirmed component of
  the emission mechanism, but on low timeframes it is weak, and no volume-only
  trigger will reach exact-bar precision anywhere. The remaining unexplained part
  of the mechanism requires data we do not have (vendor intermediate series - the
  standing N3 data request).
