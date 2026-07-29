#!/usr/bin/env bash
# ============================================================================
# Universal CI entry point.
#
# The workflow (.github/workflows/research.yml) is a thin shell that only does
# checkout -> node -> cache -> npm ci -> bash ci/run.sh. Everything about WHAT
# runs lives here and in ci/task.json, which are ordinary files an agent can
# edit — so changing CI behaviour never requires touching .github/workflows/.
#
# Inputs (env, set by the workflow):
#   TASK       gate | geo-probe | viz-shots | research
#   ARGS       free-form extra args from workflow_dispatch
#   CACHE_DIR  persisted across runs via actions/cache (Binance archives)
#
# Output: ci-results/*.md, committed back to the branch.
# ============================================================================
set -uo pipefail

TASK="${TASK:-gate}"
ARGS="${ARGS:-}"
CACHE_DIR="${CACHE_DIR:-.cache/binance}"
OUT_DIR=ci-results
mkdir -p "$OUT_DIR" "$CACHE_DIR"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
hdr() {
  echo "- run: ${GITHUB_RUN_ID:-local} attempt ${GITHUB_RUN_ATTEMPT:-1}"
  echo "- commit: ${GITHUB_SHA:-local}"
  echo "- date UTC: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "- node: $(node -v 2>&1), npm: $(npm -v 2>&1)"
}

# ---------------------------------------------------------------------------
# fetch_archives <url-list-file> [parallel]
# Downloads every URL in the list into CACHE_DIR, skipping already-cached
# files. Binance archives are immutable, so a cache hit is always valid.
# Missing files (404 for a day/coin that does not exist) are reported, never
# fatal. Use this for klines and metrics archives.
# ---------------------------------------------------------------------------
fetch_archives() {
  local list="$1" parallel="${2:-12}" total
  total=$(wc -l < "$list")
  log "archives: $total urls, parallel=$parallel, cache=$CACHE_DIR"
  CACHE_DIR="$CACHE_DIR" xargs -a "$list" -P "$parallel" -I{} bash -c '
    url="$1"; out="$CACHE_DIR/$(basename "$url")"
    [ -s "$out" ] && exit 0
    if curl -sfS --max-time 120 --retry 3 --retry-delay 2 -o "$out.part" "$url"; then
      mv "$out.part" "$out"
    else
      rm -f "$out.part"; echo "MISS $url"
    fi
  ' _ {}
  log "cache now: $(find "$CACHE_DIR" -type f | wc -l) files, $(du -sh "$CACHE_DIR" 2>/dev/null | cut -f1)"
}

# ---------------------------------------------------------------------------
# gate — the project's standard verification, per docs/CONTEXT.md:
# tests (325 expected) + tsc --noEmit + node --check on frontend modules.
# Always writes a report; exits non-zero if anything failed, so a red run in
# the Actions tab means "the gate is broken".
# ---------------------------------------------------------------------------
gate() {
  local rc=0 report="$OUT_DIR/gate.md"
  {
    echo "# Gate"
    echo
    hdr
    echo

    echo "## tests (tsx --test tests/*.test.ts)"
    echo '```'
    npx tsx --test tests/*.test.ts > /tmp/tests.log 2>&1; local t=$?
    echo "exit=$t"
    grep -E '^. (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)' /tmp/tests.log \
      || tail -40 /tmp/tests.log
    if [ $t -ne 0 ]; then
      echo "-- failures --"
      grep -E '^not ok|^  *Error|AssertionError' /tmp/tests.log | head -40
    fi
    echo '```'
    echo

    echo "## tsc --noEmit"
    echo '```'
    npx tsc --noEmit > /tmp/tsc.log 2>&1; local c=$?
    echo "exit=$c"
    tail -40 /tmp/tsc.log
    echo '```'
    echo

    echo "## node --check frontend modules"
    echo '```'
    local fails=0 f
    for f in tools/visualizer/public/*.mjs tools/visualizer/public/lib/*.mjs tools/visualizer/public/panels/*.mjs; do
      [ -e "$f" ] || continue
      node --check "$f" 2>&1 || { echo "FAIL $f"; fails=$((fails+1)); }
    done
    echo "failed files: $fails"
    echo '```'

    rc=$(( t != 0 || c != 0 || fails != 0 ))
    echo
    echo "## verdict"
    [ $rc -eq 0 ] && echo "GATE PASS" || echo "GATE FAIL"
  } > "$report" 2>&1
  log "wrote $report"
  return $rc
}

# ---------------------------------------------------------------------------
# viz-shots — visual debugging of the visualizer on the fixture dataset.
# Needs ci/viz-shots.mjs (Playwright script) and needsPlaywright: true.
# ---------------------------------------------------------------------------
viz_shots() {
  if [ ! -f ci/viz-shots.mjs ]; then
    log "ci/viz-shots.mjs is missing — nothing to run"
    return 1
  fi
  mkdir -p "$OUT_DIR/shots"
  node ci/viz-shots.mjs 2>&1 | tee "$OUT_DIR/viz-shots.log"
  return "${PIPESTATUS[0]}"
}

# ---------------------------------------------------------------------------
# research — runs a tsx entry point named in ci/task.json (.script).
# That script owns its own data loading (via fetch_archives output in
# CACHE_DIR) and writes its own report into ci-results/.
# ---------------------------------------------------------------------------
research() {
  local script
  script=$(jq -r '.script // empty' ci/task.json 2>/dev/null)
  if [ -z "$script" ] || [ ! -f "$script" ]; then
    log "ci/task.json .script is not set to an existing file (got: '${script:-none}')"
    return 1
  fi
  log "running $script"
  CACHE_DIR="$CACHE_DIR" OUT_DIR="$OUT_DIR" npx tsx "$script" $ARGS 2>&1 | tee "$OUT_DIR/research.log"
  return "${PIPESTATUS[0]}"
}

log "task=$TASK args='${ARGS}'"
case "$TASK" in
  gate)       gate ;;
  geo-probe)  bash ci/geo-probe.sh ;;
  viz-shots)  viz_shots ;;
  research)   research ;;
  *)          log "unknown TASK: $TASK"; exit 1 ;;
esac
rc=$?
log "task=$TASK finished rc=$rc"
exit $rc
