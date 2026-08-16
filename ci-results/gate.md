# Gate

- run: 31699182754 attempt 1
- commit: 5e5ca79a86eb86e8858a98a171ad458174983beb
- date UTC: 2026-08-13T12:15:40Z
- node: v24.19.0, npm: 11.17.0

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
ℹ duration_ms 8101.994177
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
