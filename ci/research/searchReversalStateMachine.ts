import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exactEvents, type ExactIndicatorDataset } from './lib/exactIndicatorExport.js'
import { matchDirectionalEvents, type EventMetrics } from './lib/eventMetrics.js'
import { chronologicalSlices, developmentDatasets, futuresHoldouts, loadReversalDatasets, spotHoldouts } from './config/reversalDatasets.js'
import {
	buildReversalFeatureCache,
	detectReversalStateMachine,
	REVERSAL_STATE_MACHINE_RESEARCH_VERSION,
	type ReversalArmKind,
	type ReversalConfirmKind,
	type ReversalRearmKind,
	type ReversalStateMachineConfig,
} from '../../src/core/signals/ReversalStateMachineResearch.js'

interface DatasetCache {
	dataset: ExactIndicatorDataset
	features: ReturnType<typeof buildReversalFeatureCache>
	truth: ReturnType<typeof exactEvents>
}

interface SliceScore {
	datasetId: string
	slice: 'fit' | 'validation' | 'sealed-test' | 'all'
	metrics: Omit<EventMetrics, 'matches'>
}

interface CandidateScore {
	config: ReversalStateMachineConfig
	fit: SliceScore[]
	validation?: SliceScore[]
	fitAggregate: Omit<EventMetrics, 'matches'>
	validationAggregate?: Omit<EventMetrics, 'matches'>
	objective: number
}

const ARM_KINDS: ReversalArmKind[] = ['inner', 'outer', 'rsi25', 'rsi30', 'stoch20', 'inner-rsi35', 'inner-stoch30', 'range24', 'range48']
const CONFIRM_KINDS: ReversalConfirmKind[] = ['directional', 'reclaim', 'rsi-slope', 'stoch-slope', 'recovery25', 'reclaim-rsi']
const PENDING_BARS = [0, 1, 2, 4, 8, 16]
const REARMS: Array<Pick<ReversalStateMachineConfig, 'rearmKind' | 'cooldownBars' | 'neutralBars'>> = [
	{ rearmKind: 'mean', cooldownBars: 0, neutralBars: 1 },
	{ rearmKind: 'inner', cooldownBars: 0, neutralBars: 1 },
	{ rearmKind: 'neutral', cooldownBars: 0, neutralBars: 1 },
	{ rearmKind: 'neutral', cooldownBars: 0, neutralBars: 2 },
	{ rearmKind: 'neutral', cooldownBars: 0, neutralBars: 4 },
	...([4, 8, 16, 32, 64, 128] as const).map((cooldownBars) => ({ rearmKind: 'cooldown' as ReversalRearmKind, cooldownBars, neutralBars: 1 })),
]

function configs(): ReversalStateMachineConfig[] {
	const out: ReversalStateMachineConfig[] = []
	for (const armKind of ARM_KINDS) for (const maxPendingBars of PENDING_BARS) for (const confirmKind of CONFIRM_KINDS) for (const rearm of REARMS) {
		out.push({ armKind, maxPendingBars, confirmKind, ...rearm })
	}
	return out
}

function withoutMatches(metrics: EventMetrics): Omit<EventMetrics, 'matches'> {
	const { matches: _matches, ...summary } = metrics
	return summary
}

function aggregate(scores: SliceScore[]): Omit<EventMetrics, 'matches'> {
	const tp = scores.reduce((sum, score) => sum + score.metrics.tp, 0)
	const fp = scores.reduce((sum, score) => sum + score.metrics.fp, 0)
	const fn = scores.reduce((sum, score) => sum + score.metrics.fn, 0)
	const precision = tp / Math.max(1, tp + fp)
	const recall = tp / Math.max(1, tp + fn)
	const f1 = 2 * tp / Math.max(1, 2 * tp + fp + fn)
	return { tp, fp, fn, precision, recall, f1, predictions: tp + fp, truth: tp + fn }
}

