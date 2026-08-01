import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { detectReversalResearch, type ReversalHypothesisId } from '../../src/core/signals/ReversalResearch.js'

type MatchRow = {
	id: string
	status: string
	expectedAt?: string
	expected?: { direction: 'long' | 'short' | null; mode: 'safe' | 'risk' | 'standard'; signalPresent: boolean }
}
type Match = { rows: MatchRow[] }
const match = JSON.parse(readFileSync('ci-results/reversal-observation-match-2026-07-31.json', 'utf8')) as Match
const exact = match.rows.filter((x) => x.status === 'matched' && x.expectedAt && x.expected?.signalPresent && x.expected.direction)
const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const hypotheses: ReversalHypothesisId[] = ['H0', 'H1', 'H3', 'H4', 'H5']
const tolerances = [0, 1, 2, 4]
const from = Date.UTC(2026, 5, 25), until = Date.UTC(2026, 7, 1)
const grouped = new Map<string, MatchRow[]>()
for (const r of exact) {
	const [symbol, tf] = r.id.startsWith('btc') ? ['BTCUSDT', r.id.includes('12') || r.id.includes('13') ? '15m' : '1h']
		: r.id.startsWith('eth') ? ['ETHUSDT', r.id.includes('sell') ? '1h' : '45m']
			: ['SOLUSDT', r.id.includes('30m') ? '30m' : '5m']
	const key = `${symbol}|${tf}`
	grouped.set(key, [...(grouped.get(key) ?? []), r])
}
const scores: any[] = []
for (const [key, observations] of grouped) {
	const [symbol, tf] = key.split('|')
	const candles = await fetchArchiveKlines(symbol!, tf!, 'spot', from, until, { cacheDir: CACHE, parallel: 10 })
	if (!candles.length) continue
	const step = candles.length > 1 ? candles[1]!.timestamp - candles[0]!.timestamp : 0
	for (const hypothesis of hypotheses) {
		for (const mode of ['safe', 'risk', 'standard'] as const) {
			const signals = detectReversalResearch(candles, { hypothesis, mode })
			for (const toleranceBars of tolerances) {
				let hit = 0
				const timings: number[] = []
				for (const o of observations.filter((x) => x.expected!.mode === mode)) {
					const at = Date.parse(o.expectedAt!)
					const candidates = signals.filter((s) => s.direction === o.expected!.direction && Math.abs(s.at - at) <= toleranceBars * step)
					if (!candidates.length) continue
					hit++
					timings.push(Math.min(...candidates.map((s) => Math.abs(s.at - at) / step)))
				}
				const n = observations.filter((x) => x.expected!.mode === mode).length
				scores.push({ symbol, tf, hypothesis, mode, toleranceBars, n, hit, recall: n ? hit / n : null, meanAbsTimingBars: timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : null, generatedSignals: signals.length })
			}
		}
	}
}
const aggregate = hypotheses.flatMap((hypothesis) => ['safe', 'risk', 'standard'].flatMap((mode) => tolerances.map((toleranceBars) => {
	const x = scores.filter((r) => r.hypothesis === hypothesis && r.mode === mode && r.toleranceBars === toleranceBars)
	const n = x.reduce((a, b) => a + b.n, 0), hit = x.reduce((a, b) => a + b.hit, 0)
	return { hypothesis, mode, toleranceBars, n, hit, recall: n ? hit / n : null }
})))
const fmt = (x: number | null) => x == null ? '—' : `${(100 * x).toFixed(1)}%`
const md = `# Reversal H0-H5 reconstruction score v0.1

- Exact positive observations only; outcome excluded from all features and scoring.
- Feed: Binance Spot archive.
- Tolerance is reported explicitly because TradingView labels may be intrabar and screenshot timestamp transcription may differ by one bar.
- This is recall-only until exact matched no-signal bars are available; it cannot select a production detector by itself.
- Production defaults changed: **NO**.

| Hypothesis | Mode | Tolerance | n | Hits | Recall |
|---|---|---:|---:|---:|---:|
${aggregate.filter((x) => x.n > 0).map((x) => `| ${x.hypothesis} | ${x.mode} | ${x.toleranceBars} bars | ${x.n} | ${x.hit} | ${fmt(x.recall)} |`).join('\n')}

## Hard limitation

There are no exact timestamped matched-negative bars yet. Therefore precision and false-positive rate are undefined. The wide SOL 20–21 July window is useful, but it must be converted into exact candidate bars before comparing hypotheses fairly. Until then, H0 remains the production baseline and every H1/H3/H4/H5 score is research-only.
`
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/reversal-hypothesis-score-v0.1.json`, JSON.stringify({ meta: { from, until, market: 'spot', tolerances }, scores, aggregate }, null, 2))
writeFileSync(`${OUT}/reversal-hypothesis-score-v0.1.md`, md)
console.log(md)
