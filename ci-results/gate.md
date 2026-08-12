# Gate

- run: 31598338364 attempt 1
- commit: acbe0af6835c8344d1b8495ce37561b697d99d3a
- date UTC: 2026-08-12T12:50:00Z
- node: v24.18.0, npm: 11.16.0

## tests (tsx --test tests/*.test.ts)
```
exit=1
ℹ tests 504
ℹ suites 22
ℹ pass 502
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8266.544276
✖ failing tests:
-- failures --
  Error: ENOENT: no such file or directory, open '/home/runner/work/SMC-Research-Engine/SMC-Research-Engine/data/vendor-exports/bybit-btcusdt-perp-15m.csv'
  Error: ENOENT: no such file or directory, open '/home/runner/work/SMC-Research-Engine/SMC-Research-Engine/data/vendor-exports/bybit-btcusdt-perp-15m.csv'
```

## tsc --noEmit
```
exit=2
scripts/auditReversalBenchmark.ts(3,36): error TS2307: Cannot find module '../src/core/signals/arrowTradeReplay.js' or its corresponding type declarations.
scripts/auditReversalBenchmark.ts(74,31): error TS7006: Parameter 't' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(75,33): error TS7006: Parameter 'x' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(75,54): error TS7006: Parameter 's' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(75,57): error TS7006: Parameter 'x' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(76,35): error TS7006: Parameter 'x' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(76,56): error TS7006: Parameter 's' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(76,59): error TS7006: Parameter 'x' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(77,34): error TS7006: Parameter 't' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(78,37): error TS7006: Parameter 't' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(79,39): error TS7006: Parameter 't' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(80,32): error TS7006: Parameter 't' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(82,37): error TS7006: Parameter 's' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(82,40): error TS7006: Parameter 'x' implicitly has an 'any' type.
scripts/auditReversalBenchmark.ts(100,5): error TS2353: Object literal may only specify known properties, and 'meanNetR' does not exist in type 'BenchmarkResult'.
```

## node --check frontend modules
```
failed files: 0
```

## verdict
GATE FAIL
