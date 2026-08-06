# FWD1 - forward audit of vendor Telegram signals (non-repaintable)

Signals parsed: 1775; pairs with market data: 132; failed pairs: 1000FLOKIUSDT_120, ETHUSDT_3, BTCUSDT_5, ETHUSDT_5, BNBUSDT_5, BNBUSDT_1, BNBUSDT_3, BTCUSDT_3, VIRTUALUSDT_5, ARBUSDT_3, INJUSDT_3, VIRTUALUSDT_3
Bands are the recovered approximation (mean ALMA(hlc3,200,0.85,6); width ALMA(TR/close,122,0.625,3.5), k=5.6/9.6).
base = P25/S12 (GGI-style DM3 V2); winner = P25/S10+ADD (VAR1 split-entry).

| slice | machinery | n | mean R | WR | P/S/F | F:S | end/skip |
|---|---|---|---|---|---|---|---|
| ALL ALL | base | 736 | 0.0141 | 88.2% | 224/87/425 | 4.9 | 138/3 |
| ALL ALL | winner | 747 | 0.0026 | 85.5% | 247/108/392 | 3.6 | 127/3 |
| hourly ALL | base | 629 | 0.0006 | 87.3% | 192/80/357 | 4.5 | 122/3 |
| hourly ALL | winner | 639 | -0.0040 | 84.4% | 204/100/335 | 3.4 | 112/3 |
| hourly tf120 | base | 162 | 0.0310 | 85.8% | 43/23/96 | 4.2 | 73/3 |
| hourly tf120 | winner | 165 | 0.0187 | 83.6% | 45/27/93 | 3.4 | 70/3 |
| hourly tf240 | base | 59 | -0.0794 | 83.1% | 18/10/31 | 3.1 | 8/0 |
| hourly tf240 | winner | 61 | -0.1210 | 77.0% | 18/14/29 | 2.1 | 6/0 |
| hourly tf60 | base | 408 | 0.0002 | 88.5% | 131/47/230 | 4.9 | 41/0 |
| hourly tf60 | winner | 413 | 0.0043 | 85.7% | 141/59/213 | 3.6 | 36/0 |
| scalp ALL | base | 107 | 0.0935 | 93.5% | 32/7/68 | 9.7 | 16/0 |
| scalp ALL | winner | 108 | 0.0417 | 92.6% | 43/8/57 | 7.1 | 15/0 |
| scalp tf15 | base | 102 | 0.0997 | 94.1% | 31/6/65 | 10.8 | 12/0 |
| scalp tf15 | winner | 102 | 0.0483 | 93.1% | 41/7/54 | 7.7 | 12/0 |
| scalp tf30 | base | 1 | -0.6925 | 100.0% | 1/0/0 | inf | 0/0 |
| scalp tf30 | winner | 1 | -0.7873 | 100.0% | 1/0/0 | inf | 0/0 |
| scalp tf60 | base | 4 | 0.1329 | 75.0% | 0/1/3 | 3.0 | 4/0 |
| scalp tf60 | winner | 5 | 0.0744 | 80.0% | 1/1/3 | 3.0 | 3/0 |
## Interpretation notes (appended once, post-run)

1. FIRST NON-REPAINTABLE TEST of the vendor's signals in this research line.
   1775 signals parsed from his own Telegram broadcasts; 736 evaluated
   (rest: End mark = still open / warmup / no market data for 1m/3m/5m
   majors where Gate 1m history fetch failed).
2. HOURLY CHANNEL (60/120/240): mean +0.0006R on base machinery - ZERO.
   tf240 is negative (-0.08R). tf120 mildly positive (+0.03R). This
   CONFIRMS the time-decay finding from OWN1: on forward, non-repaintable
   data the flagship hourly signals earn nothing gross, before fees.
3. SCALP CHANNEL (mostly 15m alts): +0.094R, WR 93.5%, F:S 9.7 (n=107).
   The only clearly positive slice. Selection caveat: the vendor CHOOSES
   which assets get scalp broadcasts - this is his asset-picking layer on
   top of the indicator, which an indicator subscriber doesn't replicate.
4. VAR1 "winner" P25/S10+ADD is WORSE than base P25/S12 on EVERY forward
   slice (+0.003 vs +0.014 pooled). The VAR1 overfit warning was correct:
   the add-on advantage did not survive out of sample. Base machinery
   stands as the reference; VAR1 winner is dead.
5. Caveats: Gate.io prices (Bybit geo-blocked), approximated bands
   (mean/width ALMA fit), TP wick fills. Aggregates meaningful, single
   trades not. Fees NOT included; at 15m TP distances, taker round-trip
   would consume a large share of +0.09R.
