# H2 HTF confluence results

Pre-registration: `h2-htf-confluence-preregistration.md`. ALIGNED = HTF co-stretched (|stretch| >= 0.25 on the label side); outcome = wide_hold realized R; strict no-lookahead HTF mapping; within-pair permutation (2000, seed 4242).

| pair | n aligned | n not | mean R aligned | mean R not | diff |
|---|---|---|---|---|---|
| ondo-perp-15m-b2 -> ondo-perp-1h-b2 | 28 | 35 | 0.923 | 0.779 | 0.144 |
| ondo-perp-15m-b2 -> ondo-perp-2h-b2 | 18 | 45 | 3.529 | -0.232 | 3.761 |
| ondo-perp-1h-b2 -> ondo-perp-2h-b2 | 62 | 20 | 1.680 | -0.693 | 2.373 |
| btc-perp-15m-b2 -> btc-perp-1h-b2 | 46 | 39 | -0.198 | -0.624 | 0.426 |
| btc-perp-15m-b2 -> btc-perp-2h-b2 | 34 | 51 | -0.579 | -0.269 | -0.310 |
| btc-perp-1h-b2 -> btc-perp-2h-b2 | 30 | 10 | -1.730 | 3.008 | -4.738 |

Pooled: aligned n=218 mean=0.518 | not n=200 mean=-0.025 | **diff=0.543 R**, permutation p=0.1854, sign agreement 4/6.

## Pre-registered verdict

**INCONCLUSIVE**

## Secondary (exploratory, no confirmation weight)

Spearman(signed HTF stretch, R) = 0.083; Spearman(HTF vp50, R) = 0.070; recent same-dir HTF label: mean R -2.242 (n=9) vs 0.313 without.
## Interpretation notes (post-run, appended once)

1. INCONCLUSIVE by the frozen rules: pooled diff +0.543 R is economically large
   (aligned labels average +0.518 R, non-aligned -0.025 R) and exceeds the +0.25 R
   effect bar, but the within-pair permutation p = 0.185 fails the 0.05 gate.
   Realized-R variance per label is huge (-3R to double-digit R), so ~420 labels
   cannot certify a difference of this size. Honest state: promising, unproven.
2. Heterogeneity is the story: ONDO pairs all positive (up to +3.76 R diff);
   BTC mixed with one large negative (btc 1h->2h: -4.74 R on only 10 non-aligned
   labels - tiny cells, unstable estimates). Effect may be symbol- or
   regime-dependent, or noise.
3. Secondary signals are weak (Spearman ~0.07-0.08), suggesting alignment as a
   BINARY gate, if real, is not driven by a smooth monotone stretch relation.
   The "recent HTF label" cell (n=9, mean -2.24 R) is too small to read.
4. Standing status: HTF confluence is a REGISTERED CANDIDATE requiring fresh
   data (batch-3: new symbols/periods with LTF+HTF same-window exports) for a
   dedicated confirmation run. It must NOT be built into any detector or policy
   until then. This is the project's main open hypothesis going forward.
