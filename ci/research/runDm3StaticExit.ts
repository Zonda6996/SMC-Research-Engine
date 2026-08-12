/**
 * DM3: static-level exit machinery. Spec frozen in
 * ci-results/dm3-static-exit-preregistration.md (committed before this file).
 *
 * 6 frozen variants; calibrate on BTC 2h full-window dashboard, then run ONLY
 * the calibration winner on XRP 3m out-of-sample. Static levels are frozen at
 * the SIGNAL bar: TP = opposite Inner, MID = mean. Stop static 12xTR55,
 * stop-first, no BE, no add.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'

export const STOP_MULT = 12
export const WARMUP = 100

export const VARIANTS = ['V1_moving_moving', 'V2_movP_staticTPwick', 'V3_movP_staticTPclose', 'V4_statP_staticTPwick', 'V5_statP_staticTPclose', 'V6_tp_partial_then_close'] as const
export type Dm3Variant = (typeof VARIANTS)[number]

export type Dm3Outcome = 'Stop' | 'Partial' | 'Full fix' | 'End mark'
export interface Dm3Trade {
	signalIndex: number
	side: CorrectedGgiSide
	outcome: Dm3Outcome
	grossR: number
	exitIndex: number
}

export interface DashboardCell { trades: number; partial: number; stop: number; full: number }
export interface Dashboard { long: DashboardCell; short: DashboardCell }

export const DASH_BTC_2H: Dashboard = {
	long: { trades: 50, partial: 16, stop: 7, full: 27 },
	short: { trades: 40, partial: 13, stop: 3, full: 24 },
}
export const DASH_XRP_3M: Dashboard = {
	long: { trades: 28, partial: 12, stop: 3, full: 13 },
	short: { trades: 33, partial: 9, stop: 5, full: 19 },
}

const favWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.high >= lvl : r.low <= lvl)
const advWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.low <= lvl : r.high >= lvl)
const favClose = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.close >= lvl : r.close <= lvl)

/** Replay one trade under a DM3 variant. Conservative adverse-first per bar. */
export function replayDm3Trade(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signalIndex: number,
	side: CorrectedGgiSide,
	variant: Dm3Variant,
): Dm3Trade | null {
	const signal = rows[signalIndex]
	const entryRow = rows[signalIndex + 1]
	const vol = tr55[signalIndex]
	if (signal == null || entryRow == null || vol == null || vol <= 0 || !validGgiBand(signal) || !validGgiBand(entryRow)) return null
	const entryPrice = entryRow.open
	const stopDistance = vol * STOP_MULT
	const stop = entryPrice - side * stopDistance
	const plannedRiskPct = (stopDistance / entryPrice) * 100
	const staticTp = side === 1 ? signal.upperInner : signal.lowerInner
	const staticMid = signal.mean
	let partialDone = false
	let realisedPct = 0
	let activeWeight = 1
	const pnlPct = (to: number, w: number) => ((side * (to - entryPrice)) / entryPrice) * w * 100

	const finish = (outcome: Dm3Outcome, exitIndex: number, exitPrice: number): Dm3Trade => ({
		signalIndex, side, outcome,
		grossR: (realisedPct + pnlPct(exitPrice, activeWeight)) / plannedRiskPct,
		exitIndex,
	})

	for (let i = signalIndex + 1; i < rows.length; i++) {
		const bar = rows[i]!
		if (!validGgiBand(bar)) continue
		// 1) adverse first: static stop
		if (advWick(side, bar, stop)) return finish(partialDone ? 'Partial' : 'Stop', i, stop)
		// 2) partial trigger
		if (!partialDone) {
			const pLvl = variant === 'V4_statP_staticTPwick' || variant === 'V5_statP_staticTPclose'
				? staticMid
				: variant === 'V6_tp_partial_then_close'
					? staticTp
					: bar.mean
			if (favWick(side, bar, pLvl)) {
				partialDone = true
				const w = activeWeight * 0.25
				realisedPct += pnlPct(pLvl, w)
				activeWeight -= w
			}
		}
		// 3) full trigger (evaluated on the same bar AFTER partial booking)
		if (variant === 'V1_moving_moving') {
			const fLvl = side === 1 ? bar.upperInner : bar.lowerInner
			if (favClose(side, bar, fLvl)) return finish('Full fix', i, fLvl)
		} else if (variant === 'V2_movP_staticTPwick' || variant === 'V4_statP_staticTPwick') {
			if (favWick(side, bar, staticTp)) return finish('Full fix', i, staticTp)
		} else if (variant === 'V3_movP_staticTPclose' || variant === 'V5_statP_staticTPclose') {
			if (favClose(side, bar, staticTp)) return finish('Full fix', i, staticTp)
		} else {
			// V6: partial books at TP wick; Full only on a CLOSE beyond TP after partial
			if (partialDone && favClose(side, bar, staticTp)) return finish('Full fix', i, staticTp)
		}
	}
	return { signalIndex, side, outcome: 'End mark', grossR: NaN, exitIndex: rows.length - 1 }
}