function scoreSlices(cache: DatasetCache[], config: ReversalStateMachineConfig, kind: 'fit' | 'validation' | 'sealed-test' | 'all'): SliceScore[] {
	return cache.map(({ dataset, features, truth }) => {
		const predictions = detectReversalStateMachine(dataset.rows, config, features)
		let from = -Infinity, to = Infinity
		if (kind !== 'all') {
			const slice = chronologicalSlices(dataset).find((candidate) => candidate.kind === kind)!
			from = dataset.rows[slice.fromIndex]!.timestamp
			to = slice.toIndexExclusive < dataset.rows.length ? dataset.rows[slice.toIndexExclusive]!.timestamp : Infinity
		}
		const inRange = <T extends { at: number }>(events: T[]) => events.filter((event) => event.at >= from && event.at < to)
		return {
			datasetId: dataset.meta.id,
			slice: kind,
			metrics: withoutMatches(matchDirectionalEvents(inRange(truth), inRange(predictions), dataset.meta.timeframeMs, 0)),
		}
	})
}

function fitObjective(metrics: Omit<EventMetrics, 'matches'>): number {
	if (metrics.recall < 0.25) return -1 + metrics.recall
	const countRatio = metrics.predictions / Math.max(1, metrics.truth)
	const countPenalty = Math.abs(Math.log(Math.max(1e-6, countRatio)))
	return metrics.f1 + 0.25 * metrics.precision + 0.1 * metrics.recall - 0.02 * countPenalty
}

function validationObjective(metrics: Omit<EventMetrics, 'matches'>): number {
	if (metrics.recall < 0.25) return -1 + metrics.recall
	return metrics.f1 + 0.35 * metrics.precision + 0.1 * metrics.recall
}

function allScore(cache: DatasetCache[], config: ReversalStateMachineConfig): SliceScore[] {
	return scoreSlices(cache, config, 'all')
}

function pct(value: number): string { return `${(100 * value).toFixed(2)}%` }

const datasets = loadReversalDatasets()
const cached = new Map(datasets.map((dataset) => [dataset.meta.id, { dataset, features: buildReversalFeatureCache(dataset.rows), truth: exactEvents(dataset.rows) }]))
const caches = (input: ExactIndicatorDataset[]) => input.map((dataset) => cached.get(dataset.meta.id)!)
const development = caches(developmentDatasets(datasets))
const grid = configs()

const fitRanked: CandidateScore[] = grid.map((config) => {
	const fit = scoreSlices(development, config, 'fit')
	const fitAggregate = aggregate(fit)
	return { config, fit, fitAggregate, objective: fitObjective(fitAggregate) }
}).sort((a, b) => b.objective - a.objective)

const validationPool = fitRanked.slice(0, 200).map((candidate) => {
	const validation = scoreSlices(development, candidate.config, 'validation')
	const validationAggregate = aggregate(validation)
	return { ...candidate, validation, validationAggregate, objective: validationObjective(validationAggregate) }
}).sort((a, b) => b.objective - a.objective)

const winner = validationPool[0]!
const sealed = scoreSlices(development, winner.config, 'sealed-test')
const futures = allScore(caches(futuresHoldouts(datasets)), winner.config)
const spot = allScore(caches(spotHoldouts(datasets)), winner.config)
const exactPlusMinusOne = datasets.map((dataset) => {
	const cache = cached.get(dataset.meta.id)!
	const predictions = detectReversalStateMachine(dataset.rows, winner.config, cache.features)
	return { datasetId: dataset.meta.id, metrics: withoutMatches(matchDirectionalEvents(cache.truth, predictions, dataset.meta.timeframeMs, 1)) }
})
const sealedAggregate = aggregate(sealed)
const futuresAggregate = aggregate(futures)
const spotAggregate = aggregate(spot)
const gate = {
	minFuturesPrecision: futures.length ? Math.min(...futures.map((score) => score.metrics.precision)) : 0,
	minFuturesRecall: futures.length ? Math.min(...futures.map((score) => score.metrics.recall)) : 0,
	futuresCountRatios: futures.map((score) => ({ datasetId: score.datasetId, ratio: score.metrics.predictions / Math.max(1, score.metrics.truth) })),
	passed: futures.length > 0
		&& futures.every((score) => score.metrics.precision >= 0.15 && score.metrics.recall >= 0.4)
		&& futures.every((score) => score.metrics.predictions / Math.max(1, score.metrics.truth) >= 0.5 && score.metrics.predictions / Math.max(1, score.metrics.truth) <= 2),
}

