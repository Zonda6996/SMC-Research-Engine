import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'

type Row = {
	id: string
	status: string
	expectedAt?: string
	expected?: { direction: 'long' | 'short' | null; mode: 'safe' | 'risk' | 'standard'; signalPresent: boolean }
	candle?: Candle
}
type Match = { rows: Row[] }
const match = JSON.parse(readFileSync('ci-results/reversal-observation-match-2026-07-31.json', 'utf8')) as Match
const rows = match.rows.filter((x) => x.status === 'matched' && x.expectedAt && x.expected?.signalPresent && x.expected.direction && x.candle)
const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const FROM = Date.UTC(2026, 5, 25), UNTIL = Date.UTC(2026, 7, 1)
const tfById = (id: string) => id.startsWith('btc') ? (id.includes('12') || id.includes('13') ? '15m' : '1h') : id.startsWith('eth') ? '1h' : id.includes('30m') ? '30m' : '5m'
const symbolById = (id: string) => id.startsWith('btc') ? 'BTCUSDT' : id.startsWith('eth') ? 'ETHUSDT' : 'SOLUSDT'
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN
const std = (x: number[]) => { const m = mean(x); return Math.sqrt(mean(x.map((v) => (v - m) ** 2))) }
const pct = (x: number) => Number.isFinite(x) ? Number((100 * x).toFixed(4)) : null
const rankPct = (x: number[], v: number) => x.length ? x.filter((z) => z <= v).length / x.length : NaN
const slope = (x: number[]) => x.length >= 2 ? (x.at(-1)! - x[0]!) / (x.length - 1) : NaN
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function calc(candles: Candle[], i: number) {
	const c = candles[i]!
	const prev = candles[i - 1]
	const look = (n: number) => candles.slice(Math.max(0, i - n + 1), i + 1)
	const closes = (n: number) => look(n).map((x) => x.close)
	const returns = (n: number) => { const x = closes(n); return x.slice(1).map((v, j) => v / x[j]! - 1) }
	const ranges = (n: number) => look(n).map((x) => x.high - x.low)
	const tr = (x: Candle, j: number) => j === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - candles[j - 1]!.close), Math.abs(x.low - candles[j - 1]!.close))
	const trs = look(100).map((x) => tr(x, candles.indexOf(x)))
	const volumes = look(50).map((x) => x.volume)
	const body = Math.abs(c.close - c.open)
	const range = Math.max(1e-12, c.high - c.low)
	const upperWick = c.high - Math.max(c.open, c.close)
	const lowerWick = Math.min(c.open, c.close) - c.low
	const rsi = (n: number) => {
		const rs = returns(n).map((x) => ({ up: Math.max(0, x), down: Math.max(0, -x) }))
		const up = mean(rs.map((x) => x.up)), down = mean(rs.map((x) => x.down))
		return down === 0 ? 100 : 100 - 100 / (1 + up / down)
	}
	const stochastic = (n: number) => { const x = look(n); const lo = Math.min(...x.map((z) => z.low)), hi = Math.max(...x.map((z) => z.high)); return (c.close - lo) / Math.max(1e-12, hi - lo) }
	const mfi = (n: number) => {
		const x = look(n); const typical = x.map((z) => (z.high + z.low + z.close) / 3); let pos = 0, neg = 0
		for (let j = 1; j < x.length; j++) { const flow = typical[j]! * x[j]!.volume; if (typical[j]! >= typical[j - 1]!) pos += flow; else neg += flow }
		return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
	}
	const cci = (n: number) => { const x = look(n).map((z) => (z.high + z.low + z.close) / 3); const m = mean(x); const dev = mean(x.map((z) => Math.abs(z - m))); return (c.close - m) / Math.max(1e-12, 0.015 * dev) }
	const roc = (n: number) => { const x = candles[Math.max(0, i - n)]!.close; return c.close / x - 1 }
	const atr = (n: number) => mean(trs.slice(-n))
	const atrNow = atr(14)
	const atrBase = mean(trs.slice(-50, -14))
	const rangeValues = look(50).map((z) => z.close)
	const bands = computeApexBands(candles)[i]!
	const distanceMean = Number.isFinite(bands.mean) ? c.close / bands.mean - 1 : NaN
	const width = Number.isFinite(bands.mean) ? bands.mean * bands.s : NaN
	const prevClose = prev?.close ?? c.close
	const volM = mean(volumes), volSd = std(volumes)
	return {
		id: '', index: i, timestamp: c.timestamp, direction: c.close > c.open ? 'bullish' : c.close < c.open ? 'bearish' : 'flat',
		bodyToRange: body / range, upperWickToRange: upperWick / range, lowerWickToRange: lowerWick / range,
		closeLocation: (c.close - c.low) / range, gapPct: c.open / prevClose - 1,
		return1: c.close / prevClose - 1, return3: roc(3), return6: roc(6), return12: roc(12),
		bodyChange: prev ? body / Math.max(1e-12, Math.abs(prev.close - prev.open)) : NaN,
		closeVsHigh20: rankPct(look(20).map((z) => z.high), c.close), closeVsLow20: rankPct(look(20).map((z) => z.low), c.close),
		rsi7: rsi(7), rsi14: rsi(14), rsi21: rsi(21), stochastic14: stochastic(14), stochastic28: stochastic(28), mfi14: mfi(14), cci20: cci(20),
		atr14Pct: atrNow / c.close, atrRatio: atrNow / Math.max(1e-12, atrBase), volumeZ50: (c.volume - volM) / Math.max(1e-12, volSd),
		volumeRatio20: c.volume / Math.max(1e-12, mean(look(20).slice(0, -1).map((z) => z.volume))), obvSlope12: slope(look(12).map((z, j) => j === 0 ? 0 : z.close >= look(12)[j - 1]!.close ? z.volume : -z.volume)),
		closeSlope12: slope(closes(12)), closeSlope24: slope(closes(24)), returnStd20: std(returns(20)),
		apexDistanceMean: distanceMean, apexWidthPct: width / c.close, apexLongOuterPenetration: Number.isFinite(bands.greenLo) ? (bands.greenLo - c.low) / c.close : NaN, apexShortOuterPenetration: Number.isFinite(bands.redHi) ? (c.high - bands.redHi) / c.close : NaN,
	}
}

