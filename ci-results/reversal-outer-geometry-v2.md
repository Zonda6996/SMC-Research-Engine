# Reversal Outer geometry analysis

Outer lines are now available in the two extended BTC exports. This report measures whether exact labels require current/previous outer penetration in addition to inner episode context.

## btc-perp-15m

| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 69 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.07 | 297.0 |
| long | 38 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.12 | 297.0 |
| short | 31 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 1.87 | 282.0 |

## btc-perp-1h

| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 44 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 1.85 | 417.0 |
| long | 27 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 1.85 | 336.0 |
| short | 17 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 1.92 | 467.0 |

## eth-perp-15m

| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 47 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.05 | 297.0 |
| long | 29 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.08 | 293.0 |
| short | 18 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.01 | 389.0 |

## sol-spot-15m

| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 37 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.07 | 427.0 |
| long | 21 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.07 | 279.0 |
| short | 16 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 1.93 | 559.0 |

## btc-perp-5m

| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 81 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.07 | 328.0 |
| long | 44 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.00 | 332.0 |
| short | 37 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.15 | 319.0 |

## btc-perp-4h

| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 38 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.02 | 363.0 |
| long | 18 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 1.56 | 338.0 |
| short | 20 | 0.0% | 0.0% | 0.00 | 0.00 | 0.00 | 2.29 | 376.0 |

## Caveat

These are label-bar fingerprints, not a detector. The next search must compare these states against matched no-label episodes and retain chronological one-shot semantics.
