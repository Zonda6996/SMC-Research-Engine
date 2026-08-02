/**
 * N1: volume-transform family search. Spec frozen in
 * ci-results/n1-volume-transforms-preregistration.md (committed before this file).
 *
 * 10 causal transforms of volume; selection ONLY on the two development datasets
 * (maximin AUC); max-T permutation across the family (2000 perms, seed 4242);
 * everything else is diagnostic. Reuses the unit-tested case-control machinery.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildCaseControl, computeBaseFeatures, mulberry32, type EpisodeCC } from './auditFngCaseControl.js'
import { developmentDatasets, loadReversalDatasets } from './config/reversalDatasets.js'
import type { ExactDirection, ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { parseBatch2Csv } from './runFngOosConfirmation.js'

export const SEED = 4242
export const N_PERMS = 2000

export const TRANSFORM_NAMES = [
	'vp50', 'vp20', 'vp100', 'vz50', 'vz20', 'logvp50', 'vmax10', 'vrank200', 'svz50', 'vp50_2bar',
] as const
export type TransformName = (typeof TRANSFORM_NAMES)[number]

/** Compute all 10 causal transforms; svz50 mirrored later per episode side. */
export function computeVolumeTransforms(rows: ExactIndicatorRow[], volumes: number[]): Array<Record<TransformName, number> | null> {
	const n = rows.length
	const sma = (w: number): number[] => {
		const out = new Array<number>(n).fill(NaN)
		let s = 0
		for (let i = 0; i < n; i++) {
			s += volumes[i]!
			if (i >= w) s -= volumes[i - w]!
			if (i >= w - 1) out[i] = s / w
		}
		return out
	}
	const sd = (w: number, mean: number[]): number[] => {
		const out = new Array<number>(n).fill(NaN)
		let s2 = 0
		for (let i = 0; i < n; i++) {
			s2 += volumes[i]! * volumes[i]!
			if (i >= w) s2 -= volumes[i - w]! * volumes[i - w]!
			if (i >= w - 1 && Number.isFinite(mean[i]!)) {
				const v = s2 / w - mean[i]! * mean[i]!
				out[i] = v > 0 ? Math.sqrt(v) : 0
			}
		}
		return out
	}
	const sma20 = sma(20)
	const sma50 = sma(50)
	const sma100 = sma(100)
	const sd20 = sd(20, sma20)
	const sd50 = sd(50, sma50)

	const out: Array<Record<TransformName, number> | null> = new Array(n).fill(null)
	for (let i = 0; i < n; i++) {
		const v = volumes[i]!
		let prevMax = -Infinity
		if (i >= 10) for (let k = i - 10; k < i; k++) prevMax = Math.max(prevMax, volumes[k]!)
		let rank = NaN
		if (i >= 199) {
			let below = 0
			for (let k = i - 199; k <= i; k++) if (volumes[k]! <= v) below++
			rank = below / 200
		}
		const vp50 = Number.isFinite(sma50[i]!) && sma50[i]! > 0 ? v / sma50[i]! : NaN
		const vz50v = Number.isFinite(sd50[i]!) && sd50[i]! > 0 ? (v - sma50[i]!) / sd50[i]! : NaN
		const vals: Record<TransformName, number> = {
			vp50,
			vp20: Number.isFinite(sma20[i]!) && sma20[i]! > 0 ? v / sma20[i]! : NaN,
			vp100: Number.isFinite(sma100[i]!) && sma100[i]! > 0 ? v / sma100[i]! : NaN,
			vz50: vz50v,
			vz20: Number.isFinite(sd20[i]!) && sd20[i]! > 0 ? (v - sma20[i]!) / sd20[i]! : NaN,
			logvp50: Number.isFinite(vp50) ? Math.log(1 + vp50) : NaN,
			vmax10: i >= 10 && prevMax > 0 ? v / prevMax : NaN,
			vrank200: rank,
			svz50: Number.isFinite(vz50v) ? Math.sign(rows[i]!.close - rows[i]!.open) * vz50v : NaN,
			vp50_2bar: i >= 1 && Number.isFinite(sma50[i]!) && sma50[i]! > 0 ? (v + volumes[i - 1]!) / (2 * sma50[i]!) : NaN,
		}
		out[i] = (Object.keys(vals) as TransformName[]).every((k) => Number.isFinite(vals[k])) ? vals : null
	}
	return out
}