const grouped = new Map<string, Row[]>()
for (const r of rows) grouped.set(`${symbolById(r.id)}|${tfById(r.id)}`, [...(grouped.get(`${symbolById(r.id)}|${tfById(r.id)}`) ?? []), r])
const out: any[] = []
for (const [key, observations] of grouped) {
	const [symbol, tf] = key.split('|')
	const candles = await fetchArchiveKlines(symbol!, tf!, 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 10 })
	for (const r of observations) {
		const i = candles.findIndex((x) => x.timestamp === Date.parse(r.expectedAt!))
		if (i < 24) continue
		const x: any = calc(candles, i); x.id = r.id; x.expectedDirection = r.expected!.direction; x.mode = r.expected!.mode; x.offsetBars = 0
		const prior = candles.slice(Math.max(0, i - 24), i)
		x.lookback = { bars: prior.length, bullishShare: prior.filter((z) => z.close > z.open).length / Math.max(1, prior.length), return24: candles[i]!.close / prior[0]!.close - 1, high24: Math.max(...prior.map((z) => z.high)), low24: Math.min(...prior.map((z) => z.low)) }
		out.push(x)
	}
}
const features = Object.keys(out[0] ?? {}).filter((x) => !['id', 'index', 'timestamp', 'direction', 'expectedDirection', 'mode', 'offsetBars', 'lookback'].includes(x))
const rowsMd = out.map((x) => `| ${x.id} | ${x.expectedDirection} | ${x.mode} | ${x.rsi14?.toFixed(1)} | ${x.stochastic14?.toFixed(3)} | ${x.mfi14?.toFixed(1)} | ${x.cci20?.toFixed(1)} | ${pct(x.return12)}% | ${pct(x.volumeZ50)} | ${pct(x.apexDistanceMean)}% | ${pct(x.apexLongOuterPenetration)}% | ${pct(x.apexShortOuterPenetration)}% |`).join('\n')
const md = `# Reversal OHLCV fingerprint v0.1

- Only standard chart OHLCV is used: no external data, no outcome, no future bars.
- Feed: Binance Spot archives.
- Positive events matched: ${out.length}.
- This is a feature fingerprint, not a fitted detector.

## Signal-bar feature table

| ID | Dir | Mode | RSI14 | Stoch14 | MFI14 | CCI20 | ROC12 | VolZ50 | Apex mean dist | Long outer pen | Short outer pen |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rowsMd}

## Candidate families to test next

1. **Momentum recovery:** prior RSI/Stoch/MFI extreme followed by recovery and directional candle.
2. **Exhaustion candle:** body contraction, wick asymmetry and close location after a 6–24 bar impulse.
3. **Rolling-range reversal:** signal near a 20–50 bar extreme, but not necessarily at Apex outer edge.
4. **Volume confirmation:** volume spike or volume contraction during a failed continuation.
5. **Divergence:** price extreme versus oscillator extreme using only confirmed prior swings; no future pivot labels.
6. **Delayed pivot family:** explicit separation between a causal signal and a visually back-shifted Pine label.

No candidate is promoted without matched no-signal bars and OOS validation.
`
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/reversal-ohlcv-fingerprint-v0.1.json`, JSON.stringify({ meta: { market: 'spot', from: FROM, until: UNTIL, features }, rows: out }, null, 2))
writeFileSync(`${OUT}/reversal-ohlcv-fingerprint-v0.1.md`, md)
console.log(md)
