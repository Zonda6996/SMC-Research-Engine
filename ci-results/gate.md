# Gate

- run: 31699179003 attempt 1
- commit: e2afe7407f520e9c6e789fd655dfc6ba4ada3e18
- date UTC: 2026-08-13T12:15:39Z
- node: v24.18.0, npm: 11.16.0

## tests (tsx --test tests/*.test.ts)
```
exit=1
ℹ tests 505
ℹ suites 22
ℹ pass 503
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8575.413243
✖ failing tests:
-- failures --
  Error: ENOENT: no such file or directory, open '/home/runner/work/SMC-Research-Engine/SMC-Research-Engine/data/vendor-exports/bybit-btcusdt-perp-15m.csv'
  Error: ENOENT: no such file or directory, open '/home/runner/work/SMC-Research-Engine/SMC-Research-Engine/data/vendor-exports/bybit-btcusdt-perp-15m.csv'
```

## tsc --noEmit
```
exit=0
```

## node --check frontend modules
```
failed files: 0
```

## verdict
GATE FAIL
