# Reversal H0-H5 reconstruction score v0.1

- Exact positive observations only; outcome excluded from all features and scoring.
- Feed: Binance Spot archive.
- Tolerance is reported explicitly because TradingView labels may be intrabar and screenshot timestamp transcription may differ by one bar.
- This is recall-only until exact matched no-signal bars are available; it cannot select a production detector by itself.
- Production defaults changed: **NO**.

| Hypothesis | Mode | Tolerance | n | Hits | Recall |
|---|---|---:|---:|---:|---:|
| H0 | safe | 0 bars | 10 | 0 | 0.0% |
| H0 | safe | 1 bars | 10 | 0 | 0.0% |
| H0 | safe | 2 bars | 10 | 0 | 0.0% |
| H0 | safe | 4 bars | 10 | 0 | 0.0% |
| H0 | risk | 0 bars | 1 | 0 | 0.0% |
| H0 | risk | 1 bars | 1 | 0 | 0.0% |
| H0 | risk | 2 bars | 1 | 0 | 0.0% |
| H0 | risk | 4 bars | 1 | 0 | 0.0% |
| H1 | safe | 0 bars | 10 | 0 | 0.0% |
| H1 | safe | 1 bars | 10 | 0 | 0.0% |
| H1 | safe | 2 bars | 10 | 0 | 0.0% |
| H1 | safe | 4 bars | 10 | 0 | 0.0% |
| H1 | risk | 0 bars | 1 | 0 | 0.0% |
| H1 | risk | 1 bars | 1 | 0 | 0.0% |
| H1 | risk | 2 bars | 1 | 0 | 0.0% |
| H1 | risk | 4 bars | 1 | 0 | 0.0% |
| H3 | safe | 0 bars | 10 | 0 | 0.0% |
| H3 | safe | 1 bars | 10 | 0 | 0.0% |
| H3 | safe | 2 bars | 10 | 0 | 0.0% |
| H3 | safe | 4 bars | 10 | 0 | 0.0% |
| H3 | risk | 0 bars | 1 | 0 | 0.0% |
| H3 | risk | 1 bars | 1 | 0 | 0.0% |
| H3 | risk | 2 bars | 1 | 0 | 0.0% |
| H3 | risk | 4 bars | 1 | 0 | 0.0% |
| H4 | safe | 0 bars | 10 | 0 | 0.0% |
| H4 | safe | 1 bars | 10 | 0 | 0.0% |
| H4 | safe | 2 bars | 10 | 0 | 0.0% |
| H4 | safe | 4 bars | 10 | 0 | 0.0% |
| H4 | risk | 0 bars | 1 | 0 | 0.0% |
| H4 | risk | 1 bars | 1 | 0 | 0.0% |
| H4 | risk | 2 bars | 1 | 0 | 0.0% |
| H4 | risk | 4 bars | 1 | 0 | 0.0% |
| H5 | safe | 0 bars | 10 | 0 | 0.0% |
| H5 | safe | 1 bars | 10 | 0 | 0.0% |
| H5 | safe | 2 bars | 10 | 0 | 0.0% |
| H5 | safe | 4 bars | 10 | 0 | 0.0% |
| H5 | risk | 0 bars | 1 | 0 | 0.0% |
| H5 | risk | 1 bars | 1 | 0 | 0.0% |
| H5 | risk | 2 bars | 1 | 0 | 0.0% |
| H5 | risk | 4 bars | 1 | 0 | 0.0% |

## Hard limitation

There are no exact timestamped matched-negative bars yet. Therefore precision and false-positive rate are undefined. The wide SOL 20–21 July window is useful, but it must be converted into exact candidate bars before comparing hypotheses fairly. Until then, H0 remains the production baseline and every H1/H3/H4/H5 score is research-only.
