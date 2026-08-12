import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'

type MatchRow = { id: string; status: string; expectedAt?: string; expected?: { direction: 'long' | 'short' | null; signalPresent: boolean } }
type Match = { rows: MatchRow[] }
const match = JSON.parse(readFileSync('ci-results/reversal-observation-match-2026-07-31.json', 'utf8')) as Match
const positives = match.rows.filter((x) => x.status === 'matched' && x.expectedAt && x.expected?.signalPresent && x.expected.direction)
const CACHE = process.env.CACHE_DIR ?? '.cache/binance', OUT = process.env.OUT_DIR ?? 'ci-results'
const FROM = Date.UTC(2026, 5, 25), UNTIL = Date.UTC(2026, 7, 1)
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN
const stoch = (c: Candle[], i: number, n: number) => { const x = c.slice(Math.max(0, i - n + 1), i + 1), lo = Math.min(...x.map((z) => z.low)), hi = Math.max(...x.map((z) => z.high)); return (c[i]!.close - lo) / Math.max(1e-12, hi - lo) }
const rsi = (c: Candle[], i: number, n: number) => { const a: number[] = []; for (let j = Math.max(1, i - n + 1); j <= i; j++) a.push(c[j]!.close / c[j - 1]!.close - 1); const u = mean(a.map((x) => Math.max(0, x))), d = mean(a.map((x) => Math.max(0, -x))); return d === 0 ? 100 : 100 - 100 / (1 + u / d) }
const body = (x: Candle) => Math.abs(x.close - x.open)
const extreme = (c: Candle[], i: number, dir: 'long' | 'short', n: number, tolerance: number) => { const x = c.slice(i - n, i), lo = Math.min(...x.map((z) => z.low)), hi = Math.max(...x.map((z) => z.high)); return dir === 'long' ? c[i]!.low <= lo * (1 + tolerance) : c[i]!.high >= hi * (1 - tolerance) }
const displacement = (c: Candle[], i: number, dir: 'long' | 'short', n: number, minMove: number) => { const move = c[i]!.close / c[i - n]!.close - 1; return dir === 'long' ? move <= -minMove : move >= minMove }

type Params = { n: number; move: number; bodyRatio: number; maxBars: number; requireStoch: boolean; requireRsi: boolean }
const params: Params[] = [
	{ n: 48, move: .01, bodyRatio: 1, maxBars: 8, requireStoch: false, requireRsi: false },
	{ n: 48, move: .01, bodyRatio: 1, maxBars: 16, requireStoch: false, requireRsi: false },
	{ n: 48, move: .006, bodyRatio: 1, maxBars: 8, requireStoch: false, requireRsi: false },
	{ n: 48, move: .006, bodyRatio: 1, maxBars: 16, requireStoch: false, requireRsi: false },
]
function detect(c: Candle[], p: Params) {
	const out: Array<{ at: number; dir: 'long' | 'short' }> = []
	const state = { long: null as number | null, short: null as number | null }
	for (let i = Math.max(50, p.n + 1); i < c.length; i++) {
		for (const dir of ['long', 'short'] as const) {
			if (extreme(c, i, dir, p.n, 0) && displacement(c, i, dir, p.n, p.move)) state[dir] = i
			if (state[dir] != null && i - state[dir]! > p.maxBars) state[dir] = null
			const directional = dir === 'long' ? c[i]!.close > c[i]!.open : c[i]!.close < c[i]!.open
			const recovery = dir === 'long' ? c[i]!.close > c[i - 1]!.close : c[i]!.close < c[i - 1]!.close
			const contract = body(c[i]!) <= body(c[i - 1]!) * p.bodyRatio
			const sr = dir === 'long' ? stoch(c, i) > .2 && stoch(c, i - 1) <= .2 : stoch(c, i) < .8 && stoch(c, i - 1) >= .8
			const rr = dir === 'long' ? rsi(c, i, 14) > 35 && rsi(c, i - 1, 14) <= 35 : rsi(c, i, 14) < 65 && rsi(c, i - 1, 14) >= 65
			if (state[dir] != null && directional && recovery && contract && (!p.requireStoch || sr) && (!p.requireRsi || rr)) { out.push({ at: c[i]!.timestamp, dir }); state[dir] = null }
		}
	}
	return out
}
const c = await fetchArchiveKlines('SOLUSDT', '5m', 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 10 })
const win = { from: Date.parse('2026-07-19T07:00:00Z'), to: Date.parse('2026-07-20T16:00:00Z') }
const reports = params.map((p) => { const signals = detect(c, p); const inWindow = signals.filter((x) => x.at >= win.from && x.at <= win.to); const positiveN = positives.length; const hits = signals.filter((x) => positives.some((o) => x.dir === o.expected!.direction && Math.abs(x.at - Date.parse(o.expectedAt!)) <= 300_000)).length; return { ...p, positiveN, positiveHits: hits, recall: hits / positiveN, totalSignals: signals.length, noSignalWindowSignals: inWindow.length, noSignalWindow: inWindow } })
const md = `# Reversal state-machine negative check v0.1

- Negative window: approximate visible SOLUSDT Spot 5m segment 2026-07-19 12:00 → 2026-07-20 21:00 Kazakhstan.
- Exact screenshot boundaries are not available; this is sensitivity analysis, not a confirmed precision score.
- Positive events: ${positives.length}; no outcomes or external data used.

| n | move | body ratio | expiry | positive hits | recall | total generated | generated in no-signal window |
|---:|---:|---:|---:|---:|---:|---:|---:|
${reports.map((x) => `| ${x.n} | ${(100 * x.move).toFixed(1)}% | ${x.bodyRatio} | ${x.maxBars} | ${x.positiveHits} | ${(100 * x.recall).toFixed(1)}% | ${x.totalSignals} | ${x.noSignalWindowSignals} |`).join('\n')}

## Conclusion

The state machine removes most raw OHLCV noise, but it is not accepted: even a candidate with useful positive recall must produce zero or very few signals in the confirmed no-signal area and then pass an untouched symbol/TF check. The current window is approximate, so exact screenshot boundaries remain necessary for a final precision judgment.
`
mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/reversal-state-machine-negative-check-v0.1.json`, JSON.stringify({ meta: { symbol: 'SOLUSDT', tf: '5m', market: 'spot', window: win }, reports }, null, 2)); writeFileSync(`${OUT}/reversal-state-machine-negative-check-v0.1.md`, md); console.log(md)
