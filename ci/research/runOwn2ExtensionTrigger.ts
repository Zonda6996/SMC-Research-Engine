/**
 * OWN2: extension-based trigger built from REV1 findings + Nikita's field
 * observations of the vendor's behaviour:
 *  - RAW condition (REV1): close beyond/near the outer band with the bar
 *    extended from Mean on a volume spike - NOT a big-body pattern:
 *      pen >= PEN_MIN   (close within 0.35 half-widths of the band or beyond)
 *      distMean >= DIST_MIN(3%)  AND  volRatio >= VOL_MIN(1.4)
 *  - TRADE-STATE COOLDOWN (Nikita: "сигнал не может появиться пока предыдущий
 *    активен, и после стопа/тейка тоже не сразу"): a new signal in EITHER
 *    direction is suppressed while the previous trade is open, plus
 *    POST_EXIT_BARS quiet bars after it closes.
 * Tests:
 *  1. RECALL vs FWD1 forward arrows (did we get closer to 692 arrows than
 *     OWN1's 20.5%?) + acceptance (how much do we overfire?).
 *  2. Standalone economics on FWD1 series (P25/S12 machinery, all bars).
 *  3. ZC5-style causal zone confluence (SELECTIVE rule) with OWN2 as trigger.
 * Params fixed a priori from REV1 medians. One run, no sweeps.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma } from './lib/ggiCorrectedReplay.js'
import { replayVar1Trade, type Var1Config } from './runVar1ExitSweep.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, type LiquidityPool } from './lib/liquidityHeatmapEngine.js'
import type { Candle } from './lib/candleType.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

const PEN_MIN = -0.35      // close within 0.35 half-widths of band (negative = not yet at band)
const DIST_MIN = 3.0       // % from Mean
const VOL_MIN = 1.4        // volume vs 20-bar avg
const POST_EXIT_BARS = 5   // quiet bars after a trade closes
const BASE: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
interface FwdTrade { symbol: string; tfMin: number; side: 1 | -1; timeMs: number }

export interface Own2Signal { idx: number; side: 1 | -1 }

/** OWN2 signal generator WITHOUT trade-state (raw condition only). */
export function own2Raw(rows: readonly ExactIndicatorRow[]): Own2Signal[] {
	const out: Own2Signal[] = []
	for (let i = 21; i < rows.length; i++) {
		const r = rows[i]!
		if (!Number.isFinite(r.mean) || !Number.isFinite(r.upperInner) || !Number.isFinite(r.lowerInner) || r.mean <= 0) continue
		let volSum = 0, volN = 0
		for (let k = i - 20; k < i; k++) { volSum += rows[k]!.volume; volN++ }
		const volRatio = volSum > 0 ? r.volume / (volSum / volN) : 0
		if (volRatio < VOL_MIN) continue
		const distMeanPct = (Math.abs(r.close - r.mean) / r.mean) * 100
		if (distMeanPct < DIST_MIN) continue
		for (const side of [1, -1] as const) {
			const half = side === 1 ? r.mean - r.lowerInner : r.upperInner - r.mean
			if (half <= 0) continue
			const band = side === 1 ? r.lowerInner : r.upperInner
			const pen = side === 1 ? (band - r.close) / half : (r.close - band) / half
			// extension must be on the correct side of Mean for a reversal signal
			const correctSide = side === 1 ? r.close < r.mean : r.close > r.mean
			if (correctSide && pen >= PEN_MIN) out.push({ idx: i, side })
		}
	}
	return out
}

/** Apply trade-state cooldown: no signal while trade open + N bars after exit. */
export function own2WithState(rows: readonly ExactIndicatorRow[], tr55: readonly number[], raw: readonly Own2Signal[]): Own2Signal[] {
	const out: Own2Signal[] = []
	let blockedUntil = -1
	for (const s of raw) {
		if (s.idx <= blockedUntil) continue
		const t = replayVar1Trade(rows, tr55, s.idx, s.side, BASE)
		out.push(s)
		if (t && t.exitIndex != null) blockedUntil = t.exitIndex + POST_EXIT_BARS
		else blockedUntil = rows.length // trade never closed - block to end
	}
	return out
}

interface Agg { n: number; sumR: number; p: number; s: number; f: number }
const agg = (): Agg => ({ n: 0, sumR: 0, p: 0, s: 0, f: 0 })
const bump = (a: Agg, r: { outcome: string; grossR: number }) => {
	a.n++; a.sumR += r.grossR
	if (r.outcome === 'Partial') a.p++
	else if (r.outcome === 'Stop') a.s++
	else a.f++
}

