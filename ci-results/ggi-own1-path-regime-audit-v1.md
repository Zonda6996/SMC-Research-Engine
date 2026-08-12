# GGI / OWN1 path and regime audit v1

Coverage: **PARTIAL_INPUT_COVERAGE** (5/15 datasets).

The independent ETH/SOL/XRP/AAVE/BNB 1h/2h CSV files are absent, so this run is a reproducible partial-coverage diagnostic, not the promised full holdout.

Missing required inputs: `eth-2h`, `eth-1h`, `sol-2h`, `sol-1h`, `xrp-2h`, `xrp-1h`, `aave-2h`, `aave-1h`, `bnb-2h`, `bnb-1h`.

## Dataset/window economics and early path

| Dataset | Window | Family | Signals | Mean R | PF | Full:Stop | Primary null R | ΔR | 90% block CI ΔR | MFE 3b | ΔMFE 3b | MAE 3b | ΔMAE 3b | ±3 GGI |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| btc-2h | full | GGI | 91 | 0.1509 | 1.552 | 9.67 | 0.0223 | 0.1286 | [-0.0242, 0.2744] | 0.088 | 0.014 | -0.088 | -0.009 | 100.0% |
| btc-2h | full | OWN1 | 385 | 0.0403 | 1.133 | 8.56 | -0.0382 | 0.0785 | [0.0230, 0.1305] | 0.086 | 0.009 | -0.082 | -0.003 | 6.2% |
| btc-2h | first-half | GGI | 41 | 0.2309 | 2.012 | 14.50 | 0.0470 | 0.1840 | [-0.0119, 0.4124] | 0.085 | 0.009 | -0.098 | -0.024 | 100.0% |
| btc-2h | first-half | OWN1 | 193 | 0.0328 | 1.105 | 8.36 | -0.0713 | 0.1041 | [0.0435, 0.1728] | 0.099 | 0.025 | -0.076 | 0.006 | 7.3% |
| btc-2h | second-half | GGI | 50 | 0.0825 | 1.264 | 7.25 | -0.0075 | 0.0900 | [-0.1052, 0.2802] | 0.091 | 0.018 | -0.079 | 0.001 | 100.0% |
| btc-2h | second-half | OWN1 | 192 | 0.0483 | 1.164 | 8.77 | -0.0011 | 0.0493 | [-0.0273, 0.1255] | 0.073 | -0.002 | -0.087 | -0.012 | 5.2% |
| btc-15m | full | GGI | 85 | -0.0934 | 0.768 | 4.20 | -0.1048 | 0.0114 | [-0.1525, 0.1529] | 0.091 | 0.017 | -0.066 | 0.011 | 100.0% |
| btc-15m | full | OWN1 | 384 | -0.0841 | 0.775 | 5.46 | -0.0841 | 0.0000 | [-0.0694, 0.0639] | 0.080 | 0.003 | -0.072 | 0.005 | 6.3% |
| btc-15m | first-half | GGI | 36 | -0.1093 | 0.738 | 2.57 | -0.0863 | -0.0231 | [-0.2307, 0.1997] | 0.095 | 0.017 | -0.069 | 0.007 | 100.0% |
| btc-15m | first-half | OWN1 | 196 | -0.1230 | 0.687 | 4.17 | -0.1154 | -0.0076 | [-0.1175, 0.1011] | 0.079 | 0.002 | -0.077 | 0.000 | 5.1% |
| btc-15m | second-half | GGI | 49 | -0.0815 | 0.791 | 8.00 | -0.0536 | -0.0280 | [-0.2235, 0.1518] | 0.088 | 0.014 | -0.064 | 0.011 | 100.0% |
| btc-15m | second-half | OWN1 | 188 | -0.0424 | 0.880 | 7.85 | -0.0444 | 0.0020 | [-0.0642, 0.0717] | 0.080 | 0.006 | -0.067 | 0.009 | 7.4% |
| ondo-2h | full | GGI | 46 | 0.0228 | 1.066 | 6.50 | -0.0975 | 0.1203 | [-0.0492, 0.2589] | 0.084 | 0.009 | -0.090 | -0.010 | 100.0% |
| ondo-2h | full | OWN1 | 220 | -0.0565 | 0.839 | 8.21 | -0.0748 | 0.0182 | [-0.0472, 0.0802] | 0.072 | -0.002 | -0.081 | -0.003 | 6.8% |
| ondo-2h | first-half | GGI | 26 | 0.0394 | 1.118 | 7.50 | -0.0847 | 0.1242 | [-0.0589, 0.3147] | 0.081 | 0.006 | -0.081 | -0.009 | 100.0% |
| ondo-2h | first-half | OWN1 | 110 | -0.0492 | 0.858 | 8.71 | -0.0577 | 0.0085 | [-0.0633, 0.0918] | 0.072 | -0.003 | -0.084 | -0.006 | 6.4% |
| ondo-2h | second-half | GGI | 20 | 0.0012 | 1.003 | 5.50 | -0.1027 | 0.1039 | [-0.1606, 0.3062] | 0.087 | 0.008 | -0.101 | -0.016 | 100.0% |
| ondo-2h | second-half | OWN1 | 110 | -0.0646 | 0.818 | 7.71 | -0.1004 | 0.0358 | [-0.0493, 0.1196] | 0.071 | -0.005 | -0.078 | -0.002 | 7.3% |
| ondo-15m | full | GGI | 62 | 0.1363 | 1.509 | 13.00 | 0.0579 | 0.0783 | [-0.1096, 0.2540] | 0.090 | 0.013 | -0.064 | 0.013 | 100.0% |
| ondo-15m | full | OWN1 | 283 | 0.0502 | 1.174 | 15.64 | 0.0098 | 0.0403 | [-0.0255, 0.1118] | 0.076 | 0.001 | -0.077 | -0.001 | 6.4% |
| ondo-15m | first-half | GGI | 31 | 0.1200 | 1.414 | 19.00 | -0.0048 | 0.1249 | [-0.2102, 0.3575] | 0.083 | 0.002 | -0.069 | 0.002 | 100.0% |
| ondo-15m | first-half | OWN1 | 144 | 0.0407 | 1.134 | 12.57 | -0.0012 | 0.0418 | [-0.0805, 0.1316] | 0.078 | 0.002 | -0.076 | 0.002 | 7.6% |
| ondo-15m | second-half | GGI | 31 | 0.1536 | 1.631 | 10.00 | 0.1010 | 0.0527 | [-0.1191, 0.2568] | 0.097 | 0.017 | -0.058 | 0.015 | 100.0% |
| ondo-15m | second-half | OWN1 | 139 | 0.0607 | 1.224 | 21.00 | 0.0225 | 0.0382 | [-0.0237, 0.1192] | 0.074 | 0.000 | -0.079 | -0.004 | 5.0% |
| xrp-3m | full | GGI | 63 | 0.0193 | 1.057 | 7.00 | -0.0699 | 0.0893 | [-0.2815, 0.2105] | 0.098 | 0.020 | -0.069 | 0.013 | 100.0% |
| xrp-3m | full | OWN1 | 418 | -0.0352 | 0.897 | 7.73 | -0.0568 | 0.0216 | [-0.0206, 0.0678] | 0.085 | 0.006 | -0.083 | -0.003 | 4.8% |
| xrp-3m | first-half | GGI | 20 | -0.0356 | 0.907 | 10.00 | -0.1152 | 0.0796 | [-0.9799, 0.2951] | 0.095 | 0.015 | -0.077 | -0.001 | 100.0% |
| xrp-3m | first-half | OWN1 | 211 | -0.0673 | 0.814 | 7.06 | -0.0758 | 0.0085 | [-0.0508, 0.0676] | 0.079 | 0.001 | -0.085 | -0.006 | 3.8% |
| xrp-3m | second-half | GGI | 43 | 0.0455 | 1.144 | 6.25 | -0.0048 | 0.0503 | [-0.1499, 0.2332] | 0.100 | 0.022 | -0.065 | 0.019 | 100.0% |
| xrp-3m | second-half | OWN1 | 207 | -0.0020 | 0.994 | 8.50 | -0.0417 | 0.0397 | [-0.0177, 0.0882] | 0.090 | 0.010 | -0.081 | -0.001 | 5.8% |

## Decision rules

- Full:Stop is descriptive only; positive mean R, PF > 1 and a positive real-minus-null effect are the economic gates.
- MFE/MAE are post-entry path outcomes, not causal input features.
- Exact/±1/±3 arrow proximity is diagnostic and is never the promotion target.
- A positive broad or regime-matched null means DM3 mechanics or market regime can explain the apparent edge.
- This run cannot settle cross-asset holdout transfer until the ten missing 1h/2h exports are restored.

## Next detector decision

Do not retune OWN1. The next generation should be a separately preregistered state detector: persistent signal-side Mean episode, weakening continuation, directional reversal candle, then a causal failed-continuation/confirmation condition. Selection must use OOS mean R/PF/cost robustness and matched-null advantage; GGI proximity remains secondary.

