# Stateful Apex Track S3 v2 — internal holdout reveal

- Verdict: **KILL**
- Integrity: **PASS** (frozen config, assignment, code, and upstream artifact hashes verified before reveal).
- Internal holdout reveal count: **1**.
- S1 untouched OOS reveal count: **0** (no raw file read, parse, detection, or label).
- Vendor Shapes: discarded before detection and unused.
- Frozen rule: `admit = (newAdverseExtremes <= 1)`; no post-reveal threshold or subgroup.

## Holdout metrics (5 bps/side)

| arm | detected N | admitted N | resolved N | meanR | CI95 | PF | WR | maxDD R |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| unfiltered v1 | 270 | 270 | 259 | -0.0903 | [-0.2497, 0.0587] | 0.8402 | 0.4479 | 39.1777 |
| frozen v2 | 270 | 187 | 184 | 0.0023 | [-0.1505, 0.1371] | 1.0047 | 0.5272 | 22.8585 |

Paired delta meanR (v2-v1): **0.0926**, CI95 [-0.0206, 0.2060].

Breadth: 1/2 positive symbols (50.0%); 1/2 positive series.

## Frozen success gate

- v2 meanR > 0: **PASS**
- v2 CI95 low > 0: **FAIL**
- >=60% positive symbols: **FAIL**
- >=2 positive series: **FAIL**
- improvement over unfiltered v1: **PASS**

Final frozen decision: **KILL**.
