# CI probe: data.binance.vision

- run: 30447295656 attempt 1
- commit: be67a48cf63d98318fcaddcd5ad41e13904f52a7
- date UTC: 2026-07-29T11:22:21Z
- runner: Linux 6.17.0-1020-azure x86_64
- node: v24.18.0, npm: 11.16.0

## 1. Runner geo
```
{
  "ip": "48.214.54.49",
  "city": "Boydton",
  "region": "Virginia",
  "country": "US",
  "loc": "36.6676,-78.3875",
  "org": "AS8075 Microsoft Corporation",
  "postal": "23917",
  "timezone": "America/New_York",
  "readme": "https://ipinfo.io/missingauth"
}
```

## 2. Spot 1h archive (HEAD)
```
HTTP/2 200 
content-type: application/zip
content-length: 43482
date: Wed, 29 Jul 2026 11:22:23 GMT
last-modified: Mon, 05 Feb 2024 12:06:34 GMT
etag: "efcd0b4716abb9d950262a26fcb6ba43"
x-amz-server-side-encryption: AES256
accept-ranges: bytes
server: AmazonS3
x-cache: Miss from cloudfront
via: 1.1 d125bf8405e840aa51a88ae3d8d91fb2.cloudfront.net (CloudFront)
x-amz-cf-pop: IAD12-P1
x-amz-cf-id: YEz7FmuaPCxPl8Ouy6I7s444rx2O89ifThCWnvKDa2rh2YZL4z7N7Q==

```

## 3. USDT-M futures 1h archive (full download)
```
http=200 size=38890 time=0.657506
-rw-r--r-- 1 runner runner 38890 Jul 29 11:22 /tmp/um1h.zip
bf673f3d10804a951e8bac56dd2473486f113025971d43ebe5258ec40f9bfeb3  /tmp/um1h.zip
-- first 3 rows --
open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore
1704067200000,42314.00,42603.20,42289.60,42503.50,8459.477,1704070799999,359196345.08716,88278,4687.976,199033806.82405,0
1704070800000,42503.50,42832.00,42462.00,42647.90,9043.411,1704074399999,385970069.22236,90351,4783.838,204180582.72378,0
-- row count --
745
```

## 4. USDT-M futures 5m archive (heaviest case)
```
http=200 size=408813 time=1.139211
-rw-r--r-- 1 runner runner 408813 Jul 29 11:22 /tmp/um5m.zip
8929
```

## 5. Binance futures API (expected geo-blocked on US runners)
```
http=451
{
  "code": 0,
  "msg": "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms. Please contact customer service if you believe you received this message in error."
}
```

## 6. npm ci
```
exit=0

added 19 packages in 4s
npm warn allow-scripts 3 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   bufferutil@4.1.0 (install: node-gyp-build)
npm warn allow-scripts   ccxt@4.5.62 (postinstall: node postinstall.js)
npm warn allow-scripts   esbuild@0.28.1 (postinstall: node install.js)
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
```

## 7. tests (tsx --test tests/*.test.ts)
```
exit=0
ℹ tests 325
ℹ suites 22
ℹ pass 325
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3804.627258
```

## 8. tsc --noEmit
```
exit=0
```

## 9. node --check frontend modules
```
failed files: 0
```

## 10. OI metrics archives (OI-hybrid heatmap without the API)
Current source is ccxt fetchOpenInterestHistory (API, geo-blocked, ~30 days of history).
If these daily metrics archives are reachable, OI history becomes multi-year.
```
2021-06-01 -> http=200 size=11875
2022-06-01 -> http=200 size=14738
2023-01-03 -> http=200 size=14477
2024-01-03 -> http=200 size=11608
2025-06-02 -> http=200 size=11233
2026-07-20 -> http=200 size=11210
2026-07-27 -> http=200 size=11128

-- columns + first rows of 2026-07-20 (vendor anchor date) --
create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio
2026-07-20 00:00:00,BTCUSDT,102397.9520000000000000,6616155263.1900450000000000,1.54973923,1.47833900,1.39157631,1.29907400
2026-07-20 00:05:00,BTCUSDT,102371.7860000000000000,6632881754.7971380000000000,1.54469309,1.47791600,1.38972062,2.26413400
2026-07-20 00:10:00,BTCUSDT,101864.4060000000000000,6621823117.8285380000000000,1.54569800,1.47960600,1.39744030,2.25607400
-- row count (expect 288 for 5m sampling) --
289

-- ETH/SOL same date, sanity check across coins --
ETHUSDT -> http=200 size=11527
SOLUSDT -> http=200 size=11282
```
