# Pre-registration: DM2 - BTC.P 2h FULL-WINDOW dashboard match (20k bars)

Branch: research/independent-reversal-edge. Committed BEFORE running.
Supersedes DM1's window caveat: Nikita exported the full 20,130-bar 2h history
(2022-01-01 .. 2026-08-05) matching his premium dashboard depth. The file
contains 51 BUY / 40 SELL Shape marks vs dashboard 50L/40S closed trades -
count parity to within one still-open/warm-up long.

New vendor facts from Nikita (recorded): (a) he believes there is NO BE in the
current indicator version (there was one in an older version); (b) after a
Partial, the ADD order does NOT trigger even if price returns below entry -
consistent with our frozen no-add engine; (c) on M3 XRP he observed a partial
whose fix25 line stayed on chart - cosmetic, not counted here.

## Data (FROZEN)

data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k.csv
(sha256 recorded in run JSON). Dashboard ground truth (same screenshot as DM1):
LONG 50: Partial 16 / Stop 7 / Full 27; SHORT 40: Partial 13 / Stop 3 / Full 24.

## Machinery, semantics, metric (FROZEN - identical to DM1)

Corrected v2 engine, 12xTR55 stop-first, Partial 25% at Mean wick, Full = close
beyond opposite Inner, no add, 100-bar warm-up, allowInvalidBandOrder; three BE
semantics (optimistic-initial-stop / next-bar-blended-be / next-bar-entry-be);
End-mark trades excluded from closed buckets; same D distance and MATCHED /
PARTIAL MATCH / NO MATCH thresholds as DM1.

## Frozen prediction

From DM1 shares and Nikita's no-BE report: optimistic-initial-stop (no BE)
MATCHES (D <= 6, all buckets within +-6, >= 2x separation). If instead
entry-BE matches, Nikita's recollection is wrong and DM1's subset misled us.

## Gate

npm test; npx tsc --noEmit; single run, committed as-is.
