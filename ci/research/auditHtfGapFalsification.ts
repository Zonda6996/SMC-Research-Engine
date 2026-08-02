/**
 * H2/H3 falsification audit. Spec frozen in
 * ci-results/htf-gap-falsification-preregistration.md (committed before this file).
 *
 * H2: descriptive global and same-side gap distributions; identifiability discussion only.
 * H3: cross-TF coincidence with identical wall-clock windows (+/-30m/60m/240m),
 *     circular-shift null (10,000 deterministic shifts, seed 1337, common shift for the
 *     whole LTF label stream, near-zero shifts excluded), per-HTF-event binary hits,
 *     one-to-one matching, opposite-direction control, leave-one-HTF-event-out,
 *     four-TF common-overlap diagnostic, mechanical kill-criteria evaluation.
 *
 * Library functions are exported for unit tests; main runs only when invoked directly.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadReversalDatasets } from './config/reversalDatasets.js'
import { exactEvents, type ExactDirection } from './lib/exactIndicatorExport.js'
import type { TimedDirectionalEvent } from './lib/eventMetrics.js'

export const SEED = 1337
export const N_SHIFTS = 10_000
export const WINDOWS_MIN = [30, 60, 240] as const
export const MAX_WINDOW_MS = 240 * 60_000

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Deterministic shift offsets in [E, L-E), one per permutation. */
export function shiftOffsets(overlapLengthMs: number, excludeMs: number, n: number, seed: number): number[] {
	const rng = mulberry32(seed)
	const span = overlapLengthMs - 2 * excludeMs
	if (span <= 0) return []
	const out: number[] = []
	for (let i = 0; i < n; i++) out.push(excludeMs + rng() * span)
	return out
}

/** Circularly shift the whole stream by s ms inside [t0, t1); preserves sides, gaps, clustering. */
export function circularShift(events: TimedDirectionalEvent[], t0: number, t1: number, s: number): TimedDirectionalEvent[] {
	const L = t1 - t0
	return events
		.map((e) => ({ at: t0 + ((((e.at - t0 + s) % L) + L) % L), direction: e.direction }))
		.sort((a, b) => a.at - b.at)
}

export type MatchMode = 'same' | 'opposite'

function directionMatches(htf: ExactDirection, ltf: ExactDirection, mode: MatchMode): boolean {
	return mode === 'same' ? htf === ltf : htf !== ltf
}

/** Per-HTF-event binary hit: any qualifying LTF event within windowMs. */
export function perEventHits(htfEvents: TimedDirectionalEvent[], ltfSorted: TimedDirectionalEvent[], windowMs: number, mode: MatchMode): boolean[] {
	return htfEvents.map((h) => {
		// binary search left boundary
		let lo = 0
		let hi = ltfSorted.length
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (ltfSorted[mid]!.at < h.at - windowMs) lo = mid + 1
			else hi = mid
		}
		for (let j = lo; j < ltfSorted.length && ltfSorted[j]!.at <= h.at + windowMs; j++) {
			if (directionMatches(h.direction, ltfSorted[j]!.direction, mode)) return true
		}
		return false
	})
}

export interface OneToOnePair {
	htfAt: number
	ltfAt: number
	direction: ExactDirection
	deltaMs: number
}

/** Greedy one-to-one matching by |dt|; each LTF event used at most once. */
export function oneToOneMatches(htfEvents: TimedDirectionalEvent[], ltfEvents: TimedDirectionalEvent[], windowMs: number, mode: MatchMode): OneToOnePair[] {
	const candidates: Array<{ h: number; l: number; abs: number }> = []
	for (let hi = 0; hi < htfEvents.length; hi++) {
		for (let li = 0; li < ltfEvents.length; li++) {
			const dt = ltfEvents[li]!.at - htfEvents[hi]!.at
			if (Math.abs(dt) <= windowMs && directionMatches(htfEvents[hi]!.direction, ltfEvents[li]!.direction, mode)) {
				candidates.push({ h: hi, l: li, abs: Math.abs(dt) })
			}
		}
	}
	candidates.sort((a, b) => a.abs - b.abs || a.h - b.h || a.l - b.l)
	const usedH = new Set<number>()
	const usedL = new Set<number>()
	const out: OneToOnePair[] = []
	for (const c of candidates) {
		if (usedH.has(c.h) || usedL.has(c.l)) continue
		usedH.add(c.h)
		usedL.add(c.l)
		out.push({ htfAt: htfEvents[c.h]!.at, ltfAt: ltfEvents[c.l]!.at, direction: htfEvents[c.h]!.direction, deltaMs: ltfEvents[c.l]!.at - htfEvents[c.h]!.at })
	}
	return out.sort((a, b) => a.htfAt - b.htfAt)
}

