/**
 * GEO4 - FINAL economics run with fully calibrated geometry (GEO2+GEO3):
 *   step_safe = 5.5 * ATR(200, RMA) at signal bar
 *   step_risk = step_safe / 1.43 ; step_std = step_safe / 1.17
 *   add = entry -/+ step ; stop = entry -/+ 2*step (1.75*step for std)
 *   safe/risk: fix25 = dynamic Mean, TP = dynamic opposite inner band,
 *              BE after partial if fix25 crosses entry
 *   standard: static TP = entry +/- 2*step, no partial
 * R basis (Nikita's correction): position sized for ADD-FILLED stake ->
 *   add-filled stop = exactly -1R; no-add stop = -(2/3)R safe/risk.
 * Arms: (A) vendor telegram arrows (FWD1, ~660, non-repaintable)
 *       (B) OUR own2Raw extension signals w/ per-mode state gate.
 * EXPLORATORY: geometry fixed by calibration, one run, no sweeps.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { own2Raw } from './runOwn2ExtensionTrigger.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
interface FwdTrade { symbol: string; tfMin: number; side: 1 | -1; timeMs: number }

function atrRma200(rows: readonly ExactIndicatorRow[]): number[] {
	const out = new Array(rows.length).fill(NaN)
	let s = 0
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i]!, p = rows[i - 1]!
		const tr = Math.max(r.high - r.low, Math.abs(r.high - p.close), Math.abs(r.low - p.close))
		if (i <= 200) { s += tr; if (i === 200) out[i] = s / 200 }
		else out[i] = (out[i - 1]! * 199 + tr) / 200
	}
	return out
}

type Outcome = 'Stop' | 'Partial-then-stop' | 'Partial-then-BE' | 'Full fix' | 'Open'
interface Res { outcome: Outcome; r: number; addFilled: boolean; exitIdx: number }

function replay(rows: readonly ExactIndicatorRow[], atr: readonly number[], sigIdx: number, side: 1 | -1, mode: 'safe' | 'risk' | 'std'): Res | null {
	const e = rows[sigIdx + 1]
	const a = atr[sigIdx]
	if (!e || !Number.isFinite(a)) return null
	const stepSafe = 5.5 * (a as number)
	const step = mode === 'safe' ? stepSafe : mode === 'risk' ? stepSafe / 1.43 : stepSafe / 1.17
	const entry = e.open
	const add = side === 1 ? entry - step : entry + step
	const stopMult = mode === 'std' ? 1.75 : 2
	const stop = side === 1 ? entry - stopMult * step : entry + stopMult * step
	const tpStd = side === 1 ? entry + 2 * step : entry - 2 * step
	// 1R = risk of the add-filled stake: 2 units from avgEntry to stop
	const avgFull = (entry + add) / 2
	const oneR = Math.abs(avgFull - stop) * 2
	let addFilled = false, partialDone = false, realized = 0, weight = 1, avgEntry = entry
	for (let i = sigIdx + 1; i < rows.length; i++) {
		const r = rows[i]!
		if (!addFilled && (side === 1 ? r.low <= add : r.high >= add)) { addFilled = true; avgEntry = avgFull; weight = partialDone ? 1.75 : 2 }
		if (side === 1 ? r.low <= stop : r.high >= stop) {
			const pnl = (side === 1 ? stop - avgEntry : avgEntry - stop) * weight
			return { outcome: partialDone ? 'Partial-then-stop' : 'Stop', r: (realized + pnl) / oneR, addFilled, exitIdx: i }
		}
		if (mode === 'std') {
			if (side === 1 ? r.high >= tpStd : r.low <= tpStd) {
				const pnl = (side === 1 ? tpStd - avgEntry : avgEntry - tpStd) * weight
				return { outcome: 'Full fix', r: pnl / oneR, addFilled, exitIdx: i }
			}
			continue
		}
		const fix25 = r.mean
		const tp = side === 1 ? r.upperInner : r.lowerInner
		if (!partialDone && Number.isFinite(fix25) && (side === 1 ? r.high >= fix25 : r.low <= fix25)) {
			realized += (side === 1 ? (fix25 as number) - avgEntry : avgEntry - (fix25 as number)) * weight * 0.25
			weight *= 0.75
			partialDone = true
		}
		if (partialDone && Number.isFinite(fix25) && (side === 1 ? (fix25 as number) < avgEntry : (fix25 as number) > avgEntry)) {
			if (side === 1 ? r.high >= avgEntry : r.low <= avgEntry) return { outcome: 'Partial-then-BE', r: realized / oneR, addFilled, exitIdx: i }
		}
		if (Number.isFinite(tp) && (side === 1 ? r.high >= (tp as number) : r.low <= (tp as number))) {
			const pnl = (side === 1 ? (tp as number) - avgEntry : avgEntry - (tp as number)) * weight
			return { outcome: 'Full fix', r: (realized + pnl) / oneR, addFilled, exitIdx: i }
		}
	}
	return { outcome: 'Open', r: NaN, addFilled, exitIdx: rows.length - 1 }
}

interface Agg { n: number; stop: number; pS: number; pBe: number; full: number; open: number; sumR: number; nR: number; add: number }
const agg = (): Agg => ({ n: 0, stop: 0, pS: 0, pBe: 0, full: 0, open: 0, sumR: 0, nR: 0, add: 0 })
function tally(a: Agg, res: Res) {
	a.n++
	if (res.addFilled) a.add++
	if (res.outcome === 'Stop') a.stop++
	else if (res.outcome === 'Partial-then-stop') a.pS++
	else if (res.outcome === 'Partial-then-BE') a.pBe++
	else if (res.outcome === 'Full fix') a.full++
	else a.open++
	if (Number.isFinite(res.r)) { a.sumR += res.r; a.nR++ }
}
const fmt = (a: Agg) => {
	const closed = a.n - a.open
	const win = a.pS + a.pBe + a.full
	return `closed ${closed} | WR(vendor) ${closed ? ((win / closed) * 100).toFixed(1) : '-'}% | Stop ${closed ? ((a.stop / closed) * 100).toFixed(1) : '-'}% | Partial ${closed ? (((a.pS + a.pBe) / closed) * 100).toFixed(1) : '-'}% | Full ${closed ? ((a.full / closed) * 100).toFixed(1) : '-'}% | mean R ${a.nR ? (a.sumR / a.nR).toFixed(4) : '-'} | total R ${a.sumR.toFixed(1)} | add ${a.n ? ((a.add / a.n) * 100).toFixed(0) : '-'}%`
}

async function main() {
	const trades = (JSON.parse(readFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), 'utf8')) as { trades: FwdTrade[] }).trades
	const modes = ['safe', 'risk', 'std'] as const
	const vendor: Record<string, Agg> = { safe: agg(), risk: agg(), std: agg() }
	const own: Record<string, Agg> = { safe: agg(), risk: agg(), std: agg() }
	const files = readdirSync(resolve('data/gate-cache')).filter((f) => /^[A-Z0-9]+_(60|120)m\.json$/u.test(f))
	for (const file of files) {
		const m = /^([A-Z0-9]+)_(\d+)m\.json$/u.exec(file)!
		const symbol = m[1]!, tfMin = Number(m[2]!)
		const klines = (JSON.parse(readFileSync(resolve('data/gate-cache', file), 'utf8')) as { rows: Kline[] }).rows
		if (klines.length < 300) continue
		const rows = buildRows(klines)
		const atr = atrRma200(rows)
		const tfMs = tfMin * 60_000
		const idxByOpen = new Map<number, number>()
		for (let i = 0; i < rows.length; i++) idxByOpen.set(rows[i]!.timestamp, i)
		// Arm A: vendor arrows
		for (const g of trades.filter((t) => t.symbol === symbol && t.tfMin === tfMin)) {
			const idx = idxByOpen.get(Math.floor(g.timeMs / tfMs) * tfMs - tfMs)
			if (idx == null || idx + 1 >= rows.length || idx <= 200) continue
			for (const mode of modes) {
				const res = replay(rows, atr, idx, g.side, mode)
				if (res) tally(vendor[mode]!, res)
			}
		}
		// Arm B: our extension signals, per-mode state gate (+3 bars)
		const raw = own2Raw(rows)
		for (const mode of modes) {
			let blockedUntil = -1
			for (const s of raw) {
				if (s.idx <= blockedUntil || s.idx <= 200 || s.idx + 1 >= rows.length) continue
				const res = replay(rows, atr, s.idx, s.side, mode)
				if (!res) continue
				tally(own[mode]!, res)
				blockedUntil = res.exitIdx + 3
			}
		}
	}
	const md: string[] = ['# GEO4 - final economics with calibrated geometry (step=5.5*ATR200, R: add-filled stop = -1R)', '']
	md.push('## Arm A: vendor telegram arrows (~660 fwd, 1h/2h)', '')
	for (const mode of modes) md.push(`- **${mode}**: ${fmt(vendor[mode]!)}`)
	md.push('', '## Arm B: OUR extension signals (own2Raw + per-mode gate), same series', '')
	for (const mode of modes) md.push(`- **${mode}**: ${fmt(own[mode]!)}`)
	md.push('', 'Vendor reference tables: safe WR 86-89 / Stop 11-13; his own std Total R per series: -23.3R (DOGE1h), +28.3R (LINK2h), -1.8R (ETH2h), -0.3R (ONDO15m), +6.5R (AVAX5m).')
	writeFileSync(resolve('ci-results/geo4-calibrated-economics.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/geo4-calibrated-economics.json'), JSON.stringify({ vendor, own }, null, 1))
	console.log(md.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
