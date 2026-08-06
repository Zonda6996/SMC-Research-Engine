# GGI Reverse Engineering - Full Findings Summary

**Branch:** `research/independent-reversal-edge` | **Date:** 2026-08-06
**Authors:** Nikita (simulator experiments, screenshots) + v0 (replay/stat engine)
**Note for Sol:** this is the master summary. Every claim below has a
script in `ci/research/` and results in `ci-results/` (file named in
brackets). Do NOT delete this branch - the telegram forward archive and
calibration constants here are not reproducible from scratch.

---

## 1. What GGI is (fully solved parts)

### 1.1 The raw signal = price EXTENSION from the mean, not a candle pattern
- Condition: close stretched from the Mean line to/через inner band on
  elevated volume (vol > ~1.3x avg20, dist from mean > ~2.5%).
- Recalls **73.3%** of vendor's real forward telegram arrows (relaxed
  variant: **89.3%**). Body-after-drought hypothesis recalls only 20%.
  [own2b-ablation.md]

### 1.2 Signal cadence = per-mode trade-state gate
- New signal CANNOT fire while that mode's trade is open (+ ~bars after).
- Proof A: extension + gate + BE machinery = **2.8 signals/month** vs
  vendor's observed 2-3. [own2b-ablation.md]
- Proof B (Nikita, DOGE 1h simulator): SELL appeared on RISK first, SAFE
  couple bars later, STANDARD not at all (std trade still open). Gates
  are PER MODE; signal engine is shared. [geo2-simulator-calibration.md]

### 1.3 Trade geometry - EXACT, measured off simulator price tags
- **stop = 2*add - entry** (mirror rule): measured 2.002 / 2.000 (safe),
  1.986 / 1.987 (risk) on LINK 2h + SOL 1h. Holds to 3 decimals.
- **step_safe / step_risk = 1.43** (constant; 1.431 and 1.430 on two
  independent assets).
- **Standard mode:** own step (safe/std = 1.17); stop = 1.75*step;
  STATIC TP = 2*step -> 1.145R without add, 2.005 RR with add. Matches
  Nikita's known "1.14R / always 1:2". No partial fix in standard.
- safe/risk: fix25 = dynamic Mean line, TP = dynamic opposite band,
  25% partial at mean, BE-related behavior after partial.
  [geo2-simulator-calibration.md]

### 1.4 Statistics semantics (proved live in simulator, DOGE 5m)
- A trade that took fix25 and THEN hit stop increments **Partial (win)**,
  not Stop. Stop row = clean stops only. Vendor WR = "reached first
  target at least", NOT profitability.
- Table only counts finalized trades (verified by rewinding simulator).
- Vendor's own standard tables display Total R: **DOGE 1h std = -23.3R**
  (WR 39.6%), LINK 2h std = +28.3R. Vendor-side proof that R economics
  swing wildly per series regardless of headline WR.

### 1.5 Vendor's own framing (chat quote)
He states outright: stops/takes are "just a variant", the value is
"context determination + positive EV", management is up to the user.
Consistent with everything above.

## 2. What remains OPEN

1. **Step sizing** - the ONE unknown in geometry. Not ATR14, not TR55,
   not %price, not a fixed fraction of our reconstructed zones (SOL add
   sits below our zone - our band reconstruction diverges per asset).
   Need 3-4 more entry/add samples (any assets, safe mode) to brute-force
   the formula.
2. **Arrow bar selection within an extension episode** - our gate picks
   the episode's first qualifying bar; vendor's arrow often lands on a
   later/deeper bar. Recall of the full pipeline is 10.9% on exact bars
   though the raw universe overlaps at 73-89%.
3. **BE display quirk** - current indicator build shows no BE exits
   on-chart; whether BE is still applied in safe/risk stats internally
   is unconfirmed (SPEC 16.45 says BE after partial for safe/risk).

## 3. Economics (the actual point)

- Vendor arrows + confirmed geometry shape, gross: **~ -0.16R/trade**
  (both modes) with our uncalibrated step. Even at his table's stop
  rates the structure is thin: frequent small partials vs rare -1R..-2R
  stops (depends on risk definition: if position is sized for the
  doubled add-filled stake, stop = -1R). [geo1-true-geometry-replay.md]
- OUR independent line stays the better bet: extension signal + zone
  context (sweep of non-top liquidity pool: +0.18R on 54 fwd trades,
  ZC5 SELECTIVE) + our own exits. [zc5-*, var1-*]

## 4. Data assets on this branch (do not lose)

- `ci-results/fwd1-telegram-forward-audit.json` - ~660 forward,
  non-repaintable vendor arrows with exact timestamps. Irreplaceable.
- `ci-results/geo2-simulator-calibration.md` - measured geometry
  constants from Nikita's simulator screenshots.
- `ci-results/own2b-ablation.*`, `geo1-*` - replay evidence chain.
- `data/gate-cache/` (untracked, local) - klines cache; rebuildable.

## 5. Next steps

1. Collect 3-4 more entry/add price pairs (safe) -> solve step formula.
2. Re-run GEO1 with calibrated step + risk-definition R (add-filled
   stop = -1R) -> true R of vendor arrows, final answer.
3. Wire calibrated geometry into OUR pipeline as one more exit preset;
   A/B vs VAR1 P25/S12 on FWD1.
4. Watch Nikita's live AAVE 5m open trade: which stat row increments
   (expect Partial) - final confirmation of 1.4.