export function tallyDm3(trades: readonly Dm3Trade[]): { long: DashboardCell & { end: number }; short: DashboardCell & { end: number } } {
	const mk = () => ({ trades: 0, partial: 0, stop: 0, full: 0, end: 0 })
	const res = { long: mk(), short: mk() }
	for (const t of trades) {
		const c = t.side === 1 ? res.long : res.short
		if (t.outcome === 'End mark') { c.end++; continue }
		c.trades++
		if (t.outcome === 'Stop') c.stop++
		else if (t.outcome === 'Partial') c.partial++
		else c.full++
	}
	return res
}

export function distanceDm3(model: ReturnType<typeof tallyDm3>, dash: Dashboard): number {
	let d = 0
	for (const side of ['long', 'short'] as const) {
		for (const k of ['partial', 'stop', 'full'] as const) {
			d += (model[side][k] - dash[side][k]) ** 2 / Math.max(dash[side][k], 1)
		}
	}
	return d
}

function runDataset(path: string, variant: Dm3Variant): { tally: ReturnType<typeof tallyDm3>; meanR: number; wr: number } {
	const rows = parseExactIndicatorCsv(readFileSync(path, 'utf8'), { allowInvalidBandOrder: true })
	const tr55 = trueRangeSma(rows, 55)
	const trades: Dm3Trade[] = []
	for (let i = WARMUP; i < rows.length; i++) {
		const r = rows[i]!
		if (r.buy) { const t = replayDm3Trade(rows, tr55, i, 1, variant); if (t) trades.push(t) }
		else if (r.sell) { const t = replayDm3Trade(rows, tr55, i, -1, variant); if (t) trades.push(t) }
	}
	const closed = trades.filter((t) => t.outcome !== 'End mark')
	const rs = closed.map((t) => t.grossR)
	return {
		tally: tallyDm3(trades),
		meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN,
		wr: closed.length ? closed.filter((t) => t.outcome !== 'Stop').length / closed.length : NaN,
	}
}

