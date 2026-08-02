/**
 * OOS confirmation of the volPressure discriminator on the batch-2 corpus.
 * Spec frozen in ci-results/fng-oos-confirmation-preregistration.md (committed
 * before this file existed). ONE run; batch-2 becomes hypothesis-seen after it.
 *
 * Reuses the unit-tested discovery-audit library (computeBaseFeatures,
 * buildCaseControl, computeAucTable, mulberry32). Primary statistic: volPressure
 * AUC + one-sided within-episode permutation p (2000 perms, seed 4242).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	FEATURE_NAMES,
	buildCaseControl,
	computeAucTable,
	computeBaseFeatures,
	mulberry32,
	type EpisodeCC,
	type FeatureName,
} from './auditFngCaseControl.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

export const SEED = 4242
export const N_PERMS = 2000

export interface Batch2Row extends ExactIndicatorRow {
	volume: number
}

/** Parse a batch-2 TradingView CSV (ISO timestamps, vendor band columns, inline Volume). */
export function parseBatch2Csv(text: string): Batch2Row[] {
	const lines = text.trim().split('\n')
	const header = lines[0]!
	if (!header.startsWith('time,open,high,low,close,GGI') || header.split(',').length !== 13) {
		throw new Error(`unexpected batch-2 header: ${header}`)
	}
	if (lines.length < 2) throw new Error('batch-2 csv has no data rows')
	const rows: Batch2Row[] = []
	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i]!.split(',')
		if (parts.length !== 13) throw new Error(`row ${i}: expected 13 columns, got ${parts.length}`)
		const timestamp = Date.parse(parts[0]!)
		if (!Number.isFinite(timestamp)) throw new Error(`row ${i}: bad timestamp ${parts[0]}`)
		rows.push({
			timestamp,
			open: Number(parts[1]),
			high: Number(parts[2]),
			low: Number(parts[3]),
			close: Number(parts[4]),
			mean: Number(parts[5]),
			upperOuter: Number(parts[6]),
			upperInner: Number(parts[7]),
			lowerInner: Number(parts[8]),
			lowerOuter: Number(parts[9]),
			buy: parts[10] === '1',
			sell: parts[11] === '1',
			volume: Number(parts[12]),
		})
	}
	for (let i = 1; i < rows.length; i++) {
		if (rows[i]!.timestamp <= rows[i - 1]!.timestamp) throw new Error(`row ${i}: timestamps not strictly increasing`)
	}
	return rows
}

/** One-sided within-episode permutation p for a SINGLE feature (P(perm AUC >= observed)). */
export function singleFeaturePermutationP(
	episodes: EpisodeCC[],
	feature: FeatureName,
	observedAuc: number,
	nPerms: number,
	seed: number,
): number {
	// pooled values are permutation-invariant -> precompute average ranks once
	const flatValues: number[] = []
	const episodeFlat: number[][] = []
	for (const ep of episodes) {
		const flats: number[] = []
		for (const idx of [ep.caseIndex, ...ep.controlIndices]) {
			flats.push(flatValues.length)
			flatValues.push(ep.features.get(idx)![feature])
		}
		episodeFlat.push(flats)
	}
	const total = flatValues.length
	const nc = episodes.length
	const nk = total - nc
	const order = flatValues.map((_, i) => i).sort((a, b) => flatValues[a]! - flatValues[b]!)
	const ranks = new Float64Array(total)
	let i = 0
	while (i < total) {
		let j = i
		while (j + 1 < total && flatValues[order[j + 1]!]! === flatValues[order[i]!]!) j++
		const avg = (i + j + 2) / 2
		for (let k = i; k <= j; k++) ranks[order[k]!] = avg
		i = j + 1
	}
	const rng = mulberry32(seed)
	let ge = 0
	for (let p = 0; p < nPerms; p++) {
		let rankSum = 0
		for (const flats of episodeFlat) rankSum += ranks[flats[Math.floor(rng() * flats.length)]!]!
		const permAuc = (rankSum - (nc * (nc + 1)) / 2) / (nc * nk)
		if (permAuc >= observedAuc) ge++
	}
	return (1 + ge) / (1 + nPerms)
}

interface ManifestEntry {
	id: string
	file: string
	symbol: string
	timeframe: string
	warmupRows: number
}

