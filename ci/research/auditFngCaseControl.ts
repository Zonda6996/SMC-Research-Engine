/**
 * Fear&Greed case-control audit. Spec frozen in
 * ci-results/fng-case-control-preregistration.md (committed before this file).
 *
 * Diagnostic question: inside label-carrying episodes, does ANY of 12 frozen
 * OHLCV-computable F&G-style features distinguish the label bar from other bars
 * of the same episode? Per-feature AUC + max-T permutation (2000 perms, seed 4242).
 * No detector. Library functions exported for unit tests.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { developmentDatasets, loadReversalDatasets } from './config/reversalDatasets.js'
import type { ExactDirection, ExactIndicatorRow } from './lib/exactIndicatorExport.js'

export const SEED = 4242
export const N_PERMS = 2000
export const EPISODE_CAP_BARS = 256
export const CONTROL_BUFFER = 2

export const FEATURE_NAMES = [
	'rsi14', 'roc10', 'atrNorm14', 'atrRegime', 'devSma50', 'volPressure',
	'signedVolPress', 'bandPos', 'stoch14', 'rangePos50', 'fngComposite', 'recoveryHW',
] as const
export type FeatureName = (typeof FEATURE_NAMES)[number]

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

// ---------- causal indicator helpers (Wilder smoothing for RSI/ATR) ----------

export function computeBaseFeatures(rows: ExactIndicatorRow[], volumes: number[]): Array<Record<FeatureName, number> | null> {
	const n = rows.length
	const close = rows.map((r) => r.close)
	const out: Array<Record<FeatureName, number> | null> = new Array(n).fill(null)

	// Wilder RSI(14)
	const rsi = new Array<number>(n).fill(NaN)
	let avgGain = 0
	let avgLoss = 0
	for (let i = 1; i < n; i++) {
		const ch = close[i]! - close[i - 1]!
		const gain = Math.max(ch, 0)
		const loss = Math.max(-ch, 0)
		if (i <= 14) {
			avgGain += gain / 14
			avgLoss += loss / 14
			if (i === 14) rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
		} else {
			avgGain = (avgGain * 13 + gain) / 14
			avgLoss = (avgLoss * 13 + loss) / 14
			rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
		}
	}

	// Wilder ATR(14) and ATR(100)
	const tr = new Array<number>(n).fill(NaN)
	for (let i = 0; i < n; i++) {
		const r = rows[i]!
		tr[i] = i === 0 ? r.high - r.low : Math.max(r.high - r.low, Math.abs(r.high - close[i - 1]!), Math.abs(r.low - close[i - 1]!))
	}
	const atr14 = new Array<number>(n).fill(NaN)
	const atr100 = new Array<number>(n).fill(NaN)
	let a14 = 0
	let a100 = 0
	for (let i = 0; i < n; i++) {
		if (i < 14) a14 += tr[i]! / 14
		else a14 = (a14 * 13 + tr[i]!) / 14
		if (i >= 13) atr14[i] = a14
		if (i < 100) a100 += tr[i]! / 100
		else a100 = (a100 * 99 + tr[i]!) / 100
		if (i >= 99) atr100[i] = a100
	}

	// SMA(close,50), SMA(vol,50) via rolling sums
	const sma50 = new Array<number>(n).fill(NaN)
	const volSma50 = new Array<number>(n).fill(NaN)
	let cs = 0
	let vs = 0
	for (let i = 0; i < n; i++) {
		cs += close[i]!
		vs += volumes[i]!
		if (i >= 50) {
			cs -= close[i - 50]!
			vs -= volumes[i - 50]!
		}
		if (i >= 49) {
			sma50[i] = cs / 50
			volSma50[i] = vs / 50
		}
	}

	// rolling 50-bar high/low, 14-bar for stoch (simple loops; n<=20k, fine)
	const stoch = new Array<number>(n).fill(NaN)
	const rangePos = new Array<number>(n).fill(NaN)
	for (let i = 0; i < n; i++) {
		if (i >= 13) {
			let hh = -Infinity
			let ll = Infinity
			for (let k = i - 13; k <= i; k++) {
				hh = Math.max(hh, rows[k]!.high)
				ll = Math.min(ll, rows[k]!.low)
			}
			stoch[i] = hh > ll ? (100 * (close[i]! - ll)) / (hh - ll) : 50
		}
		if (i >= 49) {
			let hh = -Infinity
			let ll = Infinity
			for (let k = i - 49; k <= i; k++) {
				hh = Math.max(hh, rows[k]!.high)
				ll = Math.min(ll, rows[k]!.low)
			}
			rangePos[i] = hh > ll ? (close[i]! - ll) / (hh - ll) : 0.5
		}
	}

	// signed volume pressure over 10 bars
	const svp = new Array<number>(n).fill(NaN)
	for (let i = 9; i < n; i++) {
		let num = 0
		let den = 0
		for (let k = i - 9; k <= i; k++) {
			num += Math.sign(rows[k]!.close - rows[k]!.open) * volumes[k]!
			den += volumes[k]!
		}
		svp[i] = den > 0 ? num / den : 0
	}

	// causal 200-bar percentile rank helper
	const pctRank = (series: number[], i: number): number => {
		const from = Math.max(0, i - 199)
		let below = 0
		let cnt = 0
		for (let k = from; k <= i; k++) {
			if (!Number.isFinite(series[k]!)) continue
			cnt++
			if (series[k]! <= series[i]!) below++
		}
		return cnt > 0 ? below / cnt : 0.5
	}

	const roc = new Array<number>(n).fill(NaN)
	for (let i = 10; i < n; i++) roc[i] = close[i]! / close[i - 10]! - 1
	const atrNorm = atr14.map((a, i) => (Number.isFinite(a) ? a / close[i]! : NaN))
	const volP = volumes.map((v, i) => (Number.isFinite(volSma50[i]!) && volSma50[i]! > 0 ? v / volSma50[i]! : NaN))
	const invVol = atrNorm.map((x) => (Number.isFinite(x) && x > 0 ? 1 / x : NaN))

	for (let i = 0; i < n; i++) {
		const r = rows[i]!
		const innerSpan = r.upperInner - r.lowerInner
		const vals = {
			rsi14: rsi[i]!,
			roc10: roc[i]!,
			atrNorm14: atrNorm[i]!,
			atrRegime: Number.isFinite(atr14[i]!) && Number.isFinite(atr100[i]!) && atr100[i]! > 0 ? atr14[i]! / atr100[i]! : NaN,
			devSma50: Number.isFinite(sma50[i]!) ? (close[i]! - sma50[i]!) / sma50[i]! : NaN,
			volPressure: volP[i]!,
			signedVolPress: svp[i]!,
			bandPos: innerSpan > 0 ? (close[i]! - r.lowerInner) / innerSpan : NaN,
			stoch14: stoch[i]!,
			rangePos50: rangePos[i]!,
			fngComposite: (pctRank(rsi, i) + pctRank(roc, i) + pctRank(invVol, i) + pctRank(volP, i)) / 4,
			recoveryHW: NaN, // filled per-episode later
		}
		const allFinite = (Object.keys(vals) as FeatureName[]).every((k) => k === 'recoveryHW' || Number.isFinite(vals[k]))
		out[i] = allFinite ? (vals as Record<FeatureName, number>) : null
	}
	return out
}

export function mirrorForSell(v: Record<FeatureName, number>): Record<FeatureName, number> {
	return {
		...v,
		rsi14: 100 - v.rsi14,
		roc10: -v.roc10,
		devSma50: -v.devSma50,
		signedVolPress: -v.signedVolPress,
		bandPos: 1 - v.bandPos,
		stoch14: 100 - v.stoch14,
		rangePos50: 1 - v.rangePos50,
		fngComposite: 1 - v.fngComposite,
	}
}

export interface EpisodeCC {
	direction: ExactDirection
	caseIndex: number
	controlIndices: number[]
	features: Map<number, Record<FeatureName, number>>
}

/** Collect labeled episodes with case (first label bar) + controls (other episode bars, +/-buffer excluded). */
export function buildCaseControl(rows: ExactIndicatorRow[], base: Array<Record<FeatureName, number> | null>): { episodes: EpisodeCC[]; labelsOutsideEpisodes: number; droppedNoControls: number } {
	const episodes: EpisodeCC[] = []
	let outside = 0
	let dropped = 0
	for (const direction of ['long', 'short'] as const) {
		let start = -1
		let extreme = NaN
		let bars: number[] = []
		let labelBars: number[] = []
		const recovery = new Map<number, number>()
		const flush = () => {
			for (const lb of labelBars) {
				const controls = bars.filter((b) => Math.abs(b - lb) > CONTROL_BUFFER && b !== lb)
				const feats = new Map<number, Record<FeatureName, number>>()
				let ok = base[lb] != null
				if (ok) {
					const f = { ...base[lb]! }
					f.recoveryHW = recovery.get(lb)!
					feats.set(lb, direction === 'short' ? mirrorForSell(f) : f)
				}
				const validControls: number[] = []
				for (const c of controls) {
					if (base[c] == null) continue
					const f = { ...base[c]! }
					f.recoveryHW = recovery.get(c)!
					feats.set(c, direction === 'short' ? mirrorForSell(f) : f)
					validControls.push(c)
				}
				if (!ok || validControls.length === 0) dropped++
				else episodes.push({ direction, caseIndex: lb, controlIndices: validControls, features: feats })
			}
			start = -1
			extreme = NaN
			bars = []
			labelBars = []
			recovery.clear()
		}
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i]!
			const breach = direction === 'long' ? r.low <= r.lowerInner : r.high >= r.upperInner
			if (start < 0 && breach) {
				start = i
				extreme = direction === 'long' ? r.low : r.high
			}
			if (start >= 0) {
				extreme = direction === 'long' ? Math.min(extreme, r.low) : Math.max(extreme, r.high)
				const hw = direction === 'long' ? r.mean - r.lowerInner : r.upperInner - r.mean
				recovery.set(i, hw > 0 ? (direction === 'long' ? (r.close - extreme) / hw : (extreme - r.close) / hw) : 0)
				bars.push(i)
				if (direction === 'long' ? r.buy : r.sell) labelBars.push(i)
				const neutral = direction === 'long' ? r.close >= r.mean : r.close <= r.mean
				if (neutral || i - start >= EPISODE_CAP_BARS) flush()
			} else if (direction === 'long' ? r.buy : r.sell) outside++
		}
		if (start >= 0) flush()
	}
	return { episodes, labelsOutsideEpisodes: outside, droppedNoControls: dropped }
}