export interface NullResult {
	observedHits: number
	observedRate: number
	nullMean: number
	nullQuantiles: { q50: number; q90: number; q95: number; q99: number }
	pValue: number
	enrichment: number
	oneToOneHits: number
	loo: { minEnrichment: number; maxEnrichment: number; maxP: number } | null
}

export function analyzePairWindow(
	htfEvents: TimedDirectionalEvent[],
	ltfEvents: TimedDirectionalEvent[],
	t0: number,
	t1: number,
	windowMs: number,
	mode: MatchMode,
	offsets: number[],
): NullResult {
	const ltfSorted = [...ltfEvents].sort((a, b) => a.at - b.at)
	const obsPerEvent = perEventHits(htfEvents, ltfSorted, windowMs, mode)
	const observedHits = obsPerEvent.filter(Boolean).length
	const nHtf = htfEvents.length
	const nullHits = new Array<number>(offsets.length)
	// per-shift per-event matrix for LOO (same-direction primary only gets LOO; caller decides)
	const nullPerEvent: Uint8Array[] = []
	for (let k = 0; k < offsets.length; k++) {
		const shifted = circularShift(ltfSorted, t0, t1, offsets[k]!)
		const pe = perEventHits(htfEvents, shifted, windowMs, mode)
		nullHits[k] = pe.filter(Boolean).length
		const row = new Uint8Array(nHtf)
		for (let e = 0; e < nHtf; e++) row[e] = pe[e] ? 1 : 0
		nullPerEvent.push(row)
	}
	const sorted = [...nullHits].sort((a, b) => a - b)
	const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0
	const nullMean = sorted.length ? nullHits.reduce((a, b) => a + b, 0) / nullHits.length : 0
	const pValue = sorted.length ? (1 + nullHits.filter((h) => h >= observedHits).length) / (1 + nullHits.length) : 1
	const enrichment = observedHits / Math.max(nullMean, 1e-9)
	// leave-one-HTF-event-out
	let loo: NullResult['loo'] = null
	if (nHtf > 1 && offsets.length) {
		let minEnr = Infinity
		let maxEnr = -Infinity
		let maxP = 0
		for (let e = 0; e < nHtf; e++) {
			const obsLoo = observedHits - (obsPerEvent[e] ? 1 : 0)
			let ge = 0
			let sum = 0
			for (let k = 0; k < offsets.length; k++) {
				const nh = nullHits[k]! - nullPerEvent[k]![e]!
				sum += nh
				if (nh >= obsLoo) ge++
			}
			const mean = sum / offsets.length
			const enr = obsLoo / Math.max(mean, 1e-9)
			const p = (1 + ge) / (1 + offsets.length)
			minEnr = Math.min(minEnr, enr)
			maxEnr = Math.max(maxEnr, enr)
			maxP = Math.max(maxP, p)
		}
		loo = { minEnrichment: minEnr, maxEnrichment: maxEnr, maxP }
	}
	const oneToOne = oneToOneMatches(htfEvents, ltfSorted, windowMs, mode)
	return {
		observedHits,
		observedRate: nHtf ? observedHits / nHtf : 0,
		nullMean,
		nullQuantiles: { q50: q(0.5), q90: q(0.9), q95: q(0.95), q99: q(0.99) },
		pValue,
		enrichment,
		oneToOneHits: oneToOne.length,
		loo,
	}
}

// ---------------- H2 helpers ----------------

export interface GapStats {
	datasetId: string
	kind: 'global' | 'buy-buy' | 'sell-sell'
	count: number
	minGap: number
	bins: Record<string, number>
	survivalAfterMin: Record<string, number>
}

export const GAP_BINS: Array<[number, number]> = [
	[0, 54], [54, 58], [58, 70], [70, 100], [100, 200], [200, 400], [400, 800], [800, Infinity],
]

