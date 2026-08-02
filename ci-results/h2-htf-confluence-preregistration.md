# Pre-registration: H2 - HTF confluence filter for LTF labels

Branch: research/fng-case-control. Committed BEFORE any computation.
Question: does the STATE OF THE HIGHER TIMEFRAME at the moment of a lower-TF
label predict that label's outcome? This tests the author's described practice
("подтверждение старшим таймфреймом") and may explain why 15m labels are weak
everywhere (O1/N1: worst drift and weakest volume signature).

Context recorded: the author's only public hint is "все стили торговли про одно
и то же, разная перспектива" - consistent with our O1/E1/E2 finding that the
harvestable edge is HTF directional drift. H2 asks whether the HTF perspective
filters LTF noise.

## Corpus (FROZEN)

LTF->HTF pairs where both legs exist for the same symbol and period:
- ondo-perp-15m-b2 -> ondo-perp-1h-b2 and -> ondo-perp-2h-b2
- ondo-perp-1h-b2  -> ondo-perp-2h-b2
- btc-perp-15m-b2  -> btc-perp-1h-b2 and -> btc-perp-2h-b2
- btc-perp-1h-b2   -> btc-perp-2h-b2
(6 pairs; batch-2 only, so both legs share the export window. Original-corpus
BTC sets lack a same-window 2h/1h pairing guarantee and are excluded.)
Warm-up rows excluded on BOTH legs. HTF state at LTF bar t uses the LAST HTF
bar whose CLOSE TIME <= t's open time (strictly no lookahead; HTF bar close
time = open time + timeframe duration).

## HTF state features (FROZEN, computed on the HTF leg)

s1 htf_side: sign(close - mean) of the HTF bar (above/below vendor mean).
s2 htf_stretch: (close - mean) / (upperOuter - mean) signed; the depth of HTF
   stretch toward its outer band (negative = toward lower).
s3 htf_vp50: HTF volPressure (volume / SMA50) - our confirmed component.
s4 htf_recent_label: 1 if the HTF leg printed a same-direction label within the
   last 12 HTF bars, else 0.

## Outcome (FROZEN, from E2's finding)

Per LTF label: wide_hold realized R (SL -3R, no TP, force-close at 192 LTF bars,
conservative fills) - the policy that actually extracts the edge. Labels with
< 48 forward bars excluded.

## Analysis (FROZEN)

Per pair and pooled (pooling weights each label equally):
- ALIGNMENT test (primary): split labels into HTF-ALIGNED (s1 sign matches label
  direction: BUY with HTF close>mean is aligned... NOTE: labels are REVERSAL
  marks; a BUY prints in a downstretch. ALIGNED is therefore defined as s2
  OPPOSING the label direction: BUY aligned iff s2 <= -0.25 (HTF also stretched
  down); SELL aligned iff s2 >= +0.25) vs NOT-ALIGNED. Compare mean wide_hold R.
- Significance: label-permutation p (2,000 shuffles of the aligned/not flag
  within each pair, seed 4242) for the pooled difference in means.
- Secondary (reported, no confirmation weight): Spearman correlation of each
  s-feature with realized R; s4 hit rates.

## Success criteria (FROZEN)

- CONFIRMED: pooled mean R difference (ALIGNED minus NOT) >= +0.25 R with
  permutation p <= 0.05, and the sign of the difference agrees in >= 4 of 6 pairs.
- REFUTED: difference < +0.10 R or p > 0.20 -> HTF state does not usefully
  filter LTF labels; the 15m weakness is intrinsic, not filterable.
- Otherwise: INCONCLUSIVE, recorded as such.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit.
