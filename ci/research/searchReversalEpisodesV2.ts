import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chronologicalSlices, developmentDatasets, futuresHoldouts, loadReversalDatasets, spotHoldouts } from './config/reversalDatasets.js'
import { exactEvents, type ExactIndicatorDataset } from './lib/exactIndicatorExport.js'
import { matchDirectionalEvents, type EventMetrics } from './lib/eventMetrics.js'
import {
	buildReversalEpisodeFeatures,
	detectReversalEpisodes,
	REVERSAL_EPISODE_RESEARCH_VERSION,
	type EpisodeConfirm,
	type EpisodeOscillator,
	type EpisodeRearm,
	type ReversalEpisodeConfig,
} from '../../src/core/signals/ReversalEpisodeResearch.js'

type Summary = Omit<EventMetrics, 'matches'>
type Cache = { dataset: ExactIndicatorDataset; features: ReturnType<typeof buildReversalEpisodeFeatures>; truth: ReturnType<typeof exactEvents> }
type SliceScore = { datasetId: string; metrics: Summary }
type Ranked = { config: ReversalEpisodeConfig; fit: SliceScore[]; fitAggregate: Summary; validation?: SliceScore[]; validationAggregate?: Summary; objective: number }

const OSCILLATORS: EpisodeOscillator[] = ['rsi', 'stoch', 'rsi-stoch']
const CONFIRMS: EpisodeConfirm[] = ['directional', 'osc-cross', 'fast-slow-cross', 'price-recovery', 'osc-cross-directional']
const REARMS: EpisodeRearm[] = ['mean', 'opposite-inner', 'cooldown']

function configs(): ReversalEpisodeConfig[] {
	const out: ReversalEpisodeConfig[] = []
	for (const armInner of [true, false]) for (const armThreshold of [15, 20, 25, 30, 35]) for (const oscillator of OSCILLATORS)
		for (const [smoothFast, smoothSlow] of [[2, 5], [3, 8], [5, 13]] as const) for (const releaseThreshold of [25, 30, 35, 40, 45])
			for (const confirm of CONFIRMS) for (const minDwellBars of [0, 2, 4, 8, 16, 32]) for (const maxEpisodeBars of [64, 128, 256])
				for (const minRecoveryWidth of [0.25, 0.5, 1]) for (const rearm of REARMS) for (const cooldownBars of [64, 128, 256, 384]) {
					if (rearm !== 'cooldown' && cooldownBars !== 64) continue
					if (confirm !== 'fast-slow-cross' && (smoothFast !== 3 || smoothSlow !== 8)) continue
					if (confirm !== 'price-recovery' && minRecoveryWidth !== 0.25) continue
					if (confirm !== 'osc-cross' && confirm !== 'osc-cross-directional' && releaseThreshold !== 35) continue
					out.push({ armInner, armThreshold, oscillator, smoothFast, smoothSlow, releaseThreshold, confirm, minDwellBars, maxEpisodeBars, minRecoveryWidth, rearm, cooldownBars })
				}
	return out
}

function summary(metrics: EventMetrics): Summary { const { matches: _matches, ...rest } = metrics; return rest }
function aggregate(scores: SliceScore[]): Summary {
	const tp = scores.reduce((s, x) => s + x.metrics.tp, 0), fp = scores.reduce((s, x) => s + x.metrics.fp, 0), fn = scores.reduce((s, x) => s + x.metrics.fn, 0)
	return { tp, fp, fn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), f1: 2 * tp / Math.max(1, 2 * tp + fp + fn), predictions: tp + fp, truth: tp + fn }
}
function score(caches: Cache[], config: ReversalEpisodeConfig, split: 'fit' | 'validation' | 'sealed-test' | 'all', tolerance = 0): SliceScore[] {
	return caches.map((cache) => {
		const predictions = detectReversalEpisodes(cache.dataset.rows, config, cache.features)
		let from = -Infinity, to = Infinity
		if (split !== 'all') {
			const slice = chronologicalSlices(cache.dataset).find((x) => x.kind === split)!
			from = cache.dataset.rows[slice.fromIndex]!.timestamp
			to = slice.toIndexExclusive < cache.dataset.rows.length ? cache.dataset.rows[slice.toIndexExclusive]!.timestamp : Infinity
		}
		const range = <T extends { at: number }>(events: T[]) => events.filter((event) => event.at >= from && event.at < to)
		return { datasetId: cache.dataset.meta.id, metrics: summary(matchDirectionalEvents(range(cache.truth), range(predictions), cache.dataset.meta.timeframeMs, tolerance)) }
	})
}
function objective(metrics: Summary): number {
	if (metrics.recall < 0.3) return -1 + metrics.recall
	const ratio = metrics.predictions / Math.max(1, metrics.truth)
	return metrics.f1 + 0.3 * metrics.precision + 0.15 * metrics.recall - 0.03 * Math.abs(Math.log(Math.max(1e-6, ratio)))
}
function pct(x: number) { return `${(100 * x).toFixed(2)}%` }
function table(scores: SliceScore[]) { return scores.map((x) => `| ${x.datasetId} | ${x.metrics.tp} | ${x.metrics.fp} | ${x.metrics.fn} | ${pct(x.metrics.precision)} | ${pct(x.metrics.recall)} | ${x.metrics.predictions} |`).join('\n') }

