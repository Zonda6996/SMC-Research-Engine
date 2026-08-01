import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'

type MatchRow = { id: string; status: string; expectedAt?: string; expected?: { direction: 'long' | 'short' | null; signalPresent: boolean } }
type Match = { rows: MatchRow[] }
const match = JSON.parse(readFileSync('ci-results/reversal-observation-match-2026-07-31.json', 'utf8')) as Match
const positives = match.rows.filter((x) => x.status === 'matched' && x.expectedAt && x.expected?.signalPresent && x.expected.direction)
const CACHE = process.env.CACHE_DIR ?? '.cache/binance', OUT = process.env.OUT_DIR ?? 'ci-results'
const FROM = Date.UTC(2026, 5, 25), UNTIL = Date.UTC(2026, 7, 1)
const tfById = (id: string) => id.startsWith('btc') ? (id.includes('12') || id.includes('13') ? '15m' : '1h') : id.startsWith('eth') ? '1h' : id.includes('30m') ? '30m' : '5m'
const symbolById = (id: string) => id.startsWith('btc') ? 'BTCUSDT' : id.startsWith('eth') ? 'ETHUSDT' : 'SOLUSDT'
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN
const stoch = (c: Candle[], i: number, n: number) => { const x = c.slice(Math.max(0, i - n + 1), i + 1), lo = Math.min(...x.map((z) => z.low)), hi = Math.max(...x.map((z) => z.high)); return (c[i]!.close - lo) / Math.max(1e-12, hi - lo) }
const rsi = (c: Candle[], i: number, n: number) => { const a: number[] = []; for (let j = Math.max(1, i - n + 1); j <= i; j++) a.push(c[j]!.close / c[j - 1]!.close - 1); const u = mean(a.map((x) => Math.max(0, x))), d = mean(a.map((x) => Math.max(0, -x))); return d === 0 ? 100 : 100 - 100 / (1 + u / d) }
const body = (x: Candle) => Math.abs(x.close - x.open)
const rangeExtreme = (c: Candle[], i: number, dir: 'long' | 'short', n: number, tolerance: number) => { const x = c.slice(i - n, i), lo = Math.min(...x.map((z) => z.low)), hi = Math.max(...x.map((z) => z.high)); return dir === 'long' ? c[i]!.low <= lo * (1 + tolerance) : c[i]!.high >= hi * (1 - tolerance) }
const displacement = (c: Candle[], i: number, dir: 'long' | 'short', n: number, minMove: number) => { const ref = c[i - n]!.close; const move = c[i]!.close / ref - 1; return dir === 'long' ? move <= -minMove : move >= minMove }

type Params = { n: number; move: number; tolerance: number; recovery: number; bodyRatio: number; maxBars: number; requireStoch: boolean; requireRsi: boolean }
const paramGrid: Params[] = []
for (const n of [24, 48]) for (const move of [0.006, 0.01]) for (const bodyRatio of [0.85, 1]) for (const maxBars of [8, 16]) paramGrid.push({ n, move, tolerance: 0, recovery: 0, bodyRatio, maxBars, requireStoch: false, requireRsi: false })

function detect(c: Candle[], p: Params) {
	const out: Array<{ at: number; dir: 'long' | 'short' }> = []
	const state = { long: null as number | null, short: null as number | null }
	for (let i = Math.max(50, p.n + 1); i < c.length; i++) {
		for (const dir of ['long', 'short'] as const) {
			const extreme = rangeExtreme(c, i, dir, p.n, p.tolerance) && displacement(c, i, dir, p.n, p.move)
			const prior = c[i - 1]!
			const recovery = dir === 'long' ? c[i]!.close > prior.close : c[i]!.close < prior.close
			const directional = dir === 'long' ? c[i]!.close > c[i]!.open : c[i]!.close < c[i]!.open
			const stochRecovery = dir === 'long' ? stoch(c, i, 14) > .2 && stoch(c, i - 1, 14) <= .2 : stoch(c, i) < .8 && stoch(c, i - 1) >= .8
			const rsiRecovery = dir === 'long' ? rsi(c, i, 14) > 35 && rsi(c, i - 1, 14) <= 35 : rsi(c, i) < 65 && rsi(c, i - 1, 14) >= 65
			if (extreme) state[dir] = i
			if (state[dir] != null && i - state[dir]! > p.maxBars) state[dir] = null
			const pending = state[dir] != null
			const bodyContract = body(c[i]!) <= body(prior) * p.bodyRatio
			if (pending && recovery && directional && bodyContract && (!p.requireStoch || stochRecovery) && (!p.requireRsi || rsiRecovery)) {
				out.push({ at: c[i]!.timestamp, dir }); state[dir] = null
			}
		}
	}
	return out
}
const groups = new Map<string, MatchRow[]>()
for (const r of positives) { const k = `${symbolById(r.id)}|${tfById(r.id)}`; groups.set(k, [...(groups.get(k) ?? []), r]) }
const datasets = [] as Array<{ symbol: string; tf: string; obs: MatchRow[]; candles: Candle[] }>
for (const [key, obs] of groups) {
	const [symbol, tf] = key.split('|')
	const candles = await fetchArchiveKlines(symbol!, tf!, 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 10 })
	if (candles.length) datasets.push({ symbol: symbol!, tf: tf!, obs, candles })
}
const scans: any[] = []
for (const p of paramGrid) {
	let positiveN = 0, positiveHit = 0, signalCount = 0
	for (const d of datasets) {
		const signals = detect(d.candles, p)
		const step = d.candles[1]!.timestamp - d.candles[0]!.timestamp
		positiveN += d.obs.length
		signalCount += signals.length
		for (const o of d.obs) if (signals.some((s) => s.dir === o.expected!.direction && Math.abs(s.at - Date.parse(o.expectedAt!)) <= step)) positiveHit++
	}
	scans.push({ ...p, positiveN, positiveHit, recall: positiveN ? positiveHit / positiveN : 0, signalCount })
}
const ranked = scans.sort((a, b) => b.recall - a.recall || a.signalCount - b.signalCount).slice(0, 40)
const md = `# Reversal OHLCV state-machine scan v0.1

- Standard chart OHLCV only; no external series/outcome/future values.
- Positive exact events: ${positives.length}.
- The state machine requires prior displacement + rolling extreme, then recovery/directional/body condition within bounded memory.
- Results are research-only; no production defaults changed.

| n | move | tol | body ratio | expiry | Stoch | RSI | hit | recall | generated |
|---:|---:|---:|---:|---:|---|---|---:|---:|---:|
${ranked.map((x) => `| ${x.n} | ${(100 * x.move).toFixed(1)}% | ${(100 * x.tolerance).toFixed(1)}% | ${x.bodyRatio} | ${x.maxBars} | ${x.requireStoch ? 'Y' : 'N'} | ${x.requireRsi ? 'Y' : 'N'} | ${x.positiveHit} | ${(100 * x.recall).toFixed(1)}% | ${x.signalCount} |`).join('\n')}

## Interpretation

The key next comparison is generated signal count on the SOL 20–21 July no-signal window. Positive recall alone is not enough. A candidate must retain recall while producing no or very few signals inside that window, then survive an untouched symbol/TF check.
`
mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/reversal-state-machine-scan-v0.1.json`, JSON.stringify({ meta: { from: FROM, until: UNTIL }, ranked, scans }, null, 2)); writeFileSync(`${OUT}/reversal-state-machine-scan-v0.1.md`, md); console.log(md)
