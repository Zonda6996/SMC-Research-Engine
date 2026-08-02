"""
Batch-2 vendor export ingestion (2026-08). Validates the 8 new TradingView CSVs,
normalizes timestamps to UTC, detects warm-up band anomalies at history start,
computes SHA-256 of raw files, counts labels, and writes manifest-batch2.json.

Discipline: these datasets are hypothesis-UNSEEN for everything derived from the
F&G/volume line of research. NO feature, AUC, or detector computation happens here -
only structural validation and inventory. The original manifest.json is untouched.
"""
import csv
import hashlib
import json
import os
from datetime import datetime, timezone

DIR = "data/vendor-exports/incoming-2026-08"

DATASETS = [
    {"id": "btc-perp-15m-b2", "file": "BYBIT_BTCUSDT.P_15m.csv", "exchange": "Bybit", "symbol": "BTCUSDT.P", "market": "futures", "timeframe": "15m", "tf_ms": 900_000},
    {"id": "btc-perp-1h-b2", "file": "BYBIT_BTCUSDT.P_1h.csv", "exchange": "Bybit", "symbol": "BTCUSDT.P", "market": "futures", "timeframe": "1h", "tf_ms": 3_600_000},
    {"id": "btc-perp-2h-b2", "file": "BYBIT_BTCUSDT.P_2h.csv", "exchange": "Bybit", "symbol": "BTCUSDT.P", "market": "futures", "timeframe": "2h", "tf_ms": 7_200_000},
    {"id": "ondo-perp-15m-b2", "file": "BYBIT_ONDOUSDT.P_15m.csv", "exchange": "Bybit", "symbol": "ONDOUSDT.P", "market": "futures", "timeframe": "15m", "tf_ms": 900_000},
    {"id": "ondo-perp-1h-b2", "file": "BYBIT_ONDOUSDT.P_1h.csv", "exchange": "Bybit", "symbol": "ONDOUSDT.P", "market": "futures", "timeframe": "1h", "tf_ms": 3_600_000},
    {"id": "ondo-perp-2h-b2", "file": "BYBIT_ONDOUSDT.P_2h.csv", "exchange": "Bybit", "symbol": "ONDOUSDT.P", "market": "futures", "timeframe": "2h", "tf_ms": 7_200_000},
    {"id": "bnb-perp-3m-b2", "file": "BYBIT_BNBUSDT.P_3m.csv", "exchange": "Bybit", "symbol": "BNBUSDT.P", "market": "futures", "timeframe": "3m", "tf_ms": 180_000},
    {"id": "sp500-cfd-1m-b2", "file": "VANTAGE_SP500_1m.csv", "exchange": "Vantage", "symbol": "SP500", "market": "cfd-index", "timeframe": "1m", "tf_ms": 60_000},
]

EXPECTED_HEADER = ["time", "open", "high", "low", "close", "GGI Mean", "GGI Upper Outer", "GGI Upper Inner", "GGI Lower Inner", "GGI Lower Outer", "Shapes", "Shapes", "Volume"]
WARMUP_STABLE_ROWS = 200

entries = []
problems = []

