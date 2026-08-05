# Pre-registration: LTF1 - BE semantics resolved by 15m paths inside 2h trades

Branch: research/independent-reversal-edge. Committed BEFORE any computation.
Approved by Nikita (primary hypothesis from the discovery-prompt session).

## Question

The corrected v2 2h expectancy is carried as an INTERVAL between BE bounds
(optimistic-initial-stop <-> next-bar-entry-be) because 2h OHLC cannot see the
intra-bar order of Mean-touch / entry-touch / stop-touch. Same-feed 15m exports
(BTC.P, ONDO.P) cover the tail of the 2h window (~8 x 15m bars per 2h bar).
Hypothesis: replaying each 2h trade with 15m sub-bar ordering (1) collapses the
BE-bounds spread and (2) discriminates BE-by-wick vs BE-by-confirmed-close.

## Data (FROZEN)

- data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h.csv + _15m.csv
- data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv + _15m.csv
  (copied from research/fng-case-control; same vendor export format the v2
  audit parsed; sha256 recorded in the run JSON)
- Only trades whose FULL path (entry 2h bar .. exit 2h bar) lies inside the
  15m overlap window are analyzed. Mandatory alignment gate: every analyzed 2h
  bar must map to >= 6 15m bars with timestamps in [t, t+2h) and matching
  OHLC envelope within tolerance (15m composite high <= 2h high + 0.05%, etc.);
  datasets failing alignment on > 2% of bars abort the run.

## Frozen trade machinery (inherited from corrected v2, NO changes)

Signals = Shapes on the 2h leg after 100-bar warm-up; entry next 2h open;
Safe stop = 12 x TR55(2h), stop-first; Partial = 25% at moving 2h Mean wick;
Full = 2h close beyond moving opposite Inner (end-of-bar event); no add;
maxHoldingBars 20,000; grossR normalized by planned stop risk.

## What varies (FROZEN family - 4 BE semantics, LTF-resolved)

After Partial, the stop becomes:
- B0 none: initial stop unchanged (v2 optimistic bound).
- B1 wick-avg: average price (= entry, no-add), triggered by 15m WICK touch,
  active from the NEXT 15m sub-bar after the Partial sub-bar.
- B2 wick-entry: entry price, 15m wick touch, same activation. (B1 == B2 under
  no-add; both reported to prove the identity holds in code.)
- B3 close-entry: entry price, triggered only by a CONFIRMED 15m CLOSE beyond
  the level against the trade; exit at that 15m close price.
Within every 15m sub-bar the conservative adverse-first rule still applies
(residual 15m ambiguity recorded, not resolved).

## Metrics (FROZEN; per dataset and pooled)

1. OHLC-2h bounds on the SAME trade subset: mean grossR under the three v2
   beBounds -> spread width W_ohlc = max - min.
2. LTF-resolved mean grossR for B0..B3 -> W_ltf = max - min across semantics.
3. Per-variant outcome tables: n, WR (grossR > 0), Stop / Partial / Full / End
   counts, mean & median grossR (user requested explicit WR/stop stats).
4. Class-change rate: % of trades whose terminal outcome under LTF-B1 differs
   from OHLC next-bar-entry-be, and under LTF-B0 vs OHLC optimistic.
5. Ambiguity rate: % of trades containing >= 1 2h bar where OHLC alone admits
   competing event orders (both adverse-stop wick and favourable Partial/BE
   wick inside the bar, pre-resolution).

## Success / kill criteria (FROZEN)

- KILL: ambiguity rate < 15% of trades -> LTF resolves nothing material;
  record and stop.
- IDENTIFIED: W_ltf <= 0.5 * W_ohlc (spread collapses by >= 50%) -> report the
  LTF point estimates as the new 2h expectancy reference.
- NOT IDENTIFIABLE: spread persists (> 0.5 * W_ohlc) -> BE semantics need
  sub-15m data; formal export request for BTC.P 1m/3m same-window.

## Negative control (FROZEN)

Pseudo-signals at real-signal 2h index + 37 (same side), skipped if they fall
on a real label, invalid band, or outside the overlap window. Same pipeline.
Expectation if machinery is honest: LTF resolution shifts pseudo-trade classes
in BOTH directions without systematically improving any BE variant's mean R;
if a variant "improves" pseudo-trades like real ones, the improvement is an
artifact of the resolution mechanics, not signal structure.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit. Single run; results
committed as-is.
