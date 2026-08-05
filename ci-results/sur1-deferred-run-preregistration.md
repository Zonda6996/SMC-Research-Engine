# Pre-registration: SUR1 deferred decisive run (volume re-exports received)

Committed BEFORE running. Nikita re-exported BTC.P 2h (20,130 bars, 91 arrows)
and XRP 3m (21,337 bars, 63 arrows) WITH the Volume column, as requested in
SUR1 amendment 1. This is the run the original SUR1 pre-registration actually
specified: calibration where the arrows EARN (BTC 2h, +0.154R reference).

## Frozen setup (ZERO changes from the original pre-registration)

- Same 9 rules (3 stretch x 3 volume-k), cooldown 40/side, warm-up 100.
- Same DM3 V2 exit machinery, same random benchmark (200 draws, seed 1337),
  same capture metric C, same frequency sanity gate (0.4x..3x arrow count).
- CALIBRATION: BYBIT_BTCUSDT.P_2h_full20k_vol.csv (91 arrows).
- OOS (winner only): BINANCE_XRPUSDT_3m_vol.csv, BYBIT_ONDOUSDT.P_2h.csv,
  BYBIT_ONDOUSDT.P_15m.csv (the two ONDO sets already ran for the void-era
  winner; they re-run here for THIS winner per the original multi-dataset
  OOS design).
- Same thresholds: SUCCESS calib C >= 0.6 AND pooled OOS C >= 0.5;
  PARTIAL pooled OOS 0.2..0.5; FAILURE otherwise.
- Additional pre-declared sanity check (records only, not a criterion):
  arrows on BTC 2h vol re-export must reproduce ~+0.154R (DM3 V2); if they
  do not, the export differs and the run is VOID, not FAILURE.

## Verdict finality

This run is FINAL for SUR1: whatever the verdict, no new rules, thresholds,
or datasets will be added under the SUR1 name. A FAILURE closes the surrogate
direction; SUCCESS/PARTIAL opens SUR2 for refinement.