async function main() {
	const trades = (JSON.parse(readFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), 'utf8')) as { trades: FwdTrade[] }).trades

	// ---- Part 1+2: recall vs forward arrows + standalone economics on FWD1 series
	let both = 0, ggiOnly = 0, ownOnly = 0
	const econAll = agg()
	const econPerMonth: number[] = []
	const files = readdirSync(resolve('data/gate-cache')).filter((f) => /^[A-Z0-9]+_(60|120)m\.json$/u.test(f))
	for (const file of files) {
		const m = /^([A-Z0-9]+)_(\d+)m\.json$/u.exec(file)!
		const symbol = m[1]!
		const tfMin = Number(m[2]!)
		const ggi = trades.filter((t) => t.symbol === symbol && t.tfMin === tfMin)
		if (ggi.length === 0) continue
		const klines = (JSON.parse(readFileSync(resolve('data/gate-cache', file), 'utf8')) as { rows: Kline[] }).rows
		if (klines.length < 300) continue
		const rows = buildRows(klines)
		const tr55 = trueRangeSma(rows, 55)
		const sigs = own2WithState(rows, tr55, own2Raw(rows))
		const tfMs = tfMin * 60_000
		const idxByOpen = new Map<number, number>()
		for (let i = 0; i < rows.length; i++) idxByOpen.set(rows[i]!.timestamp, i)
		const ggiIdx: Array<{ idx: number; side: 1 | -1 }> = []
		for (const g of ggi) {
			const openT = Math.floor(g.timeMs / tfMs) * tfMs - tfMs
			const idx = idxByOpen.get(openT)
			if (idx != null) ggiIdx.push({ idx, side: g.side })
		}
		const matched = new Set<number>()
		for (const s of sigs) {
			const g = ggiIdx.find((x) => Math.abs(x.idx - s.idx) <= 2 && x.side === s.side)
			if (g) { both++; matched.add(g.idx) } else ownOnly++
			const t = replayVar1Trade(rows, tr55, s.idx, s.side, BASE)
			if (t && t.outcome !== 'End mark') bump(econAll, t)
		}
		ggiOnly += ggiIdx.filter((g) => !matched.has(g.idx)).length
		const spanMonths = (rows[rows.length - 1]!.timestamp - rows[0]!.timestamp) / (30 * 86_400_000)
		if (spanMonths > 1) econPerMonth.push(sigs.length / spanMonths)
	}

	// ---- Part 3: ZC5 causal zone confluence with OWN2
	const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'DOTUSDT', 'ATOMUSDT']
	const cfg4h = heatmapConfigForTf(240 * 60_000)
	const MIN_AGE_MS = 12 * 240 * 60_000
	const GRACE_MS = 24 * 3_600_000
	const zoneGroups: Record<string, Agg> = {}
	const ZG = (k: string) => (zoneGroups[k] ??= agg())
	const selectiveTrades: Array<Record<string, unknown>> = []
	const rSel: number[] = []
	const rOut: number[] = []
	let zc5Total = 0
	const load = (sym: string, tf: number): Kline[] | null => {
		try { return (JSON.parse(readFileSync(resolve('data/gate-cache', `zc4_${sym}_${tf}m.json`), 'utf8')) as { rows: Kline[] }).rows } catch { return null }
	}
	for (const symbol of SYMBOLS) {
		const k4 = load(symbol, 240)
		const k1 = load(symbol, 60)
		if (!k4 || !k1 || k4.length < 500 || k1.length < 400) continue
		const candles4: Candle[] = k4.map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
		const rows = buildRows(k1)
		const tr55 = trueRangeSma(rows, 55)
		const sigs = own2WithState(rows, tr55, own2Raw(rows))
		let lastPrefixLen = -1
		let pools: LiquidityPool[] = []
		for (const sig of sigs) {
			const bar = rows[sig.idx]!
			const entryRow = rows[sig.idx + 1]
			if (!entryRow || !Number.isFinite(bar.mean)) continue
			const t = replayVar1Trade(rows, tr55, sig.idx, sig.side, BASE)
			if (!t || t.outcome === 'End mark') continue
			zc5Total++
			const T = bar.timestamp + 3_600_000
			let prefixLen = 0
			while (prefixLen < candles4.length && candles4[prefixLen]!.timestamp + 240 * 60_000 <= T) prefixLen++
			if (prefixLen < 300) { bump(ZG('out'), t); rOut.push(t.grossR); continue }
			if (prefixLen !== lastPrefixLen) { pools = detectLiquidityHeatmap(candles4.slice(0, prefixLen), cfg4h); lastPrefixLen = prefixLen }
			const entry = entryRow.open
			const want = sig.side === 1 ? 'buy-side' : 'sell-side'
			const alive = pools.filter((pl) => pl.side === want && pl.startAt + MIN_AGE_MS <= T && (pl.sweptAt == null || T - pl.sweptAt <= GRACE_MS))
			const inBand = (pl: LiquidityPool, tol: number) => {
				const bw = pl.bandHigh - pl.bandLow
				return entry >= pl.bandLow - tol * bw && entry <= pl.bandHigh + tol * bw
			}
			const hit = alive.find((pl) => inBand(pl, 0.5))
			if (!hit) { bump(ZG('out'), t); rOut.push(t.grossR); continue }
			bump(ZG('in-any'), t)
			let below = 0
			for (const p of alive) if (p !== hit && p.notional < hit.notional) below++
			const rank = alive.length <= 1 ? 0.5 : below / (alive.length - 1)
			const sweptRecently = hit.sweptAt != null && T - hit.sweptAt <= GRACE_MS
			if (rank < 2 / 3 && inBand(hit, 0) && sweptRecently) {
				bump(ZG('SELECTIVE'), t)
				rSel.push(t.grossR)
				selectiveTrades.push({ symbol, side: sig.side, date: new Date(T).toISOString(), grossR: t.grossR, outcome: t.outcome, rank: rank.toFixed(2) })
			}
		}
	}
	const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
	let pSel = NaN
	if (rSel.length >= 5 && rOut.length >= 5) {
		const outMean = mean(rOut)
		let le = 0
		for (let b = 0; b < 10000; b++) {
			let s = 0
			for (let i = 0; i < rSel.length; i++) s += rSel[(Math.random() * rSel.length) | 0]!
			if (s / rSel.length <= outMean) le++
		}
		pSel = le / 10000
	}

	const md: string[] = []
	md.push('# OWN2 - extension trigger (REV1 params) + trade-state cooldown (Nikita observation)')
	md.push('')
	md.push(`Raw condition: correct side of Mean, pen >= ${PEN_MIN} half-widths, distMean >= ${DIST_MIN}%, volRatio >= ${VOL_MIN}. State: no signal while trade open + ${POST_EXIT_BARS} bars after exit. Params from REV1 medians, fixed a priori.`)
	md.push('')
	md.push('## 1. Recall vs forward GGI arrows (1h/2h FWD1 series)')
	md.push('')
	md.push(`BOTH ${both}, GGI-only ${ggiOnly}, OWN2-only ${ownOnly}.`)
	md.push(`Recall: ${((both / (both + ggiOnly)) * 100).toFixed(1)}% (OWN1 was 20.5%). Acceptance: ${((both / (both + ownOnly)) * 100).toFixed(1)}%.`)
	md.push(`Signal rate: median ${econPerMonth.sort((a, b) => a - b)[Math.floor(econPerMonth.length / 2)]?.toFixed(1)} signals/month/series (GGI ~2-3).`)
	md.push('')
	md.push('## 2. Standalone economics on FWD1 series (P25/S12, gross)')
	md.push('')
	md.push(`n=${econAll.n}, mean R ${(econAll.sumR / econAll.n).toFixed(4)}, WR ${(((econAll.p + econAll.f) / econAll.n) * 100).toFixed(1)}%, P/S/F ${econAll.p}/${econAll.s}/${econAll.f}`)
	md.push('')
	md.push('## 3. ZC5 causal zone confluence with OWN2 trigger (12 majors, 14m)')
	md.push('')
	md.push('| group | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const [k, a] of Object.entries(zoneGroups)) md.push(`| ${k} | ${a.n} | ${a.n ? (a.sumR / a.n).toFixed(4) : '-'} | ${a.n ? (((a.p + a.f) / a.n) * 100).toFixed(1) : '-'}% | ${a.p}/${a.s}/${a.f} |`)
	md.push('')
	md.push(`Total signals ${zc5Total}. SELECTIVE pass rate ${zc5Total ? ((rSel.length / zc5Total) * 100).toFixed(1) : '-'}%. Bootstrap P(SELECTIVE <= out): ${Number.isFinite(pSel) ? pSel.toFixed(4) : 'n/a'}.`)
	md.push('')
	md.push('## SELECTIVE trades')
	md.push('')
	md.push('| date | symbol | side | R | outcome | rank |')
	md.push('|---|---|---|---|---|---|')
	for (const s of selectiveTrades) md.push(`| ${String(s.date).slice(0, 16)} | ${s.symbol} | ${s.side === 1 ? 'L' : 'S'} | ${Number(s.grossR).toFixed(3)} | ${s.outcome} | ${s.rank} |`)
	writeFileSync(resolve('ci-results/own2-extension-trigger.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/own2-extension-trigger.json'), JSON.stringify({ recall: { both, ggiOnly, ownOnly }, econAll, zoneGroups, selectiveTrades, pSel }, null, 1))
	console.log(md.slice(0, 26).join('\n'))
	for (const [k, a] of Object.entries(zoneGroups)) console.log(`[own2] zone ${k}: n=${a.n} meanR=${a.n ? (a.sumR / a.n).toFixed(4) : '-'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
