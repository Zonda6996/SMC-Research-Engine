/**
 * GEO1: replay of REAL vendor arrows (FWD1 telegram, non-repaintable) through
 * the CONFIRMED trade geometry from SPEC "Геометрия сделки - подтверждена
 * трижды" (~line 1317) + simulator findings from Nikita's DOGE 5m session:
 *
 *   entry: next bar open after the signal bar
 *   add  : entry -/+ step, filled if touched
 *   stop : 2*add - entry (mirror). Confirmed <3% on 3 samples.
 *   safe/risk differ ONLY in step length, ratio safe/risk = 1.46 (TRX 2h A/B).
 *   fix25: dynamic = Mean line, re-read every closed bar; 25% off at touch.
 *   TP   : dynamic = near edge of the OPPOSITE outer zone (inner band line).
 *   BE rule (author): after partial, if fix25 level goes through entry,
 *   exit remaining at breakeven at first opportunity.
 *   avg entry = (entry+add)/2 when add filled; planned risk = 1.5*step.
 *   Stat semantics (DOGE 5m simulator proof): partial-then-stop counts as
 *   PARTIAL (win) in the vendor table, Stop row = clean stops only.
 *
 * Unknown: what sets the step. Chosen (stated openly): add sits at the
 * MIDPOINT of the entry-side outer zone at signal time (mid-green on
 * screenshots). safe = that step; risk = step / 1.46.
 * EXPLORATORY - geometry fixed from spec, one run, no sweeps.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
interface FwdTrade { symbol: string; tfMin: number; side: 1 | -1; timeMs: number }

type Outcome = 'Stop' | 'Partial-then-stop' | 'Partial-then-BE' | 'Full fix' | 'Open'
interface GeoResult { outcome: Outcome; grossR: number; addFilled: boolean; bars: number }

function replayGeo(rows: readonly ExactIndicatorRow[], sigIdx: number, side: 1 | -1, stepFrac: number): GeoResult | null {
	const sig = rows[sigIdx]!
	const e = rows[sigIdx + 1]
	if (!e || !Number.isFinite(sig.mean) || !Number.isFinite(sig.upperInner) || !Number.isFinite(sig.lowerInner) || !Number.isFinite(sig.upperOuter) || !Number.isFinite(sig.lowerOuter)) return null
	const entry = e.open
	const zoneNear = side === 1 ? sig.lowerInner : sig.upperInner
	const zoneFar = side === 1 ? sig.lowerOuter : sig.upperOuter
	const addLevel0 = zoneNear + (zoneFar - zoneNear) * stepFrac
	const step = Math.abs(entry - addLevel0)
	if (step <= 0) return null
	const add = side === 1 ? entry - step : entry + step
	const stop = side === 1 ? entry - 2 * step : entry + 2 * step
	let addFilled = false
	let partialDone = false
	let realized = 0
	let weight = 1
	let avgEntry = entry
	const plannedRisk = 1.5 * step
	for (let i = sigIdx + 1; i < rows.length; i++) {
		const r = rows[i]!
		const fix25 = r.mean
		const tp = side === 1 ? r.upperInner : r.lowerInner
		if (!addFilled && (side === 1 ? r.low <= add : r.high >= add)) {
			addFilled = true
			avgEntry = (entry + add) / 2
			weight = 2
		}
		if (side === 1 ? r.low <= stop : r.high >= stop) {
			const pnl = (side === 1 ? stop - avgEntry : avgEntry - stop) * weight
			return { outcome: partialDone ? 'Partial-then-stop' : 'Stop', grossR: (realized + pnl) / plannedRisk, addFilled, bars: i - sigIdx }
		}
		if (!partialDone && Number.isFinite(fix25) && (side === 1 ? r.high >= fix25 : r.low <= fix25)) {
			realized += (side === 1 ? fix25 - avgEntry : avgEntry - fix25) * weight * 0.25
			weight *= 0.75
			partialDone = true
		}
		if (partialDone && Number.isFinite(fix25) && (side === 1 ? fix25 < avgEntry : fix25 > avgEntry)) {
			if (side === 1 ? r.high >= avgEntry : r.low <= avgEntry) {
				return { outcome: 'Partial-then-BE', grossR: realized / plannedRisk, addFilled, bars: i - sigIdx }
			}
		}
		if (Number.isFinite(tp) && (side === 1 ? r.high >= tp : r.low <= tp)) {
			const pnl = (side === 1 ? tp - avgEntry : avgEntry - tp) * weight
			return { outcome: 'Full fix', grossR: (realized + pnl) / plannedRisk, addFilled, bars: i - sigIdx }
		}
	}
	return { outcome: 'Open', grossR: NaN, addFilled, bars: rows.length - sigIdx }
}

interface ModeAgg { n: number; stop: number; pStop: number; pBe: number; full: number; open: number; sumR: number; nR: number; addFills: number }
const modeAgg = (): ModeAgg => ({ n: 0, stop: 0, pStop: 0, pBe: 0, full: 0, open: 0, sumR: 0, nR: 0, addFills: 0 })

async function main() {
	const trades = (JSON.parse(readFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), 'utf8')) as { trades: FwdTrade[] }).trades
	const STEP_SAFE = 0.5
	const RATIO = 1.46
	const modes: Record<string, number> = { safe: STEP_SAFE, risk: STEP_SAFE / RATIO }
	const agg: Record<string, ModeAgg> = { safe: modeAgg(), risk: modeAgg() }
	const perSeries: Array<Record<string, unknown>> = []
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
		const tfMs = tfMin * 60_000
		const idxByOpen = new Map<number, number>()
		for (let i = 0; i < rows.length; i++) idxByOpen.set(rows[i]!.timestamp, i)
		const seriesCount: Record<string, ModeAgg> = { safe: modeAgg(), risk: modeAgg() }
		for (const g of ggi) {
			const openT = Math.floor(g.timeMs / tfMs) * tfMs - tfMs
			const idx = idxByOpen.get(openT)
			if (idx == null || idx + 1 >= rows.length) continue
			for (const [mode, frac] of Object.entries(modes)) {
				const res = replayGeo(rows, idx, g.side, frac)
				if (!res) continue
				for (const a of [agg[mode]!, seriesCount[mode]!]) {
					a.n++
					if (res.addFilled) a.addFills++
					if (res.outcome === 'Stop') a.stop++
					else if (res.outcome === 'Partial-then-stop') a.pStop++
					else if (res.outcome === 'Partial-then-BE') a.pBe++
					else if (res.outcome === 'Full fix') a.full++
					else a.open++
					if (Number.isFinite(res.grossR)) { a.sumR += res.grossR; a.nR++ }
				}
			}
		}
		if (seriesCount.safe!.n >= 5) perSeries.push({ symbol, tfMin, safe: seriesCount.safe, risk: seriesCount.risk })
	}

	const fmtMode = (a: ModeAgg) => {
		const closed = a.n - a.open
		const partial = a.pStop + a.pBe
		const vendorWr = closed > 0 ? (((partial + a.full) / closed) * 100).toFixed(1) : '-'
		return { closed, partialPct: closed ? ((partial / closed) * 100).toFixed(1) : '-', stopPct: closed ? ((a.stop / closed) * 100).toFixed(1) : '-', fullPct: closed ? ((a.full / closed) * 100).toFixed(1) : '-', vendorWr, meanR: a.nR ? (a.sumR / a.nR).toFixed(4) : '-', addFillPct: a.n ? ((a.addFills / a.n) * 100).toFixed(0) : '-' }
	}

	const md: string[] = []
	md.push('# GEO1 - real telegram arrows replayed through the CONFIRMED spec geometry')
	md.push('')
	md.push('Geometry: stop = 2*add - entry; safe/risk step ratio 1.46; fix25 = dynamic Mean; TP = dynamic opposite inner band; BE rule after partial when fix25 crosses entry; avg entry (entry+add)/2, planned risk 1.5*step. Step choice (the one unknown): add at midpoint of entry-side outer zone.')
	md.push('Vendor table semantics (proved in DOGE 5m simulator): Partial row = took fix25 then stopped/BE, counted as WIN; Stop row = clean stops only.')
	md.push('')
	md.push('| mode | closed | Partial% | Stop% | Full fix% | vendor-WR | true mean R | add fill% |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const mode of ['safe', 'risk']) {
		const f = fmtMode(agg[mode]!)
		md.push(`| ${mode} | ${f.closed} | ${f.partialPct}% | ${f.stopPct}% | ${f.fullPct}% | ${f.vendorWr}% | ${f.meanR} | ${f.addFillPct}% |`)
	}
	md.push('')
	md.push('Vendor references (Nikita tables): LINK-series WR 89.4 / Stop 10.6 / Partial 42.4 / Full 47.1; DOGE 5m WR 86.6 / Stop 13.4 / Partial 37.8 / Full 48.8; AAVE 5m WR 88.7 / Stop 11.3 / Partial 30.2 / Full 58.5; risk tables WR 84.1 and 73.5.')
	md.push('')
	md.push('## Per series (n >= 5 arrows)')
	md.push('')
	md.push('| symbol | tf | mode | closed | P% | S% | F% | WR | mean R |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const s of perSeries) {
		for (const mode of ['safe', 'risk'] as const) {
			const f = fmtMode(s[mode] as ModeAgg)
			md.push(`| ${s.symbol} | ${s.tfMin}m | ${mode} | ${f.closed} | ${f.partialPct} | ${f.stopPct} | ${f.fullPct} | ${f.vendorWr} | ${f.meanR} |`)
		}
	}
	writeFileSync(resolve('ci-results/geo1-true-geometry-replay.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/geo1-true-geometry-replay.json'), JSON.stringify({ agg, perSeries }, null, 1))
	console.log(md.slice(0, 16).join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
