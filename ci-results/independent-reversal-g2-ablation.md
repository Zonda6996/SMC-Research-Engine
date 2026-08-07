# Independent Reversal G2 — ablation and falsification

Selected variant: **EXT_POOL_SEQ**
Verdict: **ABLATION_SUPPORTS_INTERACTION**

| Control | Variant | Mean net R | PF | Δ selected-control |
|---|---|---:|---:|---:|
| remove-sequence-gate | EXT_POOL | 0.0187 | 1.133 | 0.0374 |
| replace-extension-with-own1 | OWN1_POOL | 0.0388 | 1.396 | 0.0172 |
| remove-pool-context | EXT | 0.0112 | 1.086 | 0.0448 |
| matched-opportunity-null | MATCHED_NULL | -0.0330 | 0.798 | 0.0890 |
| legacy-g1-baseline | G1 | 0.0239 | 1.333 | 0.0321 |

Positive transfer cells: 4/6.
