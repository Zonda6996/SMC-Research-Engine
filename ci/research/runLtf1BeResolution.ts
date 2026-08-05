/**
 * LTF1: BE semantics resolved by 15m paths inside 2h trades. Spec frozen in
 * ci-results/ltf1-be-resolution-preregistration.md (committed before this file).
 *
 * Frozen v2 machinery (12xTR55 stop, Mean-wick Partial 25%, Inner-close Full,
 * next-open entry, no add). Only the BE block varies: B0 none, B1 wick-avg,
 * B2 wick-entry (== B1 under no-add), B3 confirmed-15m-close-entry.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import {
	replayCorrectedGgiTrade, trueRangeSma, validGgiBand,
	type CorrectedGgiBeBound, type CorrectedGgiSide,
} from './lib/ggiCorrectedReplay.js'

export const STOP_MULT = 12
export const WARMUP = 100
export const MIN_SUBBARS = 6
export const ENVELOPE_TOL = 5e-4
export const PSEUDO_SHIFT = 37
export const BE_VARIANTS = ['B0_none', 'B1_wick_avg', 'B2_wick_entry', 'B3_close_entry'] as const
export type BeVariant = (typeof BE_VARIANTS)[number]
const OHLC_BOUNDS: CorrectedGgiBeBound[] = ['optimistic-initial-stop', 'next-bar-blended-be', 'next-bar-entry-be']

export interface LtfMap {
	/** per 2h bar: [startIdx, endIdx) into the 15m rows, or null if uncovered */
	slices: Array<[number, number] | null>
	alignedBars: number
	coveredBars: number
	violations: number
}

/** Map each 2h bar to its 15m sub-bars in [t, t+2h) and check OHLC envelope agreement. */
export function buildLtfMap(rows2h: readonly ExactIndicatorRow[], rows15m: readonly ExactIndicatorRow[]): LtfMap {
	const DUR = 7_200_000
	const slices: Array<[number, number] | null> = new Array(rows2h.length).fill(null)
	let p = 0
	let covered = 0
	let aligned = 0
	let violations = 0
	for (let i = 0; i < rows2h.length; i++) {
		const t0 = rows2h[i]!.timestamp
		const t1 = t0 + DUR
		while (p < rows15m.length && rows15m[p]!.timestamp < t0) p++
		let q = p
		while (q < rows15m.length && rows15m[q]!.timestamp < t1) q++
		if (q > p) {
			covered++
			const bar = rows2h[i]!
			let hi = -Infinity
			let lo = Infinity
			for (let k = p; k < q; k++) {
				hi = Math.max(hi, rows15m[k]!.high)
				lo = Math.min(lo, rows15m[k]!.low)
			}
			const tol = ENVELOPE_TOL
			const ok = q - p >= MIN_SUBBARS
				&& hi <= bar.high * (1 + tol) && hi >= bar.high * (1 - tol)
				&& lo >= bar.low * (1 - tol) && lo <= bar.low * (1 + tol)
				&& Math.abs(rows15m[p]!.open - bar.open) <= bar.open * tol
				&& Math.abs(rows15m[q - 1]!.close - bar.close) <= bar.close * tol
			if (ok) {
				aligned++
				slices[i] = [p, q]
			} else violations++
		}
		p = q > p ? q : p
	}
	return { slices, alignedBars: aligned, coveredBars: covered, violations }
}

export type LtfOutcome = 'Stop' | 'Partial' | 'Full fix' | 'End mark'
export interface LtfTrade {
	signalIndex: number
	side: CorrectedGgiSide
	outcome: LtfOutcome
	grossR: number
	partial: boolean
	ambiguousBars: number
	exitIndex: number
}

const favWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, level: number) => (side === 1 ? r.high >= level : r.low <= level)
const advWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, level: number) => (side === 1 ? r.low <= level : r.high >= level)
const favClose = (side: CorrectedGgiSide, r: ExactIndicatorRow, level: number) => (side === 1 ? r.close >= level : r.close <= level)
const advClose = (side: CorrectedGgiSide, r: ExactIndicatorRow, level: number) => (side === 1 ? r.close <= level : r.close >= level)