for spec in DATASETS:
    path = os.path.join(DIR, spec["file"])
    with open(path, "rb") as f:
        raw = f.read()
    sha = hashlib.sha256(raw).hexdigest()

    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        assert header == EXPECTED_HEADER, f"{spec['id']}: unexpected header {header}"
        for line in reader:
            ts = datetime.fromisoformat(line[0]).astimezone(timezone.utc)
            o, h, l, c = map(float, line[1:5])
            mean, uo, ui, li, lo = map(float, line[5:10])
            buy, sell = int(line[10]), int(line[11])
            vol = float(line[12])
            rows.append((ts, o, h, l, c, mean, uo, ui, li, lo, buy, sell, vol))

    # sorted, unique timestamps
    ts_list = [r[0] for r in rows]
    assert ts_list == sorted(ts_list), f"{spec['id']}: timestamps not sorted"
    assert len(set(ts_list)) == len(ts_list), f"{spec['id']}: duplicate timestamps"

    # timeframe step check (gaps allowed: exchange downtime / market sessions)
    steps = [(ts_list[i + 1] - ts_list[i]).total_seconds() * 1000 for i in range(len(ts_list) - 1)]
    min_step = min(steps)
    gap_count = sum(1 for s in steps if s != spec["tf_ms"])
    assert min_step >= spec["tf_ms"], f"{spec['id']}: step smaller than timeframe"

    # band order validity per row; warm-up = prefix before first window of
    # WARMUP_STABLE_ROWS consecutive valid rows
    def band_ok(r):
        _, _, _, _, _, mean, uo, ui, li, lo = r[:10]
        return lo < li < mean < ui < uo

    valid = [band_ok(r) for r in rows]
    warmup_end = 0
    run = 0
    for i, v in enumerate(valid):
        run = run + 1 if v else 0
        if run == WARMUP_STABLE_ROWS:
            warmup_end = i - WARMUP_STABLE_ROWS + 1
            break
    else:
        problems.append(f"{spec['id']}: no stable band region found")
        warmup_end = 0

    invalid_after_warmup = sum(1 for v in valid[warmup_end:] if not v)
    buy_total = sum(r[10] for r in rows)
    sell_total = sum(r[11] for r in rows)
    buy_clean = sum(r[10] for r in rows[warmup_end:])
    sell_clean = sum(r[11] for r in rows[warmup_end:])
    labels_in_warmup = (buy_total - buy_clean) + (sell_total - sell_clean)

    volumes_ok = all(r[12] >= 0 for r in rows)

    entries.append({
        "id": spec["id"],
        "file": f"incoming-2026-08/{spec['file']}",
        "exchange": spec["exchange"],
        "symbol": spec["symbol"],
        "market": spec["market"],
        "timeframe": spec["timeframe"],
        "timeframeMs": spec["tf_ms"],
        "role": "oos-unseen-batch2",
        "rows": len(rows),
        "buy": buy_total,
        "sell": sell_total,
        "buyAfterWarmup": buy_clean,
        "sellAfterWarmup": sell_clean,
        "warmupRows": warmup_end,
        "labelsInsideWarmup": labels_in_warmup,
        "invalidBandRowsAfterWarmup": invalid_after_warmup,
        "timestampGaps": gap_count,
        "hasInlineVolume": volumes_ok,
        "firstUtc": ts_list[0].isoformat().replace("+00:00", "Z"),
        "lastUtc": ts_list[-1].isoformat().replace("+00:00", "Z"),
        "sha256": sha,
    })
    print(f"[ok] {spec['id']}: rows={len(rows)} buy={buy_total} sell={sell_total} "
          f"warmup={warmup_end} (labels inside: {labels_in_warmup}) "
          f"badBandsAfter={invalid_after_warmup} gaps={gap_count} "
          f"range={entries[-1]['firstUtc']}..{entries[-1]['lastUtc']}")

manifest = {
    "schemaVersion": 1,
    "batch": "2026-08-batch2",
    "source": "TradingView CSV export with original vendor bands, Shape labels and inline Volume",
    "shapeMapping": {"shape0": "BUY", "shape1": "SELL"},
    "hypothesisStatus": "UNSEEN for all F&G/volume-derived hypotheses as of ingestion; the only valid OOS confirmation corpus for them. Any analysis must be pre-registered BEFORE computing features on these files.",
    "warmupPolicy": f"warmupRows = prefix before first {WARMUP_STABLE_ROWS} consecutive rows with valid band order (lowerOuter<lowerInner<mean<upperInner<upperOuter); vendor-confirmed listing/early-history artifacts. Analyses must start at warmupRows.",
    "overlapNote": "btc-perp-15m-b2 and btc-perp-1h-b2 overlap the original development datasets in time; only the period after 2026-07-31T22:00Z is genuinely new for BTC. ONDO/BNB/SP500 are entirely new symbols.",
    "datasets": entries,
    "problems": problems,
}
with open("data/vendor-exports/manifest-batch2.json", "w") as f:
    json.dump(manifest, f, indent=1)
print(f"\nmanifest-batch2.json written; {len(entries)} datasets; problems: {problems or 'none'}")
total_buy = sum(e["buy"] for e in entries)
total_sell = sum(e["sell"] for e in entries)
print(f"TOTALS: rows={sum(e['rows'] for e in entries)} buy={total_buy} sell={total_sell} labels={total_buy + total_sell}")