const report = {
	version: REVERSAL_STATE_MACHINE_RESEARCH_VERSION,
	protocol: {
		gridSize: grid.length,
		selection: 'rank all configs on first 50% of BTC 15m/1h; validate top 200 on next 25%; one final report on sealed 25%',
		eventMatching: 'one-to-one exact-bar; +/-1 bar reported separately',
		futuresHoldouts: futures.map((score) => score.datasetId),
		spotSeparate: spot.map((score) => score.datasetId),
	},
	winner,
	sealed: { slices: sealed, aggregate: sealedAggregate },
	futuresHoldouts: { slices: futures, aggregate: futuresAggregate },
	spotHoldout: { slices: spot, aggregate: spotAggregate },
	exactPlusMinusOne,
	gate,
	topValidation: validationPool.slice(0, 25),
}

const rows = (scores: SliceScore[]) => scores.map((score) => `| ${score.datasetId} | ${score.metrics.tp} | ${score.metrics.fp} | ${score.metrics.fn} | ${pct(score.metrics.precision)} | ${pct(score.metrics.recall)} | ${score.metrics.predictions} |`).join('\n')
const markdown = `# Reversal global chronological state-machine search v1

- Engine: \`${REVERSAL_STATE_MACHINE_RESEARCH_VERSION}\`.
- Grid: ${grid.length} causal state machines.
- Selection: first 50% of BTC Futures 15m/1h; top 200 move to the next 25%; final 25% is sealed until the family is fixed.
- Event matching is one-to-one. Main metric is exact-bar; ±1 bar is diagnostic only.
- No PnL or future outcome is used.

## Selected state machine

\`\`\`json
${JSON.stringify(winner.config, null, 2)}
\`\`\`

| Split | TP | FP | FN | Precision | Recall | F1 | Predictions / truth |
|---|---:|---:|---:|---:|---:|---:|---:|
| fit | ${winner.fitAggregate.tp} | ${winner.fitAggregate.fp} | ${winner.fitAggregate.fn} | ${pct(winner.fitAggregate.precision)} | ${pct(winner.fitAggregate.recall)} | ${pct(winner.fitAggregate.f1)} | ${(winner.fitAggregate.predictions / winner.fitAggregate.truth).toFixed(2)} |
| validation | ${winner.validationAggregate!.tp} | ${winner.validationAggregate!.fp} | ${winner.validationAggregate!.fn} | ${pct(winner.validationAggregate!.precision)} | ${pct(winner.validationAggregate!.recall)} | ${pct(winner.validationAggregate!.f1)} | ${(winner.validationAggregate!.predictions / winner.validationAggregate!.truth).toFixed(2)} |
| sealed BTC 15m/1h | ${sealedAggregate.tp} | ${sealedAggregate.fp} | ${sealedAggregate.fn} | ${pct(sealedAggregate.precision)} | ${pct(sealedAggregate.recall)} | ${pct(sealedAggregate.f1)} | ${(sealedAggregate.predictions / sealedAggregate.truth).toFixed(2)} |

## Untouched Futures holdouts

| Dataset | TP | FP | FN | Precision | Recall | Predictions |
|---|---:|---:|---:|---:|---:|---:|
${rows(futures)}

Aggregate: precision ${pct(futuresAggregate.precision)}, recall ${pct(futuresAggregate.recall)}, F1 ${pct(futuresAggregate.f1)}.

## Spot holdout — separate market-kind slice

| Dataset | TP | FP | FN | Precision | Recall | Predictions |
|---|---:|---:|---:|---:|---:|---:|
${rows(spot)}

Aggregate: precision ${pct(spotAggregate.precision)}, recall ${pct(spotAggregate.recall)}, F1 ${pct(spotAggregate.f1)}.

## Production gate

${gate.passed ? '**PASS**' : '**FAIL**'} — each Futures holdout needs precision ≥15%, recall ≥40%, and prediction/original count ratio 0.5–2.0.

This is a vendor-fidelity result, not evidence of trading profitability. If the gate fails, production \`detectReversals()\` must remain unchanged.
`

const outDir = resolve('ci-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'reversal-state-machine-search-v1.json'), JSON.stringify(report, null, 2))
writeFileSync(resolve(outDir, 'reversal-state-machine-search-v1.md'), markdown)
console.log(markdown)
