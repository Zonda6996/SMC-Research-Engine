# Apex / Reversal research results index

Read this file instead of opening reports in filename order. Historical reports remain as negative knowledge; the files below are the canonical path.

## Data and integrity

- `../data/vendor-exports/manifest.json` — six canonical exact TradingView exports, 86,420 rows / 370 labels, hashes and dataset roles.
- `bybit-volume-enrichment.md` — official Bybit volume alignment.
- Reproduce: `npm run research:integrity`.

## Apex — accepted production evidence

1. `apex-exact-export-cross-tf-fit.md` — BTC development fit.
2. `apex-sigma-oos.md` — sigma 4 beats 3.5 on every exact OOS dataset.
3. `../tests/apexOosRegression.test.ts` — regression protecting the OOS conclusion.

Current version: `apex-1.2-cross-oos-sigma-4`.

## Reversal — canonical negative sequence

1. `reversal-exact-exports-conclusion-v0.1.md` — exact labels reject naive per-bar rules.
2. `reversal-state-machine-search-v1.md` — bounded state machine; FAIL.
3. `reversal-chronology-diagnosis-v2.md` — long episode timing evidence.
4. `reversal-episode-search-v2.md` — episode grammar; FAIL.
5. `reversal-recovery-search-v3.md` — recovery grammar; FAIL.
6. `reversal-cooldown-search-v4.md` — strongest rejected family; FAIL.
7. `reversal-backplotted-pivot-v1.md` — pivot/backplot family; FAIL.
8. `reversal-fear-greed-search-v5.md` — OHLC proxy; FAIL.
9. `reversal-volume-fear-greed-search-v6.md` — volume-aware proxy; FAIL.
10. `reversal-automated-strict-critic.md` — one strict verdict across V1–V6.

Production Reversal was not changed by V1–V6.

## Black-box mode and public-output evidence

- `ggi-public-series-probe-result-v1.md` — public BUY/SELL are aliases of final Shapes; hidden state is not exposed.
- `ggi-risk-mode-black-box-result-v1.md` — Safe/Risk same entries on controlled overlap; Standard mostly filters.
- `ggi-risk-standard-low-tf-generalization-v1.md` — stateful Standard gate evidence and 53–54-bar global lock.
- `reversal-outer-geometry-v2.md` — no current/previous Outer touch on labels.
- `ggi-gemini-replica-audit-and-progress-v1.md` — external replica is a negative baseline.

The `ggi-*` prefix remains in provenance reports because that is the original private indicator/export name. Product code and UI use Zonda Apex / Zonda Reversal.

## Deferred next step

- `reversal-v7-deferred-research-brief.md` — narrow episode-age/lock/gate proposal. Recorded only; not run.
- `../docs/INDICATOR-RESEARCH-HANDOFF.md` — full rationale, protocol, gates and required deliverables.

## Research commands

```bash
npm run research:integrity
npm run research:critic
npx tsx ci/research/searchReversalStateMachine.ts
npx tsx ci/research/searchReversalEpisodesV2.ts
npx tsx ci/research/searchReversalRecoveriesV3.ts
npx tsx ci/research/searchReversalCooldownV4.ts
npx tsx ci/research/searchReversalFearGreedV5.ts
npx tsx ci/research/searchReversalVolumeFearGreedV6.ts
```

The search commands overwrite their corresponding artifacts. Do not rerun them merely to “see what happens”; preregister any changed hypothesis/search space first.