async function main() {
	const btcPath = resolve('data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k.csv')
	const xrpPath = resolve('data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m.csv')

	// Phase 1: calibration on BTC 2h
	const calib: Record<string, { tally: ReturnType<typeof tallyDm3>; d: number; meanR: number; wr: number }> = {}
	for (const v of VARIANTS) {
		const r = runDataset(btcPath, v)
		calib[v] = { ...r, d: distanceDm3(r.tally, DASH_BTC_2H) }
		console.log(`[calib] ${v}: D=${calib[v]!.d.toFixed(2)} WR=${(calib[v]!.wr * 100).toFixed(1)}% meanR=${calib[v]!.meanR.toFixed(4)}`)
	}
	const ranked = VARIANTS.slice().sort((a, b) => calib[a]!.d - calib[b]!.d)
	const winner = ranked[0]!
	const dWin = calib[winner]!.d
	const noMatch = dWin > 10

	// Phase 2: OOS on XRP 3m - ONLY the winner, only if calibration succeeded
	let oos: { tally: ReturnType<typeof tallyDm3>; d: number; meanR: number; wr: number } | null = null
	let oosVerdict = 'SKIPPED (calibration NO MATCH)'
	if (!noMatch) {
		const r = runDataset(xrpPath, winner)
		oos = { ...r, d: distanceDm3(r.tally, DASH_XRP_3M) }
		const bucketsOk = (['long', 'short'] as const).every((s) =>
			(['partial', 'stop', 'full'] as const).every((k) => Math.abs(oos!.tally[s][k] - DASH_XRP_3M[s][k]) <= 6))
		const bucketsBad = (['long', 'short'] as const).some((s) =>
			(['partial', 'stop', 'full'] as const).some((k) => Math.abs(oos!.tally[s][k] - DASH_XRP_3M[s][k]) > 12))
		oosVerdict = oos.d <= 8 && bucketsOk
			? `OOS CONFIRMED (D=${oos.d.toFixed(2)})`
			: oos.d > 16 || bucketsBad
				? `OOS REFUTED (D=${oos.d.toFixed(2)})`
				: `OOS INCONCLUSIVE (D=${oos.d.toFixed(2)})`
	}

	const fmtRow = (name: string, t: ReturnType<typeof tallyDm3>, d: number, wr: number, meanR: number) =>
		`| ${name} | ${t.long.trades} | ${t.long.partial} | ${t.long.stop} | ${t.long.full} | ${t.short.trades} | ${t.short.partial} | ${t.short.stop} | ${t.short.full} | ${t.long.end + t.short.end} | ${d.toFixed(2)} | ${(wr * 100).toFixed(1)}% | ${meanR.toFixed(4)} |`

	const md: string[] = []
	md.push('# DM3 static-exit results')
	md.push('')
	md.push('Pre-registration: `dm3-static-exit-preregistration.md`. 6 frozen variants; static levels frozen at the signal bar (TP = opposite Inner, MID = mean); stop 12xTR55 static, stop-first, no BE, no add.')
	md.push('')
	md.push('## Phase 1: calibration - BTC.P 2h full window (dashboard 50L: 16/7/27, 40S: 13/3/24)')
	md.push('')
	md.push('| variant | closed L | P L | S L | F L | closed S | P S | S S | F S | End | D | WR | mean R |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	for (const v of VARIANTS) md.push(fmtRow(v, calib[v]!.tally, calib[v]!.d, calib[v]!.wr, calib[v]!.meanR))
	md.push('')
	md.push(`Winner: **${winner}** (D=${dWin.toFixed(2)}; next: ${ranked[1]} D=${calib[ranked[1]!]!.d.toFixed(2)}). Calibration ${noMatch ? 'NO MATCH (all D > 10)' : 'accepted'}.`)
	md.push('')
	md.push('## Phase 2: OOS - XRP 3m (dashboard 28L: 12/3/13, 33S: 9/5/19; feed caveat BINANCE vs BYBIT.P)')
	md.push('')
	if (oos) {
		md.push('| variant | closed L | P L | S L | F L | closed S | P S | S S | F S | End | D | WR | mean R |')
		md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
		md.push(fmtRow(winner, oos.tally, oos.d, oos.wr, oos.meanR))
	} else {
		md.push('Not run (calibration failed).')
	}
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${oosVerdict}**`)
	writeFileSync(resolve('ci-results/dm3-static-exit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/dm3-static-exit.json'), JSON.stringify({
		shaBtc: sha256File(btcPath), shaXrp: sha256File(xrpPath),
		config: { stopMult: STOP_MULT, warmup: WARMUP },
		calibration: calib, winner, oos, verdict: oosVerdict,
	}, null, 2))
	console.log(`\nwinner=${winner} D_calib=${dWin.toFixed(2)}\nVERDICT: ${oosVerdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
