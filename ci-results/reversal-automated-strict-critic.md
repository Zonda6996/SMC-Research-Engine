# Automated strict critic — Reversal searches

## reversal-state-machine-search-v1.json: FAIL

- eth-perp-15m precision 6.06% < 15%
- eth-perp-15m recall 21.28% < 40%
- eth-perp-15m count ratio 3.51 outside 0.5-2
- btc-perp-5m precision 6.25% < 15%
- btc-perp-5m recall 22.22% < 40%
- btc-perp-5m count ratio 3.56 outside 0.5-2
- btc-perp-4h precision 2.41% < 15%
- btc-perp-4h recall 5.26% < 40%
- btc-perp-4h count ratio 2.18 outside 0.5-2

## reversal-episode-search-v2.json: FAIL

- sealed collapse 12.77% -> 3.70%
- sealed recall below 20%: 4.76%
- eth-perp-15m precision 8.24% < 15%
- eth-perp-15m recall 14.89% < 40%
- btc-perp-5m precision 6.79% < 15%
- btc-perp-5m recall 13.58% < 40%
- btc-perp-4h precision 5.17% < 15%
- btc-perp-4h recall 7.89% < 40%

## reversal-recovery-search-v3.json: FAIL

- sealed collapse 16.39% -> 5.48%
- sealed recall below 20%: 6.25%
- eth-perp-15m precision 7.29% < 15%
- eth-perp-15m recall 9.33% < 40%
- btc-perp-5m precision 4.76% < 15%
- btc-perp-5m recall 7.41% < 40%
- btc-perp-4h precision 6.67% < 15%
- btc-perp-4h recall 7.89% < 40%

## reversal-cooldown-search-v4.json: FAIL

- sealed collapse 21.92% -> 7.69%
- sealed recall below 20%: 9.38%
- eth-perp-15m precision 11.30% < 15%
- eth-perp-15m recall 17.33% < 40%
- btc-perp-5m precision 11.33% < 15%
- btc-perp-5m recall 20.99% < 40%
- btc-perp-4h precision 5.66% < 15%
- btc-perp-4h recall 7.89% < 40%

## reversal-fear-greed-search-v5.json: FAIL

- sealed collapse 10.64% -> 5.88%
- sealed recall below 20%: 9.38%
- eth-perp-15m precision 6.35% < 15%
- eth-perp-15m recall 16.00% < 40%
- eth-perp-15m count ratio 2.52 outside 0.5-2
- btc-perp-5m precision 2.63% < 15%
- btc-perp-5m recall 7.41% < 40%
- btc-perp-5m count ratio 2.81 outside 0.5-2
- btc-perp-4h precision 4.40% < 15%
- btc-perp-4h recall 10.53% < 40%
- btc-perp-4h count ratio 2.39 outside 0.5-2

## reversal-volume-fear-greed-search-v6.json: FAIL

- sealed collapse 7.14% -> 0.00%
- sealed recall below 20%: 0.00%
- eth-perp-15m precision 8.33% < 15%
- eth-perp-15m recall 8.00% < 40%
- btc-perp-5m precision 5.00% < 15%
- btc-perp-5m recall 4.94% < 40%
- btc-perp-4h precision 4.17% < 15%
- btc-perp-4h recall 2.63% < 40%
