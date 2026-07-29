#!/usr/bin/env bash
# CI probe: is data.binance.vision reachable from a GitHub runner, and can the
# project gate (npm ci / tests / tsc / node --check) run there?
# Writes a Markdown report to ci-results/geo-probe.md and never fails the job.
set +e

mkdir -p ci-results
LOG=ci-results/geo-probe.md

{
  echo "# CI probe: data.binance.vision"
  echo
  echo "- run: ${GITHUB_RUN_ID:-local} attempt ${GITHUB_RUN_ATTEMPT:-1}"
  echo "- commit: ${GITHUB_SHA:-local}"
  echo "- date UTC: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "- runner: $(uname -srm)"
  echo "- node: $(node -v 2>&1), npm: $(npm -v 2>&1)"
  echo

  echo "## 1. Runner geo"
  echo '```'
  curl -s --max-time 20 https://ipinfo.io/json
  echo
  echo '```'
  echo

  echo "## 2. Spot 1h archive (HEAD)"
  echo '```'
  curl -sI --max-time 30 "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-01.zip" | head -15
  echo '```'
  echo

  echo "## 3. USDT-M futures 1h archive (full download)"
  echo '```'
  curl -s --max-time 180 -o /tmp/um1h.zip -w "http=%{http_code} size=%{size_download} time=%{time_total}\n" \
    "https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-01.zip"
  ls -l /tmp/um1h.zip 2>&1
  sha256sum /tmp/um1h.zip 2>&1
  echo "-- first 3 rows --"
  unzip -p /tmp/um1h.zip 2>&1 | head -3
  echo "-- row count --"
  unzip -p /tmp/um1h.zip 2>/dev/null | wc -l
  echo '```'
  echo

  echo "## 4. USDT-M futures 5m archive (heaviest case)"
  echo '```'
  curl -s --max-time 300 -o /tmp/um5m.zip -w "http=%{http_code} size=%{size_download} time=%{time_total}\n" \
    "https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/5m/BTCUSDT-5m-2024-01.zip"
  ls -l /tmp/um5m.zip 2>&1
  unzip -p /tmp/um5m.zip 2>/dev/null | wc -l
  echo '```'
  echo

  echo "## 5. Binance futures API (expected geo-blocked on US runners)"
  echo '```'
  curl -s --max-time 30 -o /tmp/api.json -w "http=%{http_code}\n" "https://fapi.binance.com/fapi/v1/time"
  head -c 300 /tmp/api.json 2>&1
  echo
  echo '```'
  echo

  echo "## 6. npm ci"
  echo '```'
  npm ci --no-audit --no-fund > /tmp/npmci.log 2>&1; rc=$?
  echo "exit=$rc"
  tail -20 /tmp/npmci.log
  echo '```'
  echo

  echo "## 7. tests (tsx --test tests/*.test.ts)"
  echo '```'
  npx tsx --test tests/*.test.ts > /tmp/tests.log 2>&1; rc=$?
  echo "exit=$rc"
  grep -E '^# (tests|pass|fail|cancelled|skipped|todo|duration_ms)' /tmp/tests.log || tail -30 /tmp/tests.log
  echo '```'
  echo

  echo "## 8. tsc --noEmit"
  echo '```'
  npx tsc --noEmit > /tmp/tsc.log 2>&1; rc=$?
  echo "exit=$rc"
  tail -20 /tmp/tsc.log
  echo '```'
  echo

  echo "## 9. node --check frontend modules"
  echo '```'
  fails=0
  for f in tools/visualizer/public/*.mjs tools/visualizer/public/lib/*.mjs tools/visualizer/public/panels/*.mjs; do
    [ -e "$f" ] || continue
    node --check "$f" 2>&1 || { echo "FAIL $f"; fails=$((fails+1)); }
  done
  echo "failed files: $fails"
  echo '```'
} > "$LOG" 2>&1

echo "report written to $LOG"
