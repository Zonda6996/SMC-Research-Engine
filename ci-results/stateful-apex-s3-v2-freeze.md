# Stateful Apex Track S3 v2 — frozen protocol (not evaluated)

- Status: **FROZEN_NOT_EVALUATED**.
- Exactly one rule; one feature; one threshold; no PnL grid.
- Vendor Shapes forbidden. State machine, labels, costs (5 bps/side), and `src/core` unchanged.
- Original S1 untouched OOS remains sealed with reveal count **0**.

## Frozen rule: extension exhaustion

`admit = (newAdverseExtremes <= 1)`

`newAdverseExtremes` is the causal count of renewed adverse price extremes between the first inner-band extension and the already-frozen reversal confirmation. A small count means the expansion stopped renewing itself: economic exhaustion of expansion. No proxy-risk geometry or trigger-progress feature is mixed in.

## Threshold source

The threshold is the deterministic empirical median (q=0.5, linear interpolation) over all 2770 development events: **1**.

Development-only input: 15 files / 370745 rows / 2770 events. Rule-admitted development count: 1961. Labels, outcomes, and PnL were not inputs to the cut; no threshold grid was searched.

## New internal holdout

Whole-symbol assignment: `sha256("apex-state-s3-v2-internal-holdout:" + symbol) mod 4 == 1`.

Sealed symbols: **ONDOUSDT, VIRTUALUSDT**. Manifest-only inventory: 2 series / 37455 rows / 270 events. Raw files read: **0**; labels/outcomes/metrics computed: **0**.

Split assignment SHA-256: `aa169cbccd97cfb8754eb25773b0058ff65cfc9bda81b2e6520131ecfd542a6a`. Exact assignments and data hashes are in the JSON manifest.

## Preregistered next-stage decision

SUCCESS requires all of:
1. holdout v2 net meanR > 0;
2. holdout v2 cluster-bootstrap CI95 low > 0;
3. >=60% positive holdout symbols;
4. >=2 positive holdout series;
5. v2 net meanR improves versus unfiltered v1 on the identical holdout.

Otherwise **KILL**. No holdout evaluation was performed in this stage.

## Hashes / seals

- Config SHA-256: `92ff4fe9de8299039de493a03f947efd096024c85b60031a7933cf91696aca98`
- State machine SHA-256: `5f82d45de35ede30e08599372e5cabd46bb04402ddc47de488fad1bfecb449c8`
- Freeze runner SHA-256: `805a5f5fbf09a2ef5f309264173e58e1ba6128fa65b816f3224472b113014437`
- Internal holdout: **SEALED**; S1 untouched OOS: **SEALED, reveal=0**.
