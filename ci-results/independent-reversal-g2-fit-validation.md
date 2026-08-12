# Independent Reversal G2 — frozen fit/transfer verdict

Protocol: `independent-reversal-g2-protocol-1.0-preregistered`
Protocol hash: `da1696b7f09ee068e79ddb7987f0309a5b1d99c451a728b7d61dcd0b38f63ba0`
Development-selected variant: **EXT_POOL_SEQ**
Verdict: **PROMISING_NOT_PROVEN**

## Development aggregate

| Variant | Trades | Mean net R | PF | Best 1% removed | 95% block CI | Portfolio DD |
|---|---:|---:|---:|---:|---:|---:|
| EXT | 3389 | 0.0311 | 1.248 | 0.0197 | [-0.0473, 0.1118] | 10.68% |
| EXT_POOL | 649 | 0.0544 | 1.426 | 0.0431 | [-0.0225, 0.1346] | 7.00% |
| OWN1_POOL | 254 | 0.0398 | 1.373 | 0.0286 | [-0.0372, 0.1069] | 5.35% |
| EXT_POOL_SEQ | 38 | 0.0888 | 1.722 | 0.0668 | [-0.0999, 0.2815] | 2.95% |
| G1 | 866 | 0.0289 | 1.389 | 0.0201 | [-0.0239, 0.0771] | 13.07% |
| MATCHED_NULL | 635 | 0.0358 | 1.297 | 0.0233 | [-0.0455, 0.1161] | 7.95% |

## Frozen transfer aggregate

| Variant | Trades | Mean net R | PF | Best 1% removed | 95% block CI | Portfolio DD |
|---|---:|---:|---:|---:|---:|---:|
| EXT | 4057 | 0.0112 | 1.086 | -0.0004 | [-0.0378, 0.0614] | 11.06% |
| EXT_POOL | 839 | 0.0187 | 1.133 | 0.0075 | [-0.0460, 0.0865] | 7.73% |
| OWN1_POOL | 339 | 0.0388 | 1.396 | 0.0268 | [-0.0253, 0.1003] | 5.73% |
| EXT_POOL_SEQ | 60 | 0.0560 | 1.578 | 0.0423 | [-0.0693, 0.1761] | 3.20% |
| G1 | 908 | 0.0239 | 1.333 | 0.0141 | [-0.0163, 0.0591] | 8.67% |
| MATCHED_NULL | 801 | -0.0330 | 0.798 | -0.0459 | [-0.0971, 0.0333] | 16.97% |

## Interpretation

- Winner selection used development symbols only; transfer results did not change the selected variant.
- All returns include 6 bps one-way cost under the common corrected replay. Dashboard WR is not a promotion metric.
- Final machine verdict: **PROMISING_NOT_PROVEN**.
