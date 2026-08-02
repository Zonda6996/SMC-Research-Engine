# F&G case-control audit: verdict and interpretation

Pre-registration: `fng-case-control-preregistration.md`. Results: `fng-case-control-audit.{md,json}`.
Optimization note: the permutation test was reimplemented via rank-sum Mann-Whitney for
speed AFTER unit tests validated it against the pairwise definition on planted and
independent fixtures; the statistical scheme, seed (4242), and permutation count (2000)
are exactly as pre-registered.

## Formal verdict (frozen rules): WEAK SIGNAL

max-T p <= 0.05 on both development datasets (0.0140 / 0.0010), but no feature reaches
AUC >= 0.70 on BOTH (volPressure: 0.618 on btc-15m, 0.708 on btc-1h). Per the frozen
interpretation table this does NOT authorize a detector experiment by itself.

## The substantive finding (first positive discriminator in the whole project)

**volPressure (volume / SMA(volume,50)) is the top-ranked feature on ALL SIX datasets,
always in the same direction (label bars have HIGHER relative volume), significant
everywhere (p = 0.0005..0.0140):**

| dataset | AUC | median case | median control |
|---|---|---|---|
| btc-perp-15m (dev) | 0.618 | 0.90 | 0.67 |
| btc-perp-1h (dev) | 0.708 | 1.66 | 0.71 |
| eth-perp-15m | 0.703 | 1.43 | 0.64 |
| sol-spot-15m | 0.697 | 1.26 | 0.70 |
| btc-perp-5m | 0.637 | 1.23 | 0.66 |
| btc-perp-4h | 0.676 | 1.47 | 0.76 |

After V1-V7' (zero exact-bar discriminators found in band geometry), this is the first
feature that systematically distinguishes the vendor's exact emission bar from its
episode neighbors - and it is consistent with the vendor's "simplified fear & greed"
description (volume spike as capitulation/greed proxy). Notably, the canonical composite
(fngComposite: 0.45-0.49) does NOT discriminate; the signal is specifically in raw
relative volume, not in the textbook F&G blend.

Secondary consistent-but-weak pattern: stoch14 slightly high on cases everywhere
(0.54-0.58) and bandPos slightly low (0.41-0.49) - the label bar tends to close deeper
in the band on elevated stochastic, but neither survives as a strong discriminator.

## Honest caveats

1. AUC ~0.62-0.71 within-episode is far from exact-bar reproduction: as a standalone
   trigger it cannot approach precision >= 15% at tolerance 0. Volume is a COMPONENT of
   the mechanism, not the mechanism.
2. The corpus is hypothesis-seen; these numbers are development-grade. Any detector
   built on volume features must be pre-registered and confirmed on genuinely unseen
   data (future period or new symbol per the OOS spec in htf-gap-falsification.md).
3. Volume was NOT available to V1-V7' (bands-only information set). This audit therefore
   does not contradict the perturbation-probe conclusion (labels not computed from
   bands); it refines it: the hidden input plausibly includes VOLUME.

## Recorded next-step candidates (NOT started)

- N1: volume-feature enrichment audit - test a small frozen family of volume transforms
  (spike z-score, multi-window ratios, signed spike) in the same case-control design to
  see if any single transform reaches strong discrimination (AUC >= 0.70 on both dev).
- N2: only if N1 finds a strong transform - pre-registered detector: episode grammar +
  volume-spike trigger, small grid, standard gates, sealed discipline.
- N3: data request to the vendor-indicator user (unchanged): intermediate plot series
  and/or trade exports with visible TP/stop levels for the stop-formula question.