/** Mann-Whitney AUC: P(case > control) + 0.5*P(=). */
export function auc(cases: number[], controls: number[]): number {
	if (!cases.length || !controls.length) return 0.5
	let wins = 0
	for (const c of cases) for (const k of controls) wins += c > k ? 1 : c === k ? 0.5 : 0
	return wins / (cases.length * controls.length)
}

export interface FeatureResult {
	feature: FeatureName
	auc: number
	medianCase: number
	medianControl: number
}

export function computeAucTable(episodes: EpisodeCC[]): FeatureResult[] {
	const median = (xs: number[]) => {
		if (!xs.length) return NaN
		const s = [...xs].sort((a, b) => a - b)
		return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
	}
	return FEATURE_NAMES.map((feature) => {
		const cases: number[] = []
		const controls: number[] = []
		for (const ep of episodes) {
			cases.push(ep.features.get(ep.caseIndex)![feature])
			for (const c of ep.controlIndices) controls.push(ep.features.get(c)![feature])
		}
		return { feature, auc: auc(cases, controls), medianCase: median(cases), medianControl: median(controls) }
	})
}

/**
 * max-T permutation: re-draw case position uniformly within each episode.
 * Optimized: the pooled multiset of values is invariant across permutations
 * (each episode always contributes all its bars), so per-feature average ranks
 * are precomputed once and AUC per permutation is a rank sum:
 * AUC = (R_cases - nc(nc+1)/2) / (nc * nk).
 */
