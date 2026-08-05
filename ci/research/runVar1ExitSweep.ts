/**
 * VAR1: EXPLORATORY exit-machinery sweep for Nikita's own engine tuning.
 * Not pre-registered - this is parameter cartography, not a hypothesis test.
 * Any "winner" here must be treated as overfit until confirmed on new data.
 *
 * Axes (2 x 2 x 3 x 2 = 24 configs):
 *  - partialFrac: 0.25 (GGI-style) | 0.5
 *  - breakeven after partial: no (GGI-style) | yes (stop -> avg entry)
 *  - stopMult: 8 | 10 | 12 (x TR55, static)
 *  - add-on: none (GGI table match) | SPLIT ENTRY per Nikita: 50% of planned
 *    size at signal, 50% at the add line (entry - 0.5 x stopDist). R is
 *    denominated in PLANNED FULL risk = 0.5x(entry-stop) + 0.5x(add-stop)
 *    = 0.75 x stopDist, so a post-add stop costs exactly -1R and a pre-add
 *    stop costs -0.667R (only half the size was deployed).
 *
 * Base semantics inherited from DM3 V2: entry next bar open, adverse-first,
 * partial at moving Mean wick, full at static signal-bar opposite-Inner wick.
 * Signal sources: GGI arrows and OWN1 (bk1.5/M10) on all 5 datasets.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import { WARMUP } from './runDm3StaticExit.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'

export interface Var1Config {
	partialFrac: number
	breakeven: boolean
	stopMult: number
	addOn: boolean
}

export interface Var1Trade {
	outcome: 'Stop' | 'Partial' | 'Full fix' | 'End mark'
	grossR: number
}

const favWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.high >= lvl : r.low <= lvl)
const advWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.low <= lvl : r.high >= lvl)

/** Replay one trade under a VAR1 config. DM3-V2 semantics + new axes. */
export function replayVar1Trade(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signalIndex: number,
	side: CorrectedGgiSide,
	cfg: Var1Config,
): Var1Trade | null {
	const signal = rows[signalIndex]
	const entryRow = rows[signalIndex + 1]
	const vol = tr55[signalIndex]
	if (signal == null || entryRow == null || vol == null || vol <= 0 || !validGgiBand(signal) || !validGgiBand(entryRow)) return null
	const entryPrice = entryRow.open
	const stopDistance = vol * cfg.stopMult
	const staticTp = side === 1 ? signal.upperInner : signal.lowerInner
	const addLevel = entryPrice - side * 0.5 * stopDistance
	// Split-entry risk denominator (see header): without ADD the whole planned
	// size enters at signal (risk = stopDist); with ADD, 0.5 at entry + 0.5 at
	// the add line (planned risk = 0.75 x stopDist, post-add stop = -1R).
	const plannedRiskPct = ((cfg.addOn ? 0.75 * stopDistance : stopDistance) / entryPrice) * 100

	let stop = entryPrice - side * stopDistance
	let partialDone = false
	let addDone = false
	let realisedPct = 0
	// weights are fractions of PLANNED FULL size
	let activeWeight = cfg.addOn ? 0.5 : 1
	let avgEntry = entryPrice

	const pnlPct = (to: number, w: number, from: number) => ((side * (to - from)) / entryPrice) * w * 100

	const finish = (outcome: Var1Trade['outcome'], exitPrice: number): Var1Trade => ({
		outcome,
		grossR: (realisedPct + pnlPct(exitPrice, activeWeight, avgEntry)) / plannedRiskPct,
	})

	for (let i = signalIndex + 1; i < rows.length; i++) {
		const bar = rows[i]!
		if (!validGgiBand(bar)) continue
		// 0) add-on BEFORE stop check only if the add level is hit while the stop is NOT
		if (cfg.addOn && !addDone && advWick(side, bar, addLevel) && !advWick(side, bar, stop)) {
			avgEntry = (avgEntry * activeWeight + addLevel * 0.5) / (activeWeight + 0.5)
			activeWeight += 0.5
			addDone = true
		}
		// 1) adverse first: stop (conservative)
		if (advWick(side, bar, stop)) return finish(partialDone ? 'Partial' : 'Stop', stop)
		// 2) partial at moving Mean wick, once
		if (!partialDone && favWick(side, bar, bar.mean)) {
			partialDone = true
			const w = activeWeight * cfg.partialFrac
			realisedPct += pnlPct(bar.mean, w, avgEntry)
			activeWeight -= w
			if (cfg.breakeven) stop = avgEntry
		}
		// 3) full at static TP wick
		if (favWick(side, bar, staticTp)) return finish('Full fix', staticTp)
	}
	return { outcome: 'End mark', grossR: NaN }
}