export function gapStats(events: TimedDirectionalEvent[], timeframeMs: number, datasetId: string, kind: GapStats['kind']): GapStats {
	const gaps: number[] = []
	for (let i = 1; i < events.length; i++) gaps.push(Math.round((events[i]!.at - events[i - 1]!.at) / timeframeMs))
	const bins: Record<string, number> = {}
	for (const [a, b] of GAP_BINS) {
		const key = b === Infinity ? `${a}+` : `${a}-${b - 1}`
		bins[key] = gaps.filter((g) => g >= a && g < b).length
	}
	const minGap = gaps.length ? Math.min(...gaps) : -1
	const survivalAfterMin: Record<string, number> = {}
	for (const d of [0, 5, 10, 20]) {
		const g0 = minGap + d
		survivalAfterMin[`P(gap>min+${d})`] = gaps.length ? gaps.filter((g) => g > g0).length / gaps.length : 0
	}
	return { datasetId, kind, count: gaps.length, minGap, bins, survivalAfterMin }
}

// ---------------- main ----------------

async function main() {
	const datasets = loadReversalDatasets()

	// H2
	const h2: GapStats[] = []
	for (const dataset of datasets) {
		const events = exactEvents(dataset.rows)
		h2.push(gapStats(events, dataset.meta.timeframeMs, dataset.meta.id, 'global'))
		h2.push(gapStats(events.filter((e) => e.direction === 'long'), dataset.meta.timeframeMs, dataset.meta.id, 'buy-buy'))
		h2.push(gapStats(events.filter((e) => e.direction === 'short'), dataset.meta.timeframeMs, dataset.meta.id, 'sell-sell'))
	}

	// H3
	const btc = datasets.filter((d) => d.meta.symbol.includes('BTC') && d.meta.market === 'futures').sort((a, b) => a.meta.timeframeMs - b.meta.timeframeMs)
	if (btc.length !== 4) throw new Error(`expected 4 BTC futures datasets, got ${btc.length}`)
	const pairs = [
		{ id: 'P1: 15m(HTF) vs 5m(LTF)', htf: btc[1]!, ltf: btc[0]! },
		{ id: 'P2: 1h(HTF) vs 15m(LTF)', htf: btc[2]!, ltf: btc[1]! },
		{ id: 'P3: 4h(HTF) vs 1h(LTF)', htf: btc[3]!, ltf: btc[2]! },
	]
	const fourTfFrom = Math.max(...btc.map((d) => d.rows[0]!.timestamp))
	const fourTfTo = Math.min(...btc.map((d) => d.rows.at(-1)!.timestamp))

	interface PairReport {
		pair: string
		scope: 'pairwise-overlap' | 'four-tf-overlap'
		overlapFromUtc: string
		overlapToUtc: string
		htfEvents: number
		ltfEvents: number
		windows: Record<string, { same: NullResult; opposite: NullResult; oneToOnePairs: OneToOnePair[] }>
	}
	const pairReports: PairReport[] = []

	for (const scope of ['pairwise-overlap', 'four-tf-overlap'] as const) {
		for (const { id, htf, ltf } of pairs) {
			const t0 = scope === 'pairwise-overlap' ? Math.max(htf.rows[0]!.timestamp, ltf.rows[0]!.timestamp) : fourTfFrom
			const t1 = scope === 'pairwise-overlap' ? Math.min(htf.rows.at(-1)!.timestamp, ltf.rows.at(-1)!.timestamp) : fourTfTo
			if (t1 <= t0) continue
			const htfEvents = exactEvents(htf.rows).filter((e) => e.at >= t0 && e.at <= t1)
			const ltfEvents = exactEvents(ltf.rows).filter((e) => e.at >= t0 && e.at <= t1)
			const offsets = shiftOffsets(t1 - t0, MAX_WINDOW_MS, N_SHIFTS, SEED)
			const windows: PairReport['windows'] = {}
			for (const wMin of WINDOWS_MIN) {
				const wMs = wMin * 60_000
				windows[`±${wMin}m`] = {
					same: analyzePairWindow(htfEvents, ltfEvents, t0, t1, wMs, 'same', offsets),
					opposite: analyzePairWindow(htfEvents, ltfEvents, t0, t1, wMs, 'opposite', offsets),
					oneToOnePairs: oneToOneMatches(htfEvents, ltfEvents, wMs, 'same'),
				}
			}
			pairReports.push({
				pair: id,
				scope,
				overlapFromUtc: new Date(t0).toISOString(),
				overlapToUtc: new Date(t1).toISOString(),
				htfEvents: htfEvents.length,
				ltfEvents: ltfEvents.length,
				windows,
			})
		}
	}

	// Mechanical kill-criteria evaluation (pairwise-overlap scope, same-direction)
	const primary = pairReports.filter((r) => r.scope === 'pairwise-overlap')
	const winKeys = WINDOWS_MIN.map((w) => `±${w}m`)
	const sig = (r: PairReport, w: string) => r.windows[w]!.same.pValue <= 0.05

	// K1: p > 0.05 on >= 2 of 3 pairs in ALL three windows
	const k1 = winKeys.every((w) => primary.filter((r) => !sig(r, w)).length >= 2)
	// K2: every pair with any significant window loses it after single-event removal
	const sigPairs = primary.filter((r) => winKeys.some((w) => sig(r, w)))
	const k2 = sigPairs.length > 0 && sigPairs.every((r) =>
		winKeys.filter((w) => sig(r, w)).every((w) => {
			const loo = r.windows[w]!.same.loo
			return !loo || loo.maxP > 0.10 || loo.minEnrichment < 1.5
		}),
	)
	// K3: opposite control comparable wherever same-direction significant
	const sigCells: Array<{ r: PairReport; w: string }> = []
	for (const r of primary) for (const w of winKeys) if (sig(r, w)) sigCells.push({ r, w })
	const k3 = sigCells.length > 0 && sigCells.every(({ r, w }) => r.windows[w]!.opposite.enrichment >= 0.8 * r.windows[w]!.same.enrichment)
	// K4: only ±240m significant, ±30m and ±60m not, in every significant pair
	const k4 = sigPairs.length > 0 && sigPairs.every((r) => sig(r, '±240m') && !sig(r, '±30m') && !sig(r, '±60m'))
	// K5: significant pairwise results disappear on four-TF overlap with >= 8 HTF events
	const k5 = sigCells.length > 0 && sigCells.every(({ r, w }) => {
		const four = pairReports.find((x) => x.scope === 'four-tf-overlap' && x.pair === r.pair)
		if (!four || four.htfEvents < 8) return false
		return four.windows[w]!.same.pValue > 0.10
	})

	// Survival check
	const adjacentSurvive: string[] = []
	for (const w of winKeys) {
		const sigIn = primary.filter((r) => sig(r, w)).map((r) => r.pair)
		const adjacent = (sigIn.includes('P1: 15m(HTF) vs 5m(LTF)') && sigIn.includes('P2: 1h(HTF) vs 15m(LTF)')) || (sigIn.includes('P2: 1h(HTF) vs 15m(LTF)') && sigIn.includes('P3: 4h(HTF) vs 1h(LTF)'))
		if (adjacent) adjacentSurvive.push(w)
	}
	const looRobustEverywhereSig = sigCells.length > 0 && sigCells.every(({ r, w }) => {
		const loo = r.windows[w]!.same.loo
		return loo != null && loo.maxP <= 0.10 && loo.minEnrichment >= 1.5
	})
	const survives = adjacentSurvive.length > 0 && looRobustEverywhereSig && !k3
	const killTriggered = { K1: k1, K2: k2, K3: k3, K4: k4, K5: k5 }
	const anyKill = Object.values(killTriggered).some(Boolean)
	const h3Verdict = anyKill ? 'H3 rejected / not advanced (kill criteria triggered)' : survives ? 'H3 survives falsification (exploratory only; does not prove vendor mechanism; does not authorize V8)' : 'H3 inconclusive (no kill criterion strictly triggered, but survival requirements not met)'

	const datasetStatus = datasets.map((d) => ({
		dataset: d.meta.id,
		executionStatus: 'sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics',
		hypothesisStatusH2H3: 'hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit)',
		permittedFutureUse: 'reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them',
	}))

	const json = { config: { seed: SEED, nShifts: N_SHIFTS, windowsMin: WINDOWS_MIN, excludeMs: MAX_WINDOW_MS, nullModel: 'common circular shift of LTF stream in wall-clock ms within overlap' }, h2, pairReports, killTriggered, adjacentSurviveWindows: adjacentSurvive, h3Verdict, datasetStatus }
	writeFileSync(resolve('ci-results/htf-gap-falsification.json'), JSON.stringify(json, null, 2))

	// Markdown report
	const md: string[] = []
	md.push('# H2/H3 falsification audit results')
	md.push('')
	md.push('Pre-registration: `htf-gap-falsification-preregistration.md` (committed before this script existed). Seed 1337, 10,000 circular shifts, windows ±30m/±60m/±240m frozen.')
	md.push('')
	md.push('## H2: gap distributions (descriptive)')
	md.push('')
	md.push('| dataset | kind | n gaps | min | ' + GAP_BINS.map(([a, b]) => (b === Infinity ? `${a}+` : `${a}-${b - 1}`)).join(' | ') + ' |')
	md.push('|---|---|---|---|' + GAP_BINS.map(() => '---').join('|') + '|')
	for (const g of h2) md.push(`| ${g.datasetId} | ${g.kind} | ${g.count} | ${g.minGap} | ` + Object.values(g.bins).join(' | ') + ' |')
	md.push('')
	md.push('**H2 verdict: not identifiable from label gaps alone.** No global gap violates any candidate global-cooldown constant <= the observed minimum, and absence of floor pile-up cannot discriminate cooldown vs rolling extremum vs sparse candidate stream without the unobserved candidate process. The earlier "soft floor => rolling window, explicit cooldown unlikely" inference is hereby RETRACTED as overreach.')
	md.push('')
	md.push('## H3: cross-TF coincidence under circular-shift null')
	md.push('')
	for (const r of pairReports) {
		md.push(`### ${r.pair} [${r.scope}]`)
		md.push('')
		md.push(`Overlap ${r.overlapFromUtc} .. ${r.overlapToUtc}; HTF events ${r.htfEvents}, LTF events ${r.ltfEvents}.`)
		md.push('')
		md.push('| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |')
		md.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
		for (const [w, cell] of Object.entries(r.windows)) {
			for (const mode of ['same', 'opposite'] as const) {
				const x = cell[mode]
				md.push(`| ${w} | ${mode} | ${x.observedHits}/${r.htfEvents} | ${(100 * x.observedRate).toFixed(1)}% | ${x.nullMean.toFixed(2)} | ${x.nullQuantiles.q95} | ${x.nullQuantiles.q99} | ${x.pValue.toFixed(4)} | ${x.enrichment.toFixed(2)}x | ${x.oneToOneHits} | ${x.loo ? x.loo.minEnrichment.toFixed(2) : '-'} | ${x.loo ? x.loo.maxP.toFixed(4) : '-'} |`)
			}
		}
		md.push('')
	}
	md.push('## Kill criteria (pre-registered)')
	md.push('')
	for (const [k, v] of Object.entries(killTriggered)) md.push(`- ${k}: ${v ? 'TRIGGERED' : 'not triggered'}`)
	md.push(`- Adjacent-pair survival windows: ${adjacentSurvive.length ? adjacentSurvive.join(', ') : 'none'}`)
	md.push('')
	md.push(`## H3 verdict\n\n**${h3Verdict}**`)
	md.push('')
	md.push('## Dataset status table')
	md.push('')
	md.push('| dataset | execution status | hypothesis status for H2/H3 | permitted future use |')
	md.push('|---|---|---|---|')
	for (const s of datasetStatus) md.push(`| ${s.dataset} | ${s.executionStatus} | ${s.hypothesisStatusH2H3} | ${s.permittedFutureUse} |`)
	md.push('')
	md.push('## Future OOS specification (NOT requested now)')
	md.push('')
	md.push('Either (a) appended future period after a fixed cutoff date on the same symbols/TFs, or (b) a new futures symbol with TF companions (e.g. 5m+15m+1h, ideally 4h), Risk mode, continuous UTC range, closed candles only, OHLC + all five Apex lines + Shape0/Shape1, manifest with counts and SHA-256. The period/symbol must be hypothesis-unseen for any H2/H3-derived model.')
	writeFileSync(resolve('ci-results/htf-gap-falsification.md'), md.join('\n'))
	console.log(md.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
