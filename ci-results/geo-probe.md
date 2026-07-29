# CI probe: data.binance.vision

- run: 30445971784 attempt 1
- commit: ecc7fc72c5b5ca8e800ee232aaa80ad166f653f8
- date UTC: 2026-07-29T11:02:03Z
- runner: Linux 6.17.0-1020-azure x86_64
- node: v24.18.0, npm: 11.16.0

## 1. Runner geo
```
{
  "ip": "52.173.219.147",
  "city": "Des Moines",
  "region": "Iowa",
  "country": "US",
  "loc": "41.6005,-93.6091",
  "org": "AS8075 Microsoft Corporation",
  "postal": "50309",
  "timezone": "America/Chicago",
  "readme": "https://ipinfo.io/missingauth"
}
```

## 2. Spot 1h archive (HEAD)
```
HTTP/2 200 
content-type: application/zip
content-length: 43482
date: Wed, 29 Jul 2026 11:02:04 GMT
last-modified: Mon, 05 Feb 2024 12:06:34 GMT
etag: "efcd0b4716abb9d950262a26fcb6ba43"
x-amz-server-side-encryption: AES256
accept-ranges: bytes
server: AmazonS3
x-cache: Miss from cloudfront
via: 1.1 be2c4206e13042a954840d2c2aee86ac.cloudfront.net (CloudFront)
x-amz-cf-pop: ORD58-P10
x-amz-cf-id: WAITSWOpNKvqd3QP8yUkFs5v72pnjQMX1TqM0Fkjx3fUegX3drMytg==

```

## 3. USDT-M futures 1h archive (full download)
```
http=200 size=38890 time=0.600901
-rw-r--r-- 1 runner runner 38890 Jul 29 11:02 /tmp/um1h.zip
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
http=200 size=408813 time=0.481012
-rw-r--r-- 1 runner runner 408813 Jul 29 11:02 /tmp/um5m.zip
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

added 19 packages in 3s
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
✔ полная лестница t100-141-241 без возврата к входу (0.432942ms)
✔ BE после первой фиксации: тейк 100, возврат к входу закрывает остаток (0.274295ms)
✔ конфликт стоп/тейк до первой фиксации = стоп (0.188756ms)
✔ BE взведён ранее: бар с тейком и касанием входа = BE остатка (консервативно) (0.247522ms)
✔ шорт: зеркальная механика (0.291273ms)
✔ ступень не в сторону профита отбрасывается, доли перенормируются (0.258529ms)
✔ нет валидных ступеней: null (0.442127ms)
✔ данные кончились с открытым остатком: null (0.422465ms)
✔ не вошедшая сделка: null (0.175475ms)
✔ canon-лестница существует и повторяет канонический менеджмент (141+241) (0.96207ms)
✔ tradeMetrics: победа считается по ЧИСТОМУ результату после комиссий (1.213437ms)
✔ tradeMetrics: перевод хода в R идёт от начального риска; комиссия вычитается один раз (0.202238ms)
✔ tradeMetrics: безубыточный вин рейт — детектор красивой, но убыточной настройки (0.263728ms)
✔ tradeMetrics: незакрытые сделки не считаются, просадка и профит-фактор считаются (0.511519ms)
✔ tradeMetrics: разрезы по ключу и календарные ключи (10.325014ms)
✔ tradeMetrics: контроль каузальности ряда свечей (0.720488ms)
✔ Decision Lab falls back to HTF when LTF history starts after setup (1.26743ms)
✔ Decision Lab excludes a grid expired by an opposite confirmed structure before touch (0.246277ms)
✔ Decision Lab excludes an old same-direction grid superseded before its touch (0.46256ms)
✔ Decision Lab reaction id is stable when candle-window candidate ids change (0.288981ms)
✔ Decision Lab exact candidate requires the requested left replay history (0.287358ms)
✔ Decision Lab excludes a level already touched before the grid became known (0.170935ms)
ℹ tests 325
ℹ suites 22
ℹ pass 325
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3577.489459
```

## 8. tsc --noEmit
```
exit=0
```

## 9. node --check frontend modules
```
failed files: 0
```