export function maxTPermutationP(episodes: EpisodeCC[], observedMaxDev: number, nPerms: number, seed: number): { p: number; nullQ95: number } {
	// flatten: for each episode, list of flat indices; ranks[f][flat]
	const flatValues: number[][] = FEATURE_NAMES.map(() => [])
	const episodeFlat: number[][] = []
	for (const ep of episodes) {
		const flats: number[] = []
		for (const idx of [ep.caseIndex, ...ep.controlIndices]) {
			const feats = ep.features.get(idx)!
			flats.push(flatValues[0]!.length)
			for (let f = 0; f < FEATURE_NAMES.length; f++) flatValues[f]!.push(feats[FEATURE_NAMES[f]!])
		}
		episodeFlat.push(flats)
	}
	const total = flatValues[0]!.length
	const nc = episodes.length
	const nk = total - nc
	// average ranks (ties averaged), 1-based
	const ranks: Float64Array[] = flatValues.map((vals) => {
		const order = vals.map((v, i) => i).sort((a, b) => vals[a]! - vals[b]!)
		const rk = new Float64Array(total)
		let i = 0
		while (i < total) {
			let j = i
			while (j + 1 < total && vals[order[j + 1]!]! === vals[order[i]!]!) j++
			const avg = (i + j + 2) / 2
			for (let k = i; k <= j; k++) rk[order[k]!] = avg
			i = j + 1
		}
		return rk
	})
	const aucFromCaseFlats = (caseFlats: number[]): number[] => {
		return FEATURE_NAMES.map((_, f) => {
			let r = 0
			for (const cf of caseFlats) r += ranks[f]![cf]!
			return (r - (nc * (nc + 1)) / 2) / (nc * nk)
		})
	}
	const rng = mulberry32(seed)
	const devs: number[] = []
	let ge = 0
	for (let p = 0; p < nPerms; p++) {
		const picks: number[] = []
		for (const flats of episodeFlat) picks.push(flats[Math.floor(rng() * flats.length)]!)
		const aucs = aucFromCaseFlats(picks)
		let maxDev = 0
		for (const a of aucs) maxDev = Math.max(maxDev, Math.abs(a - 0.5))
		devs.push(maxDev)
		if (maxDev >= observedMaxDev) ge++
	}
	devs.sort((a, b) => a - b)
	return { p: (1 + ge) / (1 + nPerms), nullQ95: devs[Math.floor(0.95 * devs.length)]! }
}