/**
 * LTF-resolved replay of one 2h trade. Returns null if the trade's path is not
 * fully covered by aligned 15m bars (frozen exclusion). Levels (Mean/Inner/stop)
 * come from the 2h leg exactly as in the v2 engine; the 15m path only resolves
 * the ORDER of touches inside each 2h bar. Conservative adverse-first still
 * applies WITHIN each 15m sub-bar.
 */
export function replayLtfTrade(
	rows2h: readonly ExactIndicatorRow[],
	rows15m: readonly ExactIndicatorRow[],
	ltf: LtfMap,
	tr55: readonly (number | null)[],
	signalIndex: number,
	side: CorrectedGgiSide,
	variant: BeVariant,
): LtfTrade | null {
	const signal = rows2h[signalIndex]
	const entryIndex = signalIndex + 1
	const entryRow = rows2h[entryIndex]
	const vol = tr55[signalIndex]
	if (signal == null || entryRow == null || vol == null || vol <= 0 || !validGgiBand(signal) || !validGgiBand(entryRow)) return null
	const entryPrice = entryRow.open
	const stopDistance = vol * STOP_MULT
	const initialStop = entryPrice - side * stopDistance
	const plannedRiskPct = stopDistance / entryPrice * 100
	let activeWeight = 1
	let realisedPct = 0
	let partialDone = false
	let beArmed = false // becomes true from the sub-bar AFTER the Partial sub-bar
	let ambiguousBars = 0
	const pnlPct = (from: number, to: number, w: number) => side * (to - from) / from * w * 100

	const finish = (outcome: LtfOutcome, exitIndex: number, exitPrice: number): LtfTrade => ({
		signalIndex, side, outcome,
		grossR: (realisedPct + pnlPct(entryPrice, exitPrice, activeWeight)) / plannedRiskPct,
		partial: partialDone, ambiguousBars, exitIndex,
	})

	for (let i = entryIndex; i < rows2h.length; i++) {
		const bar = rows2h[i]!
		if (!validGgiBand(bar)) continue
		const slice = ltf.slices[i]
		if (slice == null) return null // path leaves the aligned overlap -> excluded
		const partialLevel = bar.mean
		const fullLevel = side === 1 ? bar.upperInner : bar.lowerInner
		const beLevel = entryPrice // avg == entry under no-add (B1 == B2)
		// ambiguity on raw 2h OHLC for this bar (pre-resolution):
		const stopLvl = partialDone && variant !== 'B0_none' ? beLevel : initialStop
		if (advWick(side, bar, stopLvl) && ((!partialDone && favWick(side, bar, partialLevel)) || favClose(side, bar, fullLevel))) ambiguousBars++
		// walk 15m sub-bars in time order
		for (let k = slice[0]; k < slice[1]; k++) {
			const sub = rows15m[k]!
			// 1) adverse first within the sub-bar (frozen conservative)
			if (partialDone && variant !== 'B0_none' && beArmed) {
				if (variant === 'B3_close_entry') {
					if (advClose(side, sub, beLevel)) return finish('Partial', i, sub.close)
				} else if (advWick(side, sub, beLevel)) {
					return finish('Partial', i, beLevel)
				}
			}
			if (!(partialDone && variant !== 'B0_none' && beArmed && variant !== 'B3_close_entry') || true) {
				// initial stop applies while BE is not the active stop
				const initialStopActive = !(partialDone && variant !== 'B0_none' && beArmed)
				if (initialStopActive && advWick(side, sub, initialStop)) {
					return finish(partialDone ? 'Partial' : 'Stop', i, initialStop)
				}
			}
			// 2) favourable partial
			if (!partialDone && favWick(side, sub, partialLevel)) {
				partialDone = true
				const exitWeight = activeWeight * 0.25
				realisedPct += pnlPct(entryPrice, partialLevel, exitWeight)
				activeWeight -= exitWeight
				beArmed = false // arms from the NEXT sub-bar
				continue
			}
			if (partialDone && !beArmed) beArmed = true
		}
		// 3) Full fix is an end-of-2h-bar event (close beyond moving opposite Inner)
		if (favClose(side, bar, fullLevel)) return finish('Full fix', i, fullLevel)
	}
	return null // reached data end without exit inside overlap -> excluded
}

