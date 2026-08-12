import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'

type Row = { id: string; status: string; expectedAt?: string; expected?: { direction: 'long' | 'short' | null; signalPresent: boolean }; candle?: Candle }
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
const typical = (x: Candle) => (x.high + x.low + x.close) / 3
const mfi = (c: Candle[], i: number, n: number) => { const x = c.slice(Math.max(0, i - n + 1), i + 1); let p = 0, q = 0; for (let j = 1; j < x.length; j++) { const flow = typical(x[j]!) * x[j]!.volume; if (typical(x[j]!) >= typical(x[j - 1]!)) p += flow; else q += flow } return q === 0 ? 100 : 100 - 100 / (1 + p / q) }
const cci = (c: Candle[], i: number, n: number) => { const x = c.slice(Math.max(0, i - n + 1), i + 1).map(typical), m = mean(x), d = mean(x.map((z) => Math.abs(z - m))); return (c[i]!.close - m) / Math.max(1e-12, 0.015 * d) }
const ret = (c: Candle[], i: number, n: number) => c[i]!.close / c[Math.max(0, i - n)]!.close - 1
const body = (x: Candle) => Math.abs(x.close - x.open)
const z = (x: number[]) => { const m = mean(x), sd = Math.sqrt(mean(x.map((v) => (v - m) ** 2))); return (x.at(-1)! - m) / Math.max(1e-12, sd) }
const signs = (d: string) => d === 'long' ? 1 : -1

type Family = { id: string; label: string; match: (c: Candle[], i: number, dir: 'long' | 'short') => boolean }
const families: Family[] = [
	{ id: 'directional', label: 'directional candle', match: (c, i, d) => d === 'long' ? c[i]!.close > c[i]!.open : c[i]!.close < c[i]!.open },
	{ id: 'rsi-extreme', label: 'RSI14 extreme', match: (c, i, d) => d === 'long' ? rsi(c, i, 14) < 35 : rsi(c, i, 14) > 65 },
	{ id: 'rsi-recovery', label: 'RSI14 recovery', match: (c, i, d) => d === 'long' ? rsi(c, i, 14) > 35 && rsi(c, i - 1, 14) <= 35 : rsi(c, i, 14) < 65 && rsi(c, i - 1, 14) >= 65 },
	{ id: 'stoch-extreme', label: 'Stochastic14 extreme', match: (c, i, d) => d === 'long' ? stoch(c, i, 14) < .2 : stoch(c, i, 14) > .8 },
	{ id: 'stoch-recovery', label: 'Stochastic14 recovery', match: (c, i, d) => d === 'long' ? stoch(c, i, 14) > .2 && stoch(c, i - 1, 14) <= .2 : stoch(c, i, 14) < .8 && stoch(c, i - 1, 14) >= .8 },
	{ id: 'mfi-extreme', label: 'MFI14 extreme', match: (c, i, d) => d === 'long' ? mfi(c, i, 14) < 35 : mfi(c, i, 14) > 65 },
	{ id: 'cci-extreme', label: 'CCI20 extreme', match: (c, i, d) => d === 'long' ? cci(c, i, 20) < -100 : cci(c, i, 20) > 100 },
	{ id: 'range-extreme', label: 'rolling range20 extreme', match: (c, i, d) => { const x = c.slice(i - 19, i + 1); return d === 'long' ? c[i]!.close <= Math.min(...x.map((z) => z.low)) * 1.002 : c[i]!.close >= Math.max(...x.map((z) => z.high)) * .998 } },
	{ id: 'impulse-reversal', label: '12-bar impulse reversal', match: (c, i, d) => signs(d) * ret(c, i, 12) < -.003 && (d === 'long' ? c[i]!.close > c[i]!.open : c[i]!.close < c[i]!.open) },
	{ id: 'body-contraction', label: 'body contraction vs previous', match: (c, i, d) => { if (i < 1) return false; return body(c[i]!) <= body(c[i - 1]!) * .85 && (d === 'long' ? c[i]!.close > c[i]!.open : c[i]!.close < c[i]!.open) } },
	{ id: 'wick-reversal', label: 'counter-wick > 50%', match: (c, i, d) => { const x = c[i]!, r = Math.max(1e-12, x.high - x.low); return d === 'long' ? (Math.min(x.open, x.close) - x.low) / r > .5 : (x.high - Math.max(x.open, x.close)) / r > .5 } },
	{ id: 'volume-spike', label: 'volume z-score > 2', match: (c, i, d) => { const x = c.slice(Math.max(0, i - 50), i), v = c[i]!.volume; return z([...x.map((q) => q.volume), v]) > 2 } },
	{ id: 'volume-dryup', label: 'volume below mean', match: (c, i) => { const x = c.slice(Math.max(0, i - 20), i).map((q) => q.volume); return c[i]!.volume < mean(x) } },
]
const groups = new Map<string, Row[]>()
for (const r of positives) groups.set(`${symbolById(r.id)}|${tfById(r.id)}`, [...(groups.get(`${symbolById(r.id)}|${tfById(r.id)}`) ?? []), r])
const report: any[] = []
for (const [key, obs] of groups) {
	const [symbol, tf] = key.split('|')
	const candles = await fetchArchiveKlines(symbol!, tf!, 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 10 })
	for (const family of families) {
		let n = 0
		for (const o of obs) { const i = candles.findIndex((x) => x.timestamp === Date.parse(o.expectedAt!)); if (i >= 24 && family.match(candles, i, o.expected!.direction!)) n++ }
		report.push({ symbol, tf, family: family.id, label: family.label, n: obs.length, hit: n, recall: n / obs.length })
	}
}
const aggregate = families.map((f) => { const x = report.filter((r) => r.family === f.id), n = x.reduce((a, b) => a + b.n, 0), hit = x.reduce((a, b) => a + b.hit, 0); return { family: f.id, label: f.label, n, hit, recall: n ? hit / n : null } }).sort((a, b) => (b.recall ?? 0) - (a.recall ?? 0))
const md = `# Pine-compatible OHLCV trigger scan v0.1

- Inputs: chart OHLCV only; no external series and no trade outcomes.
- Positive sample: ${positives.length} exact matched events.
- This scan tests individual features only; it is not a fitted multi-factor detector.
- No production defaults changed.

| Family | Hit | n | Recall |
|---|---:|---:|---:|
${aggregate.map((x) => `| ${x.label} | ${x.hit} | ${x.n} | ${x.recall == null ? '—' : (100 * x.recall).toFixed(1) + '%'} |`).join('\n')}

## Caveat

A high recall feature is not sufficient: it may fire everywhere. Precision and matched no-signal false positives are the next gate. Thresholds here are broad diagnostic thresholds, not vendor claims.
`
mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/reversal-ohlcv-family-scan-v0.1.json`, JSON.stringify({ meta: { from: FROM, until: UNTIL, market: 'spot' }, report, aggregate }, null, 2)); writeFileSync(`${OUT}/reversal-ohlcv-family-scan-v0.1.md`, md); console.log(md)