const datasets = loadReversalDatasets()
const cacheMap = new Map(datasets.map((dataset) => [dataset.meta.id, { dataset, features: buildReversalEpisodeFeatures(dataset.rows), truth: exactEvents(dataset.rows) }]))
const caches = (sets: ExactIndicatorDataset[]) => sets.map((dataset) => cacheMap.get(dataset.meta.id)!)
const development = caches(developmentDatasets(datasets))
const grid = configs()
console.log(`v2 grid ${grid.length}`)
const fitRanked: Ranked[] = grid.map((config) => { const fit = score(development, config, 'fit'); const fitAggregate = aggregate(fit); return { config, fit, fitAggregate, objective: objective(fitAggregate) } }).sort((a, b) => b.objective - a.objective)
const validationRanked = fitRanked.slice(0, 300).map((candidate) => { const validation = score(development, candidate.config, 'validation'); const validationAggregate = aggregate(validation); return { ...candidate, validation, validationAggregate, objective: objective(validationAggregate) } }).sort((a, b) => b.objective - a.objective)
const winner = validationRanked[0]!
const sealed = score(development, winner.config, 'sealed-test'), futures = score(caches(futuresHoldouts(datasets)), winner.config, 'all'), spot = score(caches(spotHoldouts(datasets)), winner.config, 'all')
const sealedAggregate = aggregate(sealed), futuresAggregate = aggregate(futures), spotAggregate = aggregate(spot)
const plusMinusOne = score(caches(datasets), winner.config, 'all', 1)
const gate = { passed: futures.every((x) => x.metrics.precision >= 0.15 && x.metrics.recall >= 0.4 && x.metrics.predictions / Math.max(1, x.metrics.truth) >= 0.5 && x.metrics.predictions / Math.max(1, x.metrics.truth) <= 2) }
const report = { version: REVERSAL_EPISODE_RESEARCH_VERSION, protocol: { gridSize: grid.length, fit: 'first 50% BTC 15m/1h', validation: 'next 25%, top 300 only', sealed: 'last 25%', holdouts: 'ETH futures 15m and BTC futures 5m/4h; SOL spot separate' }, winner, sealed: { slices: sealed, aggregate: sealedAggregate }, futures: { slices: futures, aggregate: futuresAggregate }, spot: { slices: spot, aggregate: spotAggregate }, plusMinusOne, gate, topValidation: validationRanked.slice(0, 25) }
const md = `# Reversal long-memory episode search v2\n\n- Engine: \`${REVERSAL_EPISODE_RESEARCH_VERSION}\`.\n- Grid: ${grid.length} causal long-memory machines.\n- Search uses 50% fit → top 300 only on 25% validation → one sealed 25% report.\n- Futures group holdouts and SOL Spot were not used for selection.\n\n## Winner\n\n\`\`\`json\n${JSON.stringify(winner.config, null, 2)}\n\`\`\`\n\n| Split | Precision | Recall | F1 | Predictions / truth |\n|---|---:|---:|---:|---:|\n| fit | ${pct(winner.fitAggregate.precision)} | ${pct(winner.fitAggregate.recall)} | ${pct(winner.fitAggregate.f1)} | ${(winner.fitAggregate.predictions / winner.fitAggregate.truth).toFixed(2)} |\n| validation | ${pct(winner.validationAggregate!.precision)} | ${pct(winner.validationAggregate!.recall)} | ${pct(winner.validationAggregate!.f1)} | ${(winner.validationAggregate!.predictions / winner.validationAggregate!.truth).toFixed(2)} |\n| sealed | ${pct(sealedAggregate.precision)} | ${pct(sealedAggregate.recall)} | ${pct(sealedAggregate.f1)} | ${(sealedAggregate.predictions / sealedAggregate.truth).toFixed(2)} |\n\n## Futures holdouts\n\n| Dataset | TP | FP | FN | Precision | Recall | Predictions |\n|---|---:|---:|---:|---:|---:|---:|\n${table(futures)}\n\nAggregate ${pct(futuresAggregate.precision)} precision / ${pct(futuresAggregate.recall)} recall.\n\n## SOL Spot — separate\n\n| Dataset | TP | FP | FN | Precision | Recall | Predictions |\n|---|---:|---:|---:|---:|---:|---:|\n${table(spot)}\n\n## Gate\n\n${gate.passed ? '**PASS**' : '**FAIL**'} — production remains unchanged unless every Futures holdout passes 15% precision, 40% recall and 0.5–2.0 count ratio.\n`
mkdirSync(resolve('ci-results'), { recursive: true }); writeFileSync(resolve('ci-results/reversal-episode-search-v2.json'), JSON.stringify(report, null, 2)); writeFileSync(resolve('ci-results/reversal-episode-search-v2.md'), md); console.log(md)
