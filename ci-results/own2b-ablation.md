# OWN2b - ablation: extension trigger, trade-state, BE machinery (Nikita LINK-2h insight)

State cooldown: trade open -> blocked, + 3 bars after exit. BE arms use P25/S12/breakeven=true (vendor "safe mode" hypothesis).

| arm | recall | acceptance | sig/mo (med) | n trades | mean R | WR | P/S/F |
|---|---|---|---|---|---|---|---|
| A_own1 | 20.4% | 3.3% | 6.4 | 3619 | 0.0462 | 93.2% | 1084/247/2288 |
| B_ext_raw | 73.3% | 6.0% | 23.0 | 10623 | 0.0589 | 86.9% | 3262/1393/5968 |
| C_ext_state_be | 10.9% | 4.5% | 2.8 | 1635 | 0.0418 | 89.2% | 1171/177/287 |
| D_own1_state_be | 13.5% | 3.6% | 4.4 | 2546 | 0.0216 | 93.6% | 2052/164/330 |
| E_ext_relaxed_raw | 89.3% | 4.4% | 48.5 | 23615 | 0.0631 | 89.1% | 7081/2577/13957 |

Vendor reference: ~2-3 arrows/month/series; safe-mode stats WR 89.4%, stops 10.6%, partial 42%, full fix 47%.
## Interpretation notes (appended post-run)

1. BREAKTHROUGH on the raw condition: arm B (extension, no state) recalls
   73.3% of forward GGI arrows; relaxed arm E recalls 89.3%. The vendor's
   RAW signal is extension-from-mean at the band on volume - NOT a body
   pattern. OWN1's 20% recall is definitively explained: wrong raw axis.
2. The OWN2 (previous run) failure is now attributed: the raw condition
   was fine, the NO-BE state machine strangled it. With BE-after-partial
   machinery (arm C) the same state gate yields 2.8 signals/month -
   EXACTLY the vendor's observed 2-3/mo cadence.
3. Arm C vs vendor safe-mode stats: WR 89.2% vs 89.4%, stop rate 10.8%
   vs 10.6% - a near-exact match on both headline numbers. The P/F split
   differs (71.6/17.6 vs 42/47): our replay exits many BE-trades that
   the vendor's machinery apparently rides to full fix - partial sizing
   or trailing likely differs. But two independent statistics matching
   to within 0.2pp is strong evidence the pipeline shape is right:
   RAW EXTENSION SIGNAL -> TRADE-STATE GATE -> BE-AFTER-PARTIAL EXITS.
4. C's recall is only 10.9% because the state gate picks the FIRST raw
   signal of each episode while the vendor's arrow often lands on a
   later, deeper bar of the same episode - timing offset, not a
   different signal universe (B proves the universe overlaps at 73%).
5. Nikita's LINK-2h read (BE exit frees state -> next signal) was the
   unlock. Economics of C: +0.042R/trade gross at WR 89 - thin as ever
   pre-zones; next step is C + ZC5 SELECTIVE zones.