export function evalConfig(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signals: ReadonlyArray<{ idx: number; side: CorrectedGgiSide }>,
	cfg: Var1Config,
): { n: number; meanR: number; wr: number; p: number; s: number; f: number } {
	const rs: number[] = []
	let p = 0
	let s = 0
	let f = 0
	for (const sig of signals) {
		const t = replayVar1Trade(rows, tr55, sig.idx, sig.side, cfg)
		if (t && t.outcome !== 'End mark') {
			rs.push(t.grossR)
			if (t.outcome === 'Partial') p++
			else if (t.outcome === 'Stop') s++
			else f++
		}
	}
	const n = rs.length
	return {
		n,
		meanR: n ? rs.reduce((a, b) => a + b, 0) / n : NaN,
		wr: n ? (p + f) / n : NaN,
		p,
		s,
		f,
	}
}

const FILES = [
	{ id: 'btc-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv' },
	{ id: 'xrp-3m', file: 'data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m_vol.csv' },
	{ id: 'ondo-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv' },
	{ id: 'ondo-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv' },
	{ id: 'btc-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv' },
]

async function main() {
	const configs: Var1Config[] = []
	for (const partialFrac of [0.25, 0.5]) {
		for (const breakeven of [false, true]) {
			for (const stopMult of [8, 10, 12]) {
				for (const addOn of [false, true]) configs.push({ partialFrac, breakeven, stopMult, addOn })
			}
		}
	}
	const cfgName = (c: Var1Config) => `P${c.partialFrac * 100}${c.breakeven ? '+BE' : ''}/S${c.stopMult}${c.addOn ? '+ADD' : ''}`

	const pooled: Record<string, Record<string, { sumR: number; n: number; p: number; s: number; f: number }>> = { arrows: {}, own1: {} }
	const perDataset: Array<Record<string, unknown>> = []

	for (const { id, file } of FILES) {
		const rows = parseExactIndicatorCsv(readFileSync(resolve(file), 'utf8'), { allowInvalidBandOrder: true })
		const tr55 = trueRangeSma(rows, 55)
		const bSma = bodySma20(rows)
		const arrows: Array<{ idx: number; side: CorrectedGgiSide }> = []
		for (let i = WARMUP; i < rows.length; i++) {
			if (rows[i]!.buy) arrows.push({ idx: i, side: 1 })
			else if (rows[i]!.sell) arrows.push({ idx: i, side: -1 })
		}
		const own = own1Signals(rows, bSma, 1.5, 10, 0, rows.length)
		for (const [src, sigs] of [['arrows', arrows], ['own1', own]] as const) {
			for (const cfg of configs) {
				const r = evalConfig(rows, tr55, sigs, cfg)
				const key = cfgName(cfg)
				const slot = (pooled[src]![key] ??= { sumR: 0, n: 0, p: 0, s: 0, f: 0 })
				slot.sumR += r.meanR * r.n
				slot.n += r.n
				slot.p += r.p
				slot.s += r.s
				slot.f += r.f
				perDataset.push({ dataset: id, source: src, config: key, ...r })
			}
		}
		console.log(`[var1] ${id} done (arrows=${arrows.length}, own1=${own.length})`)
	}

	const md: string[] = []
	md.push('# VAR1 - exploratory exit sweep (24 configs x 5 datasets x 2 signal sources)')
	md.push('')
	md.push('EXPLORATORY: no pre-registration, winners are overfit until confirmed on fresh data.')
	md.push('Config key: P<partial%>[+BE]/S<stopMult>[+ADD]. Base = P25/S12 (GGI-style DM3 V2).')
	md.push('ADD = SPLIT ENTRY: 50% planned size at signal + 50% at entry - 0.5 x stopDist;')
	md.push('R denominated in planned full risk: post-add stop = -1R, pre-add stop = -0.667R.')
	md.push('')
	for (const src of ['arrows', 'own1'] as const) {
		md.push(`## Pooled across all 5 datasets - ${src.toUpperCase()}`)
		md.push('')
		md.push('| config | n | mean R | WR | P/S/F | F:S |')
		md.push('|---|---|---|---|---|---|')
		const entries = Object.entries(pooled[src]!).sort((a, b) => b[1].sumR / b[1].n - a[1].sumR / a[1].n)
		for (const [key, v] of entries) {
			md.push(`| ${key} | ${v.n} | ${(v.sumR / v.n).toFixed(4)} | ${(((v.p + v.f) / v.n) * 100).toFixed(1)}% | ${v.p}/${v.s}/${v.f} | ${v.s ? (v.f / v.s).toFixed(1) : 'inf'} |`)
		}
		md.push('')
	}
	writeFileSync(resolve('ci-results/var1-exit-sweep.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/var1-exit-sweep.json'), JSON.stringify({ perDataset }, null, 2))
	console.log('written ci-results/var1-exit-sweep.md')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