export function summarizeLtf(trades: readonly LtfTrade[]) {
	const n = trades.length
	const count = (o: LtfOutcome) => trades.filter((t) => t.outcome === o).length
	const rs = trades.map((t) => t.grossR).sort((a, b) => a - b)
	const mean = n ? rs.reduce((a, b) => a + b, 0) / n : NaN
	const med = n ? (n % 2 ? rs[(n - 1) / 2]! : (rs[n / 2 - 1]! + rs[n / 2]!) / 2) : NaN
	return {
		n,
		wr: n ? trades.filter((t) => t.grossR > 0).length / n : NaN,
		stop: count('Stop'), partial: count('Partial'), full: count('Full fix'), end: count('End mark'),
		meanR: mean, medianR: med,
		ambiguousShare: n ? trades.filter((t) => t.ambiguousBars > 0).length / n : NaN,
	}
}

async function main() {
	const DATASETS = [
		{ id: 'btc-2h', f2h: 'incoming-2026-08/BYBIT_BTCUSDT.P_2h.csv', f15: 'incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv' },
		{ id: 'ondo-2h', f2h: 'incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv', f15: 'incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv' },
	]
	interface Cohort { real: Record<BeVariant, LtfTrade[]>; pseudo: Record<BeVariant, LtfTrade[]>; ohlc: Record<string, number[]>; classChanges: { b1VsEntryBe: number; b0VsOptimistic: number; total: number } }
	const pooled: Cohort = {
		real: Object.fromEntries(BE_VARIANTS.map((v) => [v, []])) as never,
		pseudo: Object.fromEntries(BE_VARIANTS.map((v) => [v, []])) as never,
		ohlc: Object.fromEntries(OHLC_BOUNDS.map((b) => [b, []])),
		classChanges: { b1VsEntryBe: 0, b0VsOptimistic: 0, total: 0 },
	}
	const perDataset: Array<Record<string, unknown>> = []

	for (const ds of DATASETS) {
		const p2h = resolve('data/vendor-exports', ds.f2h)
		const p15 = resolve('data/vendor-exports', ds.f15)
		const rows2h = parseExactIndicatorCsv(readFileSync(p2h, 'utf8'), { allowInvalidBandOrder: true })
		const rows15m = parseExactIndicatorCsv(readFileSync(p15, 'utf8'), { allowInvalidBandOrder: true })
		const ltf = buildLtfMap(rows2h, rows15m)
		const violationShare = ltf.coveredBars > 0 ? ltf.violations / ltf.coveredBars : 1
		console.log(`[${ds.id}] covered=${ltf.coveredBars} aligned=${ltf.alignedBars} violations=${ltf.violations} (${(violationShare * 100).toFixed(2)}%)`)
		if (violationShare > 0.02) throw new Error(`${ds.id}: alignment gate failed (${(violationShare * 100).toFixed(2)}% > 2%)`)
		const tr55 = trueRangeSma(rows2h, 55)
		const labelBars = new Set<number>()
		for (let i = 0; i < rows2h.length; i++) if (rows2h[i]!.buy || rows2h[i]!.sell) labelBars.add(i)

		const runSet = (signals: Array<{ idx: number; side: CorrectedGgiSide }>, target: Record<BeVariant, LtfTrade[]>, collectOhlc: boolean) => {
			let included = 0
			for (const s of signals) {
				const b0 = replayLtfTrade(rows2h, rows15m, ltf, tr55, s.idx, s.side, 'B0_none')
				if (b0 == null) continue // frozen inclusion: B0 (longest-holding) must complete inside overlap
				const variants: Record<BeVariant, LtfTrade> = { B0_none: b0 } as never
				let all = true
				for (const v of BE_VARIANTS.slice(1)) {
					const t = replayLtfTrade(rows2h, rows15m, ltf, tr55, s.idx, s.side, v)
					if (t == null) { all = false; break }
					variants[v] = t
				}
				if (!all) continue
				included++
				for (const v of BE_VARIANTS) target[v].push(variants[v])
				if (collectOhlc) {
					// same signal through the frozen v2 OHLC engine under the 3 bounds
					const patched = rows2h.slice()
					patched[s.idx] = { ...rows2h[s.idx]!, buy: s.side === 1, sell: s.side === -1 }
					let entryBeOutcome: string | null = null
					let optimisticOutcome: string | null = null
					for (const bound of OHLC_BOUNDS) {
						const t = replayCorrectedGgiTrade(patched, tr55, s.idx, { stopMultiplier: STOP_MULT, beBound: bound })
						if (t) {
							pooled.ohlc[bound]!.push(t.grossR)
							if (bound === 'next-bar-entry-be') entryBeOutcome = t.outcome
							if (bound === 'optimistic-initial-stop') optimisticOutcome = t.outcome
						}
					}
					pooled.classChanges.total++
					if (entryBeOutcome != null && entryBeOutcome !== variants.B1_wick_avg.outcome) pooled.classChanges.b1VsEntryBe++
					if (optimisticOutcome != null && optimisticOutcome !== variants.B0_none.outcome) pooled.classChanges.b0VsOptimistic++
				}
			}
			return included
		}

		const realSignals: Array<{ idx: number; side: CorrectedGgiSide }> = []
		const pseudoSignals: Array<{ idx: number; side: CorrectedGgiSide }> = []
		for (let i = WARMUP; i < rows2h.length; i++) {
			const row = rows2h[i]!
			if (!row.buy && !row.sell) continue
			const side: CorrectedGgiSide = row.buy ? 1 : -1
			realSignals.push({ idx: i, side })
			const j = i + PSEUDO_SHIFT
			if (j < rows2h.length && !labelBars.has(j)) pseudoSignals.push({ idx: j, side })
		}
		const dsReal: Record<BeVariant, LtfTrade[]> = Object.fromEntries(BE_VARIANTS.map((v) => [v, []])) as never
		const dsPseudo: Record<BeVariant, LtfTrade[]> = Object.fromEntries(BE_VARIANTS.map((v) => [v, []])) as never
		const nReal = runSet(realSignals, dsReal, true)
		const nPseudo = runSet(pseudoSignals, dsPseudo, false)
		console.log(`[${ds.id}] real included=${nReal}/${realSignals.length} pseudo included=${nPseudo}/${pseudoSignals.length}`)
		for (const v of BE_VARIANTS) {
			pooled.real[v].push(...dsReal[v])
			pooled.pseudo[v].push(...dsPseudo[v])
		}
		perDataset.push({
			id: ds.id, sha2h: sha256File(p2h), sha15m: sha256File(p15),
			alignment: { covered: ltf.coveredBars, aligned: ltf.alignedBars, violations: ltf.violations },
			realIncluded: nReal, realTotal: realSignals.length, pseudoIncluded: nPseudo,
			real: Object.fromEntries(BE_VARIANTS.map((v) => [v, summarizeLtf(dsReal[v])])),
			pseudo: Object.fromEntries(BE_VARIANTS.map((v) => [v, summarizeLtf(dsPseudo[v])])),
		})
	}

	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
	const ohlcMeans = Object.fromEntries(OHLC_BOUNDS.map((b) => [b, mean(pooled.ohlc[b]!)]))
	const wOhlc = Math.max(...Object.values(ohlcMeans)) - Math.min(...Object.values(ohlcMeans))
	const ltfMeans = Object.fromEntries(BE_VARIANTS.map((v) => [v, summarizeLtf(pooled.real[v]).meanR]))
	const wLtf = Math.max(...Object.values(ltfMeans)) - Math.min(...Object.values(ltfMeans))
	const ambShare = summarizeLtf(pooled.real.B1_wick_avg).ambiguousShare
	const verdict = ambShare < 0.15
		? `KILLED (ambiguity rate ${(ambShare * 100).toFixed(1)}% < 15%: LTF resolves nothing material)`
		: wLtf <= 0.5 * wOhlc
			? `IDENTIFIED (W_ltf ${wLtf.toFixed(4)} <= 0.5 x W_ohlc ${wOhlc.toFixed(4)}; LTF point estimates become the 2h reference)`
			: `NOT IDENTIFIABLE (W_ltf ${wLtf.toFixed(4)} > 0.5 x W_ohlc ${wOhlc.toFixed(4)}; BE semantics need sub-15m data)`

	const pc = (x: number) => (x * 100).toFixed(1) + '%'
	const md: string[] = []
	md.push('# LTF1 BE-resolution results')
	md.push('')
	md.push('Pre-registration: `ltf1-be-resolution-preregistration.md`. Frozen v2 machinery; only the BE block varies; 15m sub-bar ordering inside 2h bars; conservative adverse-first within each 15m sub-bar.')
	md.push('')
	md.push('## Pooled real trades (overlap subset)')
	md.push('')
	md.push('| variant | n | WR | Stop | Partial | Full | End | mean R | median R |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const v of BE_VARIANTS) {
		const s = summarizeLtf(pooled.real[v])
		md.push(`| ${v} | ${s.n} | ${pc(s.wr)} | ${s.stop} | ${s.partial} | ${s.full} | ${s.end} | ${s.meanR.toFixed(4)} | ${s.medianR.toFixed(4)} |`)
	}
	md.push('')
	md.push('## OHLC-2h bounds on the SAME subset (v2 engine)')
	md.push('')
	md.push('| bound | n | mean R |')
	md.push('|---|---|---|')
	for (const b of OHLC_BOUNDS) md.push(`| ${b} | ${pooled.ohlc[b]!.length} | ${mean(pooled.ohlc[b]!).toFixed(4)} |`)
	md.push('')
	md.push(`W_ohlc = ${wOhlc.toFixed(4)} R; W_ltf = ${wLtf.toFixed(4)} R; ambiguity share (B1 walk) = ${pc(ambShare)}; class changes: B1 vs OHLC entry-BE ${pooled.classChanges.b1VsEntryBe}/${pooled.classChanges.total}, B0 vs OHLC optimistic ${pooled.classChanges.b0VsOptimistic}/${pooled.classChanges.total}.`)
	md.push('')
	md.push('## Negative control (pseudo-signals, +37 bars, same side)')
	md.push('')
	md.push('| variant | n | WR | mean R | Stop | Partial | Full | End |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const v of BE_VARIANTS) {
		const s = summarizeLtf(pooled.pseudo[v])
		md.push(`| ${v} | ${s.n} | ${pc(s.wr)} | ${s.meanR.toFixed(4)} | ${s.stop} | ${s.partial} | ${s.full} | ${s.end} |`)
	}
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	writeFileSync(resolve('ci-results/ltf1-be-resolution.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/ltf1-be-resolution.json'), JSON.stringify({
		config: { stopMult: STOP_MULT, warmup: WARMUP, minSubbars: MIN_SUBBARS, envelopeTol: ENVELOPE_TOL, pseudoShift: PSEUDO_SHIFT },
		perDataset,
		pooled: {
			real: Object.fromEntries(BE_VARIANTS.map((v) => [v, summarizeLtf(pooled.real[v])])),
			pseudo: Object.fromEntries(BE_VARIANTS.map((v) => [v, summarizeLtf(pooled.pseudo[v])])),
			ohlcMeans, wOhlc, wLtf, classChanges: pooled.classChanges,
		},
		verdict,
	}, null, 2))
	console.log(`\nW_ohlc=${wOhlc.toFixed(4)} W_ltf=${wLtf.toFixed(4)} ambiguity=${pc(ambShare)}\nVERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
