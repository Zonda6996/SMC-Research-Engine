# IMP3 - LTF/HTF signal TFs (15m/30m/4h), RELAXED pre-registered filter

Universe: 28 symbols. Costs 0.07%/side. Bar: mean R > +0.05 NET both halves.

## TF 15m

- ALL: train n=555 meanR=-0.0675 | hold n=236 meanR=0.0153
- RELAXED: train n=22 meanR=-0.1448 | hold n=10 meanR=0.2591 

RELAXED cells (n>=3): AAVEUSDT n=3 meanR=0.013 | JUPUSDT n=3 meanR=0.385 | WLDUSDT n=3 meanR=-0.686

## TF 30m

- ALL: train n=385 meanR=-0.1310 | hold n=175 meanR=0.0414
- RELAXED: train n=27 meanR=-0.1691 | hold n=9 meanR=0.0543 

RELAXED cells (n>=3): GRASSUSDT n=3 meanR=-0.156 | JUPUSDT n=3 meanR=-0.273 | POLUSDT n=3 meanR=0.211 | ZECUSDT n=3 meanR=-0.389

## TF 240m

- ALL: train n=84 meanR=-0.0224 | hold n=45 meanR=-0.1271
- RELAXED: train n=5 meanR=0.1204 | hold n=3 meanR=0.1316 **PASS**

## Verdict (appended post-run)

1. 15m/30m: RELAXED filter FAILS train decisively (-0.14 / -0.17 net)
   despite positive holdout - same regime pattern as IMP1. On LTF the
   costs (0.07%/side) eat a far bigger share of the ATR-sized step,
   and sweep-context resolves poorly at 15m noise. The edge does NOT
   transfer down.
2. 4h: formal PASS (+0.12 train / +0.13 hold) but n=5+3 - anecdote,
   not evidence. Matches Nikita's prior ("4h так себе") in frequency:
   ~1 trade per 4 months. Not actionable alone; MAY be additive to
   the 1h/2h book later.
3. CONCLUSION: the edge lives where we found it - 1h/2h signals with
   4h zone context (IMP2: +0.18/+0.26 net). LTF replication of the
   vendor's WR tables was already shown possible (GEO5), but WR is
   not money; net R on LTF is negative for selection too.
4. Next: consolidate 1h/2h RELAXED as the single candidate strategy;
   walk-forward by month + paper-trade harness (alert generator) on
   the live-relevant symbol set.