export interface TransformEpisode {
	direction: ExactDirection
	caseIndex: number
	controlIndices: number[]
	values: Map<number, Record<TransformName, number>>
}

/** Attach transform values to case-control episodes; drop bars lacking transforms; mirror svz50 for shorts. */
export function attachTransforms(episodes: EpisodeCC[], transforms: Array<Record<TransformName, number> | null>): TransformEpisode[] {
	const out: TransformEpisode[] = []
	for (const ep of episodes) {
		if (transforms[ep.caseIndex] == null) continue
		const values = new Map<number, Record<TransformName, number>>()
		const put = (idx: number) => {
			const t = transforms[idx]!
			values.set(idx, ep.direction === 'short' ? { ...t, svz50: -t.svz50 } : t)
		}
		put(ep.caseIndex)
		const controls = ep.controlIndices.filter((c) => transforms[c] != null)
		if (controls.length === 0) continue
		for (const c of controls) put(c)
		out.push({ direction: ep.direction, caseIndex: ep.caseIndex, controlIndices: controls, values })
	}
	return out
}

export function transformAucs(episodes: TransformEpisode[]): Record<TransformName, number> {
	const result = {} as Record<TransformName, number>
	for (const t of TRANSFORM_NAMES) {
		let wins = 0
		let pairs = 0
		for (const ep of episodes) {
			const cv = ep.values.get(ep.caseIndex)![t]
			for (const c of ep.controlIndices) {
				const kv = ep.values.get(c)![t]
				wins += cv > kv ? 1 : cv === kv ? 0.5 : 0
				pairs++
			}
		}
		result[t] = pairs > 0 ? wins / pairs : 0.5
	}
	return result
}

