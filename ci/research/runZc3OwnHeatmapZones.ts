/**
 * ZC3: Nikita's OWN liquidity-heatmap zones (LiquidityHeatmapEngine from main,
 * 4h profile) as the confluence layer, OWN1 as the trigger.
 *
 * Question: does "OWN1 signal inside my own 4h liquidity zone" outperform
 * OWN1 outside zones - i.e. can Nikita's autozones replace the vendor's
 * hand-drawn ones (ZC2 showed +0.121R in-zone vs +0.048R out)?
 *
 * Zone semantics (point-in-time, causal):
 *  - pools from detectLiquidityHeatmap on 4h Gate klines (default 4h profile);
 *  - buy-side pool (long-liquidation cluster BELOW price) = LONG zone:
 *    price sweeping down into it is a discount + liquidity-grab area;
 *  - a pool counts for a signal at time T iff startAt + MIN_AGE_BARS*4h <= T
 *    and it is either still active or swept RECENTLY (sweptAt within
 *    RECENT_SWEEP_H hours before T): the engine marks a pool swept on the
 *    FIRST touch, and the liquidity grab IS the setup we are testing -
 *    requiring "not swept" would exclude every genuine sweep-reversal;
 *  - entry price inside [bandLow, bandHigh] widened by 50% of band width
 *    (entry bar open can sit just past the band after the sweep wick).
 *  KNOWN CAVEAT: pool WEIGHT is ranked over full history (engine is display-
 *  oriented); we do NOT filter by weight to avoid that look-ahead - only
 *  lifecycle (start/swept) gates, which are causal. Weight terciles are
 *  reported descriptively.
 *
 * Triggers: OWN1 bk1.5/M10/cd40 on 1h AND on 4h (reconstructed bands).
 * Exits: base machinery P25/S12 (TR55 stop) AND zone-edge stop variant
 * (stop just beyond the far edge of the matched zone, same partial/TP).
 * EXPLORATORY companion to ZC1/ZC2. Gross R, approximated bands.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import { replayVar1Trade, type Var1Config } from './runVar1ExitSweep.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, type LiquidityPool } from './lib/liquidityHeatmapEngine.js'
import type { Candle } from './lib/candleType.js'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'DOTUSDT', 'ATOMUSDT']
const START_MS = Date.UTC(2023, 0, 1)
const MIN_AGE_BARS_4H = 12          // zone must be at least 2 days old at signal time
const RECENT_SWEEP_H = 24           // swept pools stay tradable this many hours after first touch
const BAND_TOL = 0.5                // entry may sit past the band by this fraction of its width
const BASE: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
const CACHE = 'data/gate-cache'
const IV: Record<number, string> = { 60: '1h', 240: '4h' }

async function fetchSeries(symbol: string, tfMin: number): Promise<Kline[] | null> {
	mkdirSync(resolve(CACHE), { recursive: true })
	const p = resolve(CACHE, `zc3_${symbol}_${tfMin}m.json`)
	if (existsSync(p)) return (JSON.parse(readFileSync(p, 'utf8')) as { rows: Kline[] }).rows
	const pair = symbol.replace(/USDT$/u, '') + '_USDT'
	const stepSec = tfMin * 60
	const endSec = Math.floor(Date.now() / 1000)
	let fromSec = Math.floor(START_MS / 1000)
	const rows: Kline[] = []
	while (fromSec < endSec) {
		const toSec = Math.min(fromSec + 1900 * stepSec, endSec)
		const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${pair}&interval=${IV[tfMin]}&from=${fromSec}&to=${toSec}`
		let j: unknown = null
		for (let a = 0; a < 6; a++) {
			try {
				const res = await fetch(url, { headers: { Accept: 'application/json' } })
				if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (a + 1))); continue }
				if (!res.ok) { console.log(`[zc3] fetch ${symbol} ${tfMin}m HTTP ${res.status}`); break }
				j = await res.json()
				break
			} catch { await new Promise((r) => setTimeout(r, 1200 * (a + 1))) }
		}
		if (!Array.isArray(j)) { console.log(`[zc3] fetch failed chunk ${symbol} ${tfMin}m from=${fromSec}`); if (rows.length === 0) return null; break }
		for (const k of j as Array<{ t: number; o: string; h: string; l: string; c: string; v: number }>) {
			rows.push({ t: k.t * 1000, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) })
		}
		fromSec = toSec + stepSec
		await new Promise((r) => setTimeout(r, 130))
	}
	rows.sort((a, b) => a.t - b.t)
	const dedup = rows.filter((r, i) => i === 0 || r.t !== rows[i - 1]!.t)
	writeFileSync(p, JSON.stringify({ rows: dedup }))
	return dedup
}

/** Base-machinery replay but with an explicit stop PRICE (zone-edge variant). */
function replayZoneStop(rows: readonly ExactIndicatorRow[], signalIndex: number, side: CorrectedGgiSide, stopPrice: number): { outcome: string; grossR: number } | null {
	const signal = rows[signalIndex]
	const entryRow = rows[signalIndex + 1]
	if (!signal || !entryRow || !validGgiBand(signal) || !validGgiBand(entryRow)) return null
	const entry = entryRow.open
	if (side === 1 ? stopPrice >= entry : stopPrice <= entry) return null
	const riskPct = (Math.abs(entry - stopPrice) / entry) * 100
	const staticTp = side === 1 ? signal.upperInner : signal.lowerInner
	let partialDone = false
	let realised = 0
	let weight = 1
	const pnl = (to: number, w: number) => ((side * (to - entry)) / entry) * w * 100
	for (let i = signalIndex + 1; i < rows.length; i++) {
		const bar = rows[i]!
		if (!validGgiBand(bar)) continue
		if (side === 1 ? bar.low <= stopPrice : bar.high >= stopPrice) {
			return { outcome: partialDone ? 'Partial' : 'Stop', grossR: (realised + pnl(stopPrice, weight)) / riskPct }
		}
		if (!partialDone && (side === 1 ? bar.high >= bar.mean : bar.low <= bar.mean)) {
			partialDone = true
			realised += pnl(bar.mean, weight * 0.25)
			weight *= 0.75
		}
		if (side === 1 ? bar.high >= staticTp : bar.low <= staticTp) {
			return { outcome: 'Full fix', grossR: (realised + pnl(staticTp, weight)) / riskPct }
		}
	}
	return { outcome: 'End mark', grossR: NaN }
}