async function main() {
	const manifest = JSON.parse(readFileSync(resolve('data/vendor-exports/manifest-batch2.json'), 'utf8')) as {
		datasets: ManifestEntry[]
	}
	const NEW_SYMBOLS = new Set(['ondo-perp-15m-b2', 'ondo-perp-1h-b2', 'ondo-perp-2h-b2', 'bnb-perp-3m-b2', 'sp500-cfd-1m-b2'])

	interface DatasetOut {
		datasetId: string
		newSymbol: boolean
		rowsAnalyzed: number
		labeledEpisodes: number
		labelsOutsideEpisodes: number
		volPressureAuc: number
		medianCase: number
		medianControl: number
		pOneSided: number
		passes: boolean
		significantReversal: boolean
		diagnostics: Array<{ feature: string; auc: number }>
	}
	const out: DatasetOut[] = []

	for (const ds of manifest.datasets) {
		const raw = readFileSync(resolve('data/vendor-exports', ds.file), 'utf8')
		const all = parseBatch2Csv(raw)
		const rows = all.slice(ds.warmupRows)
		const volumes = rows.map((r) => r.volume)
		const base = computeBaseFeatures(rows, volumes)
		const { episodes, labelsOutsideEpisodes } = buildCaseControl(rows, base)
		const table = computeAucTable(episodes)
		const vp = table.find((t) => t.feature === 'volPressure')!
		const p = singleFeaturePermutationP(episodes, 'volPressure', vp.auc, N_PERMS, SEED)
		const pReversed = singleFeaturePermutationP(episodes, 'volPressure', 1 - vp.auc, N_PERMS, SEED)
		const passes = vp.auc >= 0.6 && p <= 0.05
		const significantReversal = vp.auc <= 0.4 && pReversed <= 0.05
		out.push({
			datasetId: ds.id,
			newSymbol: NEW_SYMBOLS.has(ds.id),
			rowsAnalyzed: rows.length,
			labeledEpisodes: episodes.length,
			labelsOutsideEpisodes,
			volPressureAuc: vp.auc,
			medianCase: vp.medianCase,
			medianControl: vp.medianControl,
			pOneSided: p,
			passes,
			significantReversal,
			diagnostics: table.filter((t) => t.feature !== 'volPressure').map((t) => ({ feature: t.feature, auc: t.auc })),
		})
		console.log(
			`[done] ${ds.id}: episodes=${episodes.length} volPressure AUC=${vp.auc.toFixed(3)} p=${p.toFixed(4)} ${passes ? 'PASS' : 'fail'}`,
		)
	}

	const nPass = out.filter((o) => o.passes).length
	const anyReversal = out.some((o) => o.significantReversal)
	const newSymbolPass = out.filter((o) => o.newSymbol && o.passes).length
	const newSymbolTotal = out.filter((o) => o.newSymbol).length
	const verdict = anyReversal
		? 'REFUTED (significant reversal present)'
		: nPass >= 6
			? 'CONFIRMED'
			: nPass >= 4
				? 'PARTIAL'
				: 'REFUTED'

	const md: string[] = []
	md.push('# OOS confirmation run: volPressure on batch-2')
	md.push('')
	md.push(
		'Pre-registration: `fng-oos-confirmation-preregistration.md` (committed before this script existed). Single run; batch-2 is now hypothesis-SEEN for volume-derived ideas.',
	)
	md.push('')
	md.push('| dataset | new symbol | episodes | volPressure AUC | median case | median control | p (one-sided) | pass |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const o of out) {
		md.push(
			`| ${o.datasetId} | ${o.newSymbol ? 'yes' : 'no'} | ${o.labeledEpisodes} | ${o.volPressureAuc.toFixed(3)} | ${o.medianCase.toFixed(2)} | ${o.medianControl.toFixed(2)} | ${o.pOneSided.toFixed(4)} | ${o.passes ? 'PASS' : 'fail'} |`,
		)
	}
	md.push('')
	md.push(`Passing datasets: **${nPass} / 8** (frozen thresholds: AUC >= 0.60 and p <= 0.05; CONFIRMED needs >= 6). Significant reversals: ${anyReversal ? 'YES' : 'none'}.`)
	md.push(`Fully new symbols (ONDO/BNB/SP500): **${newSymbolPass} / ${newSymbolTotal}** pass.`)
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	md.push('')
	md.push('## Diagnostics (exploratory, no confirmation weight)')
	md.push('')
	md.push('Other-feature AUCs per dataset are in the JSON. Batch-2 first-look patterns there require fresh data to confirm.')
	writeFileSync(resolve('ci-results/fng-oos-confirmation.md'), md.join('\n'))
	writeFileSync(
		resolve('ci-results/fng-oos-confirmation.json'),
		JSON.stringify({ config: { seed: SEED, nPerms: N_PERMS, features: FEATURE_NAMES }, datasets: out, nPass, newSymbolPass, newSymbolTotal, anyReversal, verdict }, null, 2),
	)
	console.log(`\nVERDICT: ${verdict} (${nPass}/8 pass; new symbols ${newSymbolPass}/${newSymbolTotal})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
