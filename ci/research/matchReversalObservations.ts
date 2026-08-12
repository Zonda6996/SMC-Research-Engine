import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { computeApexBands, detectReversals } from '../../src/core/signals/ApexEngine.js'
import type { Candle } from '../../src/models/price/Candle.js'

type Obs = {
	id: string
	symbol: string
	feed: string
	timeframe: string
	localAt?: string
	utcAt?: string
	localWindow?: { from: string; to: string }
	direction: 'long' | 'short' | null
	mode: 'safe' | 'risk' | 'standard'
	signalPresent: boolean
}

type Dataset = { events: Obs[] }
const input = JSON.parse(readFileSync('ci-results/reversal-observed-events-2026-07-31.json', 'utf8')) as Dataset
const OUT = process.env.OUT_DIR ?? 'ci-results'
const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const symbols = [...new Set(input.events.map((x) => x.symbol))]
const tfs = [...new Set(input.events.map((x) => x.timeframe))]
const from = Date.UTC(2026, 5, 25)
const until = Date.UTC(2026, 7, 1)
const pct = (x: number | null) => x == null || !Number.isFinite(x) ? null : Number((x * 100).toFixed(4))
const iso = (x: number | null) => x == null ? null : new Date(x).toISOString()
const atMs = (x: Obs) => x.utcAt ? Date.parse(x.utcAt) : null

const rows: any[] = []
const coverage: any[] = []
for (const symbol of symbols) {
	for (const tf of tfs.filter((x) => input.events.some((e) => e.symbol === symbol && e.timeframe === x))) {
		console.log(`load ${symbol} ${tf}`)
		const candles = await fetchArchiveKlines(symbol, tf, 'spot', from, until, { cacheDir: CACHE, parallel: 10 })
		coverage.push({ symbol, tf, bars: candles.length, from: iso(candles[0]?.timestamp ?? null), to: iso(candles.at(-1)?.timestamp ?? null) })
		const bands = computeApexBands(candles)
		const signals = detectReversals(candles)
		for (const e of input.events.filter((x) => x.symbol === symbol && x.timeframe === tf)) {
			const ts = atMs(e)
			if (ts == null) {
				rows.push({ id: e.id, status: 'unresolved', reason: 'window-only observation; no exact timestamp', signalPresent: e.signalPresent })
				continue
			}
			const i = candles.findIndex((c) => c.timestamp === ts)
			if (i < 0) {
				rows.push({ id: e.id, status: 'unresolved', reason: 'exact timestamp is outside archive coverage or feed has no matching bar', expectedAt: iso(ts), signalPresent: e.signalPresent })
				continue
			}
			const c = candles[i]!
			const b = bands[i]!
			const model = signals.filter((s) => s.at === ts)
			const localWindow = e.localWindow
			let windowSignals: typeof signals = []
			if (localWindow) {
				const lo = Date.parse(localWindow.from)
				const hi = Date.parse(localWindow.to)
				windowSignals = signals.filter((s) => s.at >= lo && s.at <= hi)
			}
			rows.push({
				id: e.id, status: 'matched', expectedAt: iso(ts), candle: c,
				candleDirection: c.close > c.open ? 'bullish' : c.close < c.open ? 'bearish' : 'flat',
				apex: Number.isFinite(b.mean) ? { mean: b.mean, redLo: b.redLo, redHi: b.redHi, greenHi: b.greenHi, greenLo: b.greenLo, distanceToMeanPct: pct(c.close / b.mean - 1), lowToOuterLowerPct: pct(c.low / b.greenLo - 1), highToOuterUpperPct: pct(c.high / b.redHi - 1) } : null,
				expected: { direction: e.direction, mode: e.mode, signalPresent: e.signalPresent },
				baselineSignalsAtBar: model,
				baselineDirectionMatch: e.direction == null ? null : model.some((s) => s.direction === e.direction),
				windowBaselineSignals: windowSignals.map((s) => ({ at: iso(s.at), direction: s.direction, close: s.close })),
			})
		}
	}
}

const matched = rows.filter((x) => x.status === 'matched')
const positive = matched.filter((x) => x.expected.signalPresent)
const exactHits = positive.filter((x) => x.baselineDirectionMatch).length
const negativeWindows = rows.filter((x) => x.expected?.signalPresent === false && x.status === 'matched')
const md = `# Reversal observations matched to Binance Spot

- Dataset: ci-results/reversal-observed-events-2026-07-31.json
- Timezone: Kazakhstan / UTC+5; all exact event times converted to UTC before matching.
- Feed: Binance Spot archive; this is a feed match attempt, not proof that TradingView used an identical internal series.
- Production defaults changed: **NO**.

## Summary

- Observations: ${rows.length}
- Exact matched bars: ${matched.length}
- Unresolved: ${rows.filter((x) => x.status !== 'matched').length}
- Positive exact events: ${positive.length}
- H0 baseline exact direction hits: ${exactHits}
- Exact hit rate: ${positive.length ? (100 * exactHits / positive.length).toFixed(1) : '—'}%
- Negative/window observations matched: ${negativeWindows.length}

## Coverage

| Symbol | TF | Bars | From | To |
|---|---:|---:|---|---|
${coverage.map((x) => `| ${x.symbol} | ${x.tf} | ${x.bars} | ${x.from ?? '—'} | ${x.to ?? '—'} |`).join('\n')}

## Interpretation

The current H0 detector is only a control. A miss does not prove the vendor formula is wrong: the screenshot may use a different feed, the label may be intrabar, or the current Apex width may be inaccurate. A hit does not prove the formula is correct. The next detector candidates must be scored against these rows plus matched no-signal windows, without using outcome fields.

## Event table

| ID | Status | Expected | Mode | Baseline | Candle | Notes |
|---|---|---|---|---|---|---|
${rows.map((x) => `| ${x.id} | ${x.status} | ${x.expected?.direction ?? (x.signalPresent ? 'signal' : 'no signal')} | ${x.expected?.mode ?? '—'} | ${x.baselineSignalsAtBar?.map((s: any) => s.direction).join(', ') || '—'} | ${x.candleDirection ?? '—'} | ${x.reason ?? (x.baselineDirectionMatch === true ? 'direction match' : x.baselineDirectionMatch === false ? 'direction mismatch' : 'window/negative')} |`).join('\n')}
`
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/reversal-observation-match-2026-07-31.json`, JSON.stringify({ meta: { from, until, market: 'spot', timezone: 'Asia/Almaty', baseline: 'H0' }, coverage, rows }, null, 2))
writeFileSync(`${OUT}/reversal-observation-match-2026-07-31.md`, md)
console.log(md)
