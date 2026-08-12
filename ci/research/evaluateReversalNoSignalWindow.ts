import { mkdirSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance', OUT = process.env.OUT_DIR ?? 'ci-results'
const FROM = Date.UTC(2026, 6, 18), UNTIL = Date.UTC(2026, 6, 23)
const c = await fetchArchiveKlines('SOLUSDT', '5m', 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 10 })
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN
const rsi = (i: number, n = 14) => { const a: number[] = []; for (let j = Math.max(1, i - n + 1); j <= i; j++) a.push(c[j]!.close / c[j - 1]!.close - 1); const u = mean(a.map((x) => Math.max(0, x))), d = mean(a.map((x) => Math.max(0, -x))); return d === 0 ? 100 : 100 - 100 / (1 + u / d) }
const stoch = (i: number, n = 14) => { const a = c.slice(Math.max(0, i - n + 1), i + 1), lo = Math.min(...a.map((x) => x.low)), hi = Math.max(...a.map((x) => x.high)); return (c[i]!.close - lo) / Math.max(1e-12, hi - lo) }
const typ = (x: Candle) => (x.high + x.low + x.close) / 3
const mfi = (i: number, n = 14) => { const a = c.slice(Math.max(0, i - n + 1), i + 1); let p = 0, q = 0; for (let j = 1; j < a.length; j++) { const f = typ(a[j]!) * a[j]!.volume; if (typ(a[j]!) >= typ(a[j - 1]!)) p += f; else q += f } return q === 0 ? 100 : 100 - 100 / (1 + p / q) }
const body = (x: Candle) => Math.abs(x.close - x.open)
const candidates = (lo: number, hi: number) => {
	const rows: any[] = []
	for (let i = 24; i < c.length; i++) {
		const x = c[i]!; if (x.timestamp < lo || x.timestamp > hi) continue
		for (const dir of ['long', 'short'] as const) {
			const directional = dir === 'long' ? x.close > x.open : x.close < x.open
			const stochRecovery = dir === 'long' ? stoch(i) > .2 && stoch(i - 1) <= .2 : stoch(i) < .8 && stoch(i - 1) >= .8
			const bodyContract = body(x) <= body(c[i - 1]!) * .85
			const mfiExtreme = dir === 'long' ? mfi(i) < 35 : mfi(i) > 65
			const volumeBelowMean = x.volume < mean(c.slice(i - 20, i).map((z) => z.volume))
			const rsiRecovery = dir === 'long' ? rsi(i) > 35 && rsi(i - 1) <= 35 : rsi(i) < 65 && rsi(i - 1) >= 65
			rows.push({ at: x.timestamp, dir, directional, stochRecovery, bodyContract, mfiExtreme, volumeBelowMean, rsiRecovery, rsi14: rsi(i), stochastic14: stoch(i), mfi14: mfi(i) })
		}
	}
	return rows
}
const windows = [
	{ id: 'full-local-days', label: '20–21 July, Kazakhstan calendar days', lo: Date.parse('2026-07-19T19:00:00Z'), hi: Date.parse('2026-07-21T18:59:59Z') },
	{ id: 'visible-chart-estimate', label: 'Approximate chart-visible segment 19 July 12:00 → 20 July 21:00 Kazakhstan', lo: Date.parse('2026-07-19T07:00:00Z'), hi: Date.parse('2026-07-20T16:00:00Z') },
]
const combos = [
	['directional'],
	['directional', 'stochRecovery'],
	['directional', 'bodyContract'],
	['directional', 'mfiExtreme'],
	['directional', 'volumeBelowMean'],
	['directional', 'rsiRecovery'],
	['directional', 'stochRecovery', 'bodyContract'],
	['directional', 'stochRecovery', 'volumeBelowMean'],
	['directional', 'bodyContract', 'mfiExtreme'],
] as const
const results = windows.map((w) => {
	const rows = candidates(w.lo, w.hi)
	return { ...w, bars: rows.length / 2, rows, counts: combos.map((combo) => ({ combo, count: rows.filter((r) => combo.every((k) => r[k])).length, per100Bars: rows.length ? 200 * rows.filter((r) => combo.every((k) => r[k])).length / rows.length : 0 })) }
})
const md = `# Reversal SOL 5m no-signal window sensitivity v0.1

- User statement: no Reversal signals on the shown SOL 5m segment around 20–21 July 2026.
- Screenshot boundaries are not exact; therefore two plausible windows are reported separately.
- Every counted trigger would be a false positive if the whole respective window truly had no vendor signal.
- Standard chart OHLCV only; no external data.

${results.map((r) => `## ${r.label}\n\n- Bars: ${r.bars}\n\n| Candidate | Fires | Per 100 bars |\n|---|---:|---:|\n${r.counts.map((x) => `| ${x.combo.join(' + ')} | ${x.count} | ${x.per100Bars.toFixed(2)} |`).join('\n')}`).join('\n\n')}

## Interpretation

Any single-bar family that fires dozens of times in this no-signal window is structurally too weak, regardless of positive recall. The next viable detector must add a rarer multi-bar state: prior displacement/extreme, oscillator recovery, expiry/re-arm, and directional confirmation. Exact screenshot boundaries are still needed before declaring precision numerically.
`
mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/reversal-sol-no-signal-window-v0.1.json`, JSON.stringify({ meta: { symbol: 'SOLUSDT', tf: '5m', market: 'spot', source: 'approximate screenshot window' }, results }, null, 2)); writeFileSync(`${OUT}/reversal-sol-no-signal-window-v0.1.md`, md); console.log(md)