interface Agg { n: number; sumR: number; p: number; s: number; f: number }
const agg = (): Agg => ({ n: 0, sumR: 0, p: 0, s: 0, f: 0 })
const bump = (a: Agg, r: { outcome: string; grossR: number }) => {
	a.n++; a.sumR += r.grossR
	if (r.outcome === 'Partial') a.p++
	else if (r.outcome === 'Stop') a.s++
	else a.f++
}
const fmt = (a: Agg) => a.n === 0 ? `| 0 | - | - | - |` : `| ${a.n} | ${(a.sumR / a.n).toFixed(4)} | ${(((a.p + a.f) / a.n) * 100).toFixed(1)}% | ${a.p}/${a.s}/${a.f} |`

async function main() {
	const groups: Record<string, Agg> = {}
	const G = (k: string) => (groups[k] ??= agg())
	const inZoneRs: Record<string, number[]> = { 'tf60|tr55': [], 'tf240|tr55': [] }
	const outZoneRs: Record<string, number[]> = { 'tf60|tr55': [], 'tf240|tr55': [] }
	const samples: Array<Record<string, unknown>> = []

	for (const symbol of SYMBOLS) {
		const k4 = await fetchSeries(symbol, 240)
		if (!k4 || k4.length < 500) { console.log(`[zc3] ${symbol}: no 4h data`); continue }
		const candles: Candle[] = k4.map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
		const pools: LiquidityPool[] = detectLiquidityHeatmap(candles, heatmapConfigForTf(240 * 60_000))
		const minAgeMs = MIN_AGE_BARS_4H * 240 * 60_000
		const sweepGraceMs = RECENT_SWEEP_H * 3_600_000
		const liveAt = (t: number) => pools.filter((pl) =>
			pl.startAt + minAgeMs <= t && (pl.sweptAt == null || pl.sweptAt > t || t - pl.sweptAt <= sweepGraceMs))

		for (const tfMin of [60, 240] as const) {
			const kl = tfMin === 240 ? k4 : await fetchSeries(symbol, 60)
			if (!kl || kl.length < 400) continue
			const rows = buildRows(kl)
			const bSma = bodySma20(rows)
			const tr55 = trueRangeSma(rows, 55)
			const signals = own1Signals(rows, bSma, 1.5, 10, 0, rows.length)
			for (const sig of signals) {
				const bar = rows[sig.idx]!
				const entryRow = rows[sig.idx + 1]
				if (!entryRow || !Number.isFinite(bar.mean)) continue
				const t = replayVar1Trade(rows, tr55, sig.idx, sig.side, BASE)
				if (!t || t.outcome === 'End mark') continue
				const sigTime = bar.timestamp + tfMin * 60_000
				const entry = entryRow.open
				const wantSide = sig.side === 1 ? 'buy-side' : 'sell-side'
				const zone = liveAt(sigTime).find((pl) => {
					if (pl.side !== wantSide) return false
					const bw = pl.bandHigh - pl.bandLow
					return entry >= pl.bandLow - BAND_TOL * bw && entry <= pl.bandHigh + BAND_TOL * bw
				})
				const zkey = zone ? 'in' : 'out'
				bump(G(`${zkey}|tf${tfMin}|tr55`), t)
				;(zone ? inZoneRs : outZoneRs)[`tf${tfMin}|tr55`]!.push(t.grossR)
				if (zone) {
					// weight tercile (descriptive only - global-rank caveat)
					const terc = zone.weight >= 2 / 3 ? 'w-top' : zone.weight >= 1 / 3 ? 'w-mid' : 'w-low'
					bump(G(`in|tf${tfMin}|tr55|${terc}`), t)
					// zone-edge stop: beyond far edge by 10% of band width
					const bw = zone.bandHigh - zone.bandLow
					const stopPrice = sig.side === 1 ? zone.bandLow - 0.1 * bw : zone.bandHigh + 0.1 * bw
					const tz = replayZoneStop(rows, sig.idx, sig.side, stopPrice)
					if (tz && tz.outcome !== 'End mark') bump(G(`in|tf${tfMin}|zone-stop`), tz)
					if (samples.length < 400) samples.push({ symbol, tfMin, side: sig.side, date: new Date(sigTime).toISOString(), grossR: t.grossR, outcome: t.outcome, zoneStopR: tz?.grossR ?? null, zoneW: zone.weight.toFixed(2), band: `${zone.bandLow.toPrecision(5)}-${zone.bandHigh.toPrecision(5)}` })
				}
			}
		}
		console.log(`[zc3] ${symbol} done (pools=${pools.length})`)
	}

	const md: string[] = []
	md.push('# ZC3 - OWN1 inside Nikita own 4h liquidity-heatmap zones')
	md.push('')
	md.push(`Symbols: ${SYMBOLS.join(', ')}. Since 2023-01-01, Gate futures klines.`)
	md.push(`Zones: LiquidityHeatmapEngine (main, 4h profile), age >= ${MIN_AGE_BARS_4H} bars, active OR swept within ${RECENT_SWEEP_H}h (sweep IS the setup), entry within band +- ${BAND_TOL * 100}% width. No weight filter (global-rank caveat).`)
	md.push('Trigger OWN1 bk1.5/M10/cd40; machinery base P25/S12; zone-stop = far band edge + 10% width.')
	md.push('')
	md.push('| group | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const k of Object.keys(groups).sort()) md.push(`| ${k} ${fmt(groups[k]!)}`)
	md.push('')
	md.push('## Sample in-zone trades (first 400)')
	md.push('')
	md.push('| date | symbol | tf | side | R(tr55) | R(zone-stop) | outcome | zoneW | band |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const s of samples) md.push(`| ${String(s.date).slice(0, 16)} | ${s.symbol} | ${s.tfMin} | ${s.side === 1 ? 'L' : 'S'} | ${Number(s.grossR).toFixed(3)} | ${s.zoneStopR == null ? '-' : Number(s.zoneStopR).toFixed(3)} | ${s.outcome} | ${s.zoneW} | ${s.band} |`)
	writeFileSync(resolve('ci-results/zc3-own-heatmap-zones.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/zc3-own-heatmap-zones.json'), JSON.stringify({ groups, samples }, null, 1))
	for (const k of Object.keys(groups).sort()) { const a = groups[k]!; console.log(`[zc3] ${k}: n=${a.n} meanR=${a.n ? (a.sumR / a.n).toFixed(4) : '-'}`) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