// ---------------- main ----------------

async function main() {
	const datasets = loadReversalDatasets()
	const devIds = new Set(developmentDatasets(datasets).map((d) => d.meta.id))
	interface DatasetReport {
		datasetId: string
		role: 'development' | 'holdout-diagnostic'
		labeledEpisodes: number
		labelsOutsideEpisodes: number
		droppedNoControls: number
		medianControlsPerEpisode: number
		table: FeatureResult[]
		maxDevFeature: string
		maxDev: number
		maxTP: number
		nullQ95: number
	}
	const reports: DatasetReport[] = []
	for (const dataset of datasets) {
		const volPath = resolve(`data/vendor-exports/volume/${dataset.meta.id}.json`)
		if (!existsSync(volPath)) throw new Error(`missing volume file for ${dataset.meta.id}`)
		const volJson = JSON.parse(readFileSync(volPath, 'utf8')) as { rows: Array<{ timestamp: number; volume: number }> }
		const volMap = new Map(volJson.rows.map((r) => [r.timestamp, r.volume]))
		const volumes = dataset.rows.map((r) => {
			const v = volMap.get(r.timestamp)
			if (v == null) throw new Error(`missing volume at ${r.timestamp} in ${dataset.meta.id}`)
			return v
		})
		const base = computeBaseFeatures(dataset.rows, volumes)
		const { episodes, labelsOutsideEpisodes, droppedNoControls } = buildCaseControl(dataset.rows, base)
		const table = computeAucTable(episodes)
		const maxRow = table.reduce((a, b) => (Math.abs(b.auc - 0.5) > Math.abs(a.auc - 0.5) ? b : a))
		const maxDev = Math.abs(maxRow.auc - 0.5)
		const { p, nullQ95 } = maxTPermutationP(episodes, maxDev, N_PERMS, SEED)
		const ctrlCounts = episodes.map((e) => e.controlIndices.length).sort((a, b) => a - b)
		reports.push({
			datasetId: dataset.meta.id,
			role: devIds.has(dataset.meta.id) ? 'development' : 'holdout-diagnostic',
			labeledEpisodes: episodes.length,
			labelsOutsideEpisodes,
			droppedNoControls,
			medianControlsPerEpisode: ctrlCounts.length ? ctrlCounts[Math.floor(ctrlCounts.length / 2)]! : 0,
			table,
			maxDevFeature: maxRow.feature,
			maxDev,
			maxTP: p,
			nullQ95,
		})
		console.log(`[done] ${dataset.meta.id}: ${episodes.length} episodes, maxDev=${maxDev.toFixed(3)} (${maxRow.feature}), p=${p.toFixed(4)}`)
	}

	// Pre-registered interpretation
	const dev = reports.filter((r) => r.role === 'development')
	const strongOnBoth = FEATURE_NAMES.filter((f) => dev.every((r) => {
		const row = r.table.find((t) => t.feature === f)!
		return row.auc >= 0.7 || row.auc <= 0.3
	}))
	const sigOnBoth = dev.every((r) => r.maxTP <= 0.05)
	const verdict = strongOnBoth.length > 0 && sigOnBoth
		? `F&G-SUPPORTED (features: ${strongOnBoth.join(', ')})`
		: sigOnBoth
			? 'WEAK SIGNAL (significant but below AUC 0.70 threshold on both dev datasets)'
			: 'KILL: information-insufficiency evidence (no frozen OHLCV F&G feature distinguishes the exact bar within its episode)'

	const md: string[] = []
	md.push('# F&G case-control audit results')
	md.push('')
	md.push('Pre-registration: `fng-case-control-preregistration.md` (committed before this script existed). 12 frozen features, controls = same-episode bars excluding ±2, max-T permutation 2000 perms seed 4242.')
	md.push('')
	for (const r of reports) {
		md.push(`## ${r.datasetId} [${r.role}]`)
		md.push('')
		md.push(`Labeled episodes ${r.labeledEpisodes}; labels outside episodes ${r.labelsOutsideEpisodes}; dropped (no controls) ${r.droppedNoControls}; median controls/episode ${r.medianControlsPerEpisode}.`)
		md.push('')
		md.push('| feature | AUC | median case | median control |')
		md.push('|---|---|---|---|')
		for (const t of r.table) md.push(`| ${t.feature} | ${t.auc.toFixed(3)} | ${t.medianCase.toFixed(4)} | ${t.medianControl.toFixed(4)} |`)
		md.push('')
		md.push(`Max |AUC-0.5| = ${r.maxDev.toFixed(3)} (${r.maxDevFeature}); max-T null q95 = ${r.nullQ95.toFixed(3)}; **p = ${r.maxTP.toFixed(4)}**.`)
		md.push('')
	}
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	md.push('')
	md.push('Holdout tables are consistency diagnostics only; the corpus is hypothesis-seen. Stop/TP reverse-engineering deferred: requires vendor trade exports with visible TP/stop levels (data request recorded in the pre-registration).')
	writeFileSync(resolve('ci-results/fng-case-control-audit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/fng-case-control-audit.json'), JSON.stringify({ config: { seed: SEED, nPerms: N_PERMS, features: FEATURE_NAMES }, reports, strongOnBoth, sigOnBoth, verdict }, null, 2))
	console.log('\n' + md.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
