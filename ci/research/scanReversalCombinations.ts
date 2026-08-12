import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'

type Row = { id: string; status: string; expectedAt?: string; expected?: { direction: 'long' | 'short' | null; signalPresent: boolean } }
type Match = { rows: Row[] }
const match = JSON.parse(readFileSync('ci-results/reversal-observation-match-2026-07-31.json', 'utf8')) as Match
const positives = match.rows.filter((x) => x.status === 'matched' && x.expectedAt && x.expected?.signalPresent && x.expected.direction)
const CACHE = process.env.CACHE_DIR ?? '.cache/binance', OUT = process.env.OUT_DIR ?? 'ci-results'
const FROM = Date.UTC(2026, 5, 25), UNTIL = Date.UTC(2026, 7, 1)
const tfById = (id: string) => id.startsWith('btc') ? (id.includes('12') || id.includes('13') ? '15m' : '1h') : id.startsWith('eth') ? '1h' : id.includes('30m') ? '30m' : '5m'
const symbolById = (id: string) => id.startsWith('btc') ? 'BTCUSDT' : id.startsWith('eth') ? 'ETHUSDT' : 'SOLUSDT'
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN
const rsi = (c: Candle[], i: number, n: number) => { const rs: number[] = []; for (let j = Math.max(1, i - n + 1); j <= i; j++) rs.push(c[j]!.close / c[j - 1]!.close - 1); const up = mean(rs.map((x) => Math.max(0, x))), down = mean(rs.map((x) => Math.max(0, -x))); return down === 0 ? 100 : 100 - 100 / (1 + up / down) }
const stoch = (c: Candle[], i: number, n: number) => { const x = c.slice(Math.max(0, i - n + 1), i + 1), lo = Math.min(...x.map((z) => z.low)), hi = Math.max(...x.map((z) => z.high)); return (c[i]!.close - lo) / Math.max(1e-12, hi - lo) }
const typ = (x: Candle) => (x.high + x.low + x.close) / 3
const mfi = (c: Candle[], i: number, n: number) => { const x = c.slice(Math.max(0, i - n + 1), i + 1); let p = 0, q = 0; for (let j = 1; j < x.length; j++) { const flow = typ(x[j]!) * x[j]!.volume; if (typ(x[j]!) >= typ(x[j - 1]!)) p += flow; else q += flow } return q === 0 ? 100 : 100 - 100 / (1 + p / q) }
const body = (x: Candle) => Math.abs(x.close - x.open)
const features = (c: Candle[], i: number, dir: 'long' | 'short') => {
	const x = c[i]!, prev = c[i - 1]!, range = Math.max(1e-12, x.high - x.low), prior = c.slice(i - 20, i)
	const vMean = mean(prior.map((z) => z.volume))
	return {
		directional: dir === 'long' ? x.close > x.open : x.close < x.open,
		stochRecovery: dir === 'long' ? stoch(c, i, 14) > .2 && stoch(c, i - 1, 14) <= .2 : stoch(c, i, 14) < .8 && stoch(c, i - 1, 14) >= .8,
		bodyContract: body(x) <= body(prev) * .85,
		mfiExtreme: dir === 'long' ? mfi(c, i, 14) < 35 : mfi(c, i, 14) > 65,
		volumeBelowMean: x.volume < vMean,
		rsiRecovery: dir === 'long' ? rsi(c, i, 14) > 35 && rsi(c, i - 1, 14) <= 35 : rsi(c, i, 14) < 65 && rsi(c, i - 1, 14) >= 65,
		stochExtreme: dir === 'long' ? stoch(c, i, 14) < .2 : stoch(c, i, 14) > .8,
		wick: dir === 'long' ? (Math.min(x.open, x.close) - x.low) / range > .5 : (x.high - Math.max(x.open, x.close)) / range > .5,
	}
}
const keys = ['directional', 'stochRecovery', 'bodyContract', 'mfiExtreme', 'volumeBelowMean', 'rsiRecovery', 'stochExtreme', 'wick'] as const
type Key = typeof keys[number]
const groups = new Map<string, Row[]>()
for (const r of positives) { const key = `${symbolById(r.id)}|${tfById(r.id)}`; groups.set(key, [...(groups.get(key) ?? []), r]) }
const rows: any[] = []
for (const [key, obs] of groups) {
	const [symbol, tf] = key.split('|'); const candles = await fetchArchiveKlines(symbol!, tf!, 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 10 })
	for (let mask = 1; mask < (1 << keys.length); mask++) {
		const selected = keys.filter((_, j) => mask & (1 << j)) as Key[]
		let hit = 0
		for (const o of obs) { const i = candles.findIndex((x) => x.timestamp === Date.parse(o.expectedAt!)); if (i < 24) continue; const f = features(candles, i, o.expected!.direction!); if (selected.every((k) => f[k])) hit++ }
		rows.push({ symbol, tf, selected, n: obs.length, hit, recall: hit / obs.length })
	}
}
const aggregate = [...rows.reduce((m, x) => {
	const key = x.selected.join('+')
	const prev = m.get(key) ?? { selected: x.selected, n: 0, hit: 0 }
	prev.n += x.n
	prev.hit += x.hit
	m.set(key, prev)
	return m
}, new Map<string, { selected: Key[]; n: number; hit: number }>())].map(([, x]) => ({ ...x, recall: x.n ? x.hit / x.n : null })).sort((a, b) => (b.recall ?? 0) - (a.recall ?? 0) || a.selected.length - b.selected.length)
const md = `# Reversal OHLCV combination scan v0.1

- Standard chart OHLCV only; no external series/outcome/future values.
- Positive exact sample: ${positives.length}.
- This is exploratory recall, not a fitted vendor formula.

| Combination | Hit | n | Recall |
|---|---:|---:|---:|
${aggregate.slice(0, 30).map((x) => `| ${x.selected.join(' + ')} | ${x.hit} | ${x.n} | ${(100 * x.recall).toFixed(1)}% |`).join('\n')}

## Interpretation

Combinations are only useful after precision is measured on matched no-signal windows and a held-out symbol/TF. No combination is promoted to production.
`
mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/reversal-ohlcv-combination-scan-v0.1.json`, JSON.stringify({ meta: { from: FROM, until: UNTIL }, rows }, null, 2)); writeFileSync(`${OUT}/reversal-ohlcv-combination-scan-v0.1.md`, md); console.log(md)