/** max-T permutation across the 10-transform family (rank-sum optimized). */
export function familyMaxTP(episodes: TransformEpisode[], observedMaxDev: number, nPerms: number, seed: number): number {
	const flatValues: number[][] = TRANSFORM_NAMES.map(() => [])
	const episodeFlat: number[][] = []
	for (const ep of episodes) {
		const flats: number[] = []
		for (const idx of [ep.caseIndex, ...ep.controlIndices]) {
			const vals = ep.values.get(idx)!
			flats.push(flatValues[0]!.length)
			for (let t = 0; t < TRANSFORM_NAMES.length; t++) flatValues[t]!.push(vals[TRANSFORM_NAMES[t]!])
		}
		episodeFlat.push(flats)
	}
	const total = flatValues[0]!.length
	const nc = episodes.length
	const nk = total - nc
	const ranks = flatValues.map((vals) => {
		const order = vals.map((_, i) => i).sort((a, b) => vals[a]! - vals[b]!)
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
	const rng = mulberry32(seed)
	let ge = 0
	for (let p = 0; p < nPerms; p++) {
		const picks: number[] = []
		for (const flats of episodeFlat) picks.push(flats[Math.floor(rng() * flats.length)]!)
		let maxDev = 0
		for (let t = 0; t < TRANSFORM_NAMES.length; t++) {
			let r = 0
			for (const f of picks) r += ranks[t]![f]!
			const auc = (r - (nc * (nc + 1)) / 2) / (nc * nk)
			maxDev = Math.max(maxDev, Math.abs(auc - 0.5))
		}
		if (maxDev >= observedMaxDev) ge++
	}
	return (1 + ge) / (1 + nPerms)
}

async function main() {
	interface DatasetOut {
		datasetId: string
		role: 'development' | 'diagnostic-original' | 'diagnostic-batch2'
		episodes: number
		aucs: Record<TransformName, number>
		maxTP?: number
	}
	const results: DatasetOut[] = []

	// original corpus
	const original = loadReversalDatasets()
	const devIds = new Set(developmentDatasets(original).map((d) => d.meta.id))
	for (const dataset of original) {
		const volPath = resolve(`data/vendor-exports/volume/${dataset.meta.id}.json`)
		if (!existsSync(volPath)) throw new Error(`missing volume for ${dataset.meta.id}`)
		const volJson = JSON.parse(readFileSync(volPath, 'utf8')) as { rows: Array<{ timestamp: number; volume: number }> }
		const volMap = new Map(volJson.rows.map((r) => [r.timestamp, r.volume]))
		const volumes = dataset.rows.map((r) => {
			const v = volMap.get(r.timestamp)
			if (v == null) throw new Error(`missing volume at ${r.timestamp} in ${dataset.meta.id}`)
			return v
		})
		const base = computeBaseFeatures(dataset.rows, volumes)
		const { episodes } = buildCaseControl(dataset.rows, base)
		const eps = attachTransforms(episodes, computeVolumeTransforms(dataset.rows, volumes))
		const aucs = transformAucs(eps)
		const isDev = devIds.has(dataset.meta.id)
		const entry: DatasetOut = {
			datasetId: dataset.meta.id,
			role: isDev ? 'development' : 'diagnostic-original',
			episodes: eps.length,
			aucs,
		}
		if (isDev) {
			const maxDev = Math.max(...TRANSFORM_NAMES.map((t) => Math.abs(aucs[t] - 0.5)))
			entry.maxTP = familyMaxTP(eps, maxDev, N_PERMS, SEED)
		}
		results.push(entry)
		console.log(`[done] ${dataset.meta.id} (${entry.role}) episodes=${eps.length}`)
	}

	// batch-2 corpus (diagnostic only)
	const manifest = JSON.parse(readFileSync(resolve('data/vendor-exports/manifest-batch2.json'), 'utf8')) as {
		datasets: Array<{ id: string; file: string; warmupRows: number }>
	}
	for (const ds of manifest.datasets) {
		const all = parseBatch2Csv(readFileSync(resolve('data/vendor-exports', ds.file), 'utf8'))
		const rows = all.slice(ds.warmupRows)
		const volumes = rows.map((r) => r.volume)
		const base = computeBaseFeatures(rows, volumes)
		const { episodes } = buildCaseControl(rows, base)
		const eps = attachTransforms(episodes, computeVolumeTransforms(rows, volumes))
		results.push({ datasetId: ds.id, role: 'diagnostic-batch2', episodes: eps.length, aucs: transformAucs(eps) })
		console.log(`[done] ${ds.id} (diagnostic-batch2) episodes=${eps.length}`)
	}

	// frozen selection: maximin across the two development datasets
	const dev = results.filter((r) => r.role === 'development')
	const winner = TRANSFORM_NAMES.reduce((best, t) => {
		const minAuc = (x: TransformName) => Math.min(...dev.map((d) => d.aucs[x]))
		return minAuc(t) > minAuc(best) ? t : best
	})
	const winnerMinDev = Math.min(...dev.map((d) => d.aucs[winner]))
	const strongBar = dev.every((d) => d.aucs[winner] >= 0.7) && dev.every((d) => (d.maxTP ?? 1) <= 0.05)
	const diagnostics = results.filter((r) => r.role !== 'development')
	const reversals = diagnostics.filter((d) => d.aucs[winner] < 0.5).length
	const verdict = strongBar
		? reversals >= 3
			? `FRAGILE (winner ${winner} passes dev bar but reverses on ${reversals} diagnostic datasets)`
			: `STRONG (winner ${winner}) - N2 detector experiment authorized for drafting`
		: `NO IMPROVEMENT (winner ${winner}, min dev AUC ${winnerMinDev.toFixed(3)} < 0.70 bar)`

	const md: string[] = []
	md.push('# N1 volume-transform family results')
	md.push('')
	md.push('Pre-registration: `n1-volume-transforms-preregistration.md` (committed before this script existed). Selection ONLY on development datasets (maximin); batch-2 diagnostic (hypothesis-seen).')
	md.push('')
	md.push('| dataset | role | episodes | ' + TRANSFORM_NAMES.join(' | ') + ' | max-T p |')
	md.push('|---|---|---|' + TRANSFORM_NAMES.map(() => '---').join('|') + '|---|')
	for (const r of results) {
		md.push(`| ${r.datasetId} | ${r.role} | ${r.episodes} | ` + TRANSFORM_NAMES.map((t) => r.aucs[t].toFixed(3)).join(' | ') + ` | ${r.maxTP?.toFixed(4) ?? '-'} |`)
	}
	md.push('')
	md.push(`Winner (frozen maximin on dev): **${winner}**, min dev AUC ${winnerMinDev.toFixed(3)}; diagnostic reversals: ${reversals}/${diagnostics.length}.`)
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	writeFileSync(resolve('ci-results/n1-volume-transforms.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/n1-volume-transforms.json'), JSON.stringify({ config: { seed: SEED, nPerms: N_PERMS, transforms: TRANSFORM_NAMES }, results, winner, winnerMinDev, verdict }, null, 2))
	console.log(`\nWINNER: ${winner} (min dev AUC ${winnerMinDev.toFixed(3)})\nVERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
