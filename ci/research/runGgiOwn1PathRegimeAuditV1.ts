import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import { replayDm3Trade, WARMUP, type Dm3Trade } from './runDm3StaticExit.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'

export interface DatasetSpec {
	id: string
	asset: string
	file: string
	timeframeMinutes: number
	group: 'reference' | 'holdout' | 'auxiliary'
	requiredForFullHoldout: boolean
}

export interface Signal {
	idx: number
	side: CorrectedGgiSide
}

export interface MatchedSignal extends Signal {
	templateIdx: number
	tier: 'month-atr-quintile' | 'month' | 'atr-quintile' | 'broad' | 'unmatched'
}

interface RawPathPoint {
	horizonBars: number
	mfeR: number
	maeR: number
}

interface SignalEvaluation {
	signal: Signal
	trade: Dm3Trade | null
	path: RawPathPoint[]
}

interface PathPointSummary {
	horizonBars: number
	meanMfeR: number
	medianMfeR: number | null
	meanMaeR: number
	medianMaeR: number | null
	mfeHalfRate: number
	mfeOneRate: number
	maeHalfRate: number
	maeOneRate: number
}

interface SideSummary {
	side: CorrectedGgiSide
	n: number
	meanR: number | null
	profitFactor: number | null
	meanMfe3R: number | null
	meanMae3R: number | null
}

interface EvalSummary {
	signals: number
	closedTrades: number
	meanR: number | null
	profitFactor: number | null
	full: number
	stop: number
	partial: number
	fullStop: number | null
	path: PathPointSummary[]
	sides: SideSummary[]
	proximity: { exact: number | null; plusMinus1: number | null; plusMinus3: number | null }
}

interface DistributionSummary {
	mean: number | null
	q05: number | null
	median: number | null
	q95: number | null
}

interface EffectSummary {
	observed: number | null
	bootstrap: DistributionSummary
}

interface NullEnsembleSummary {
	mode: 'primary-regime-matched' | 'secondary-broad'
	draws: number
	meanMatchedSignals: number
	meanMatchRate: number
	tiers: Record<MatchedSignal['tier'], number>
	meanR: DistributionSummary
	profitFactor: DistributionSummary
	path: Array<{
		horizonBars: number
		meanMfeR: DistributionSummary
		meanMaeR: DistributionSummary
	}>
	effect: {
		meanR: EffectSummary
		meanMfe3R: EffectSummary
		meanMae3R: EffectSummary
	}
}

const PROJECT_DATA = 'data/vendor-exports/incoming-2026-08'
export const DATASETS: DatasetSpec[] = [
	{ id: 'btc-2h', asset: 'BTC', file: `${PROJECT_DATA}/BYBIT_BTCUSDT.P_2h_full20k_vol.csv`, timeframeMinutes: 120, group: 'reference', requiredForFullHoldout: false },
	{ id: 'btc-15m', asset: 'BTC', file: `${PROJECT_DATA}/BYBIT_BTCUSDT.P_15m.csv`, timeframeMinutes: 15, group: 'reference', requiredForFullHoldout: false },
	{ id: 'ondo-2h', asset: 'ONDO', file: `${PROJECT_DATA}/BYBIT_ONDOUSDT.P_2h.csv`, timeframeMinutes: 120, group: 'reference', requiredForFullHoldout: false },
	{ id: 'ondo-15m', asset: 'ONDO', file: `${PROJECT_DATA}/BYBIT_ONDOUSDT.P_15m.csv`, timeframeMinutes: 15, group: 'reference', requiredForFullHoldout: false },
	{ id: 'xrp-3m', asset: 'XRP', file: `${PROJECT_DATA}/BINANCE_XRPUSDT_3m_vol.csv`, timeframeMinutes: 3, group: 'auxiliary', requiredForFullHoldout: false },
	{ id: 'eth-2h', asset: 'ETH', file: `${PROJECT_DATA}/BYBIT_ETHUSDT.P, 120.csv`, timeframeMinutes: 120, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'eth-1h', asset: 'ETH', file: `${PROJECT_DATA}/BYBIT_ETHUSDT.P, 60.csv`, timeframeMinutes: 60, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'sol-2h', asset: 'SOL', file: `${PROJECT_DATA}/BYBIT_SOLUSDT.P, 120.csv`, timeframeMinutes: 120, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'sol-1h', asset: 'SOL', file: `${PROJECT_DATA}/BYBIT_SOLUSDT.P, 60.csv`, timeframeMinutes: 60, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'xrp-2h', asset: 'XRP', file: `${PROJECT_DATA}/BYBIT_XRPUSDT.P, 120.csv`, timeframeMinutes: 120, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'xrp-1h', asset: 'XRP', file: `${PROJECT_DATA}/BYBIT_XRPUSDT.P, 60.csv`, timeframeMinutes: 60, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'aave-2h', asset: 'AAVE', file: `${PROJECT_DATA}/BYBIT_AAVEUSDT.P, 120 (1).csv`, timeframeMinutes: 120, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'aave-1h', asset: 'AAVE', file: `${PROJECT_DATA}/BYBIT_AAVEUSDT.P, 60.csv`, timeframeMinutes: 60, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'bnb-2h', asset: 'BNB', file: `${PROJECT_DATA}/BYBIT_BNBUSDT.P, 120.csv`, timeframeMinutes: 120, group: 'holdout', requiredForFullHoldout: true },
	{ id: 'bnb-1h', asset: 'BNB', file: `${PROJECT_DATA}/BYBIT_BNBUSDT.P, 60.csv`, timeframeMinutes: 60, group: 'holdout', requiredForFullHoldout: true },
]

export const HORIZONS = [1, 2, 3, 6, 12, 24] as const
export const STOP_MULTIPLIER = 12
export const RANDOM_SEED = 20260805
export const COOLDOWN = 40
export const NULL_DRAWS = 2
export const BOOTSTRAP_SAMPLES = 100

function mean(values: readonly number[]): number | null {
	return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function median(values: readonly number[]): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function quantile(values: readonly number[], p: number): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!
}

function distribution(values: readonly number[]): DistributionSummary {
	return { mean: mean(values), q05: quantile(values, 0.05), median: median(values), q95: quantile(values, 0.95) }
}

function profitFactor(values: readonly number[]): number | null {
	const wins = values.filter((x) => x > 0).reduce((a, b) => a + b, 0)
	const losses = Math.abs(values.filter((x) => x < 0).reduce((a, b) => a + b, 0))
	return losses > 0 ? wins / losses : wins > 0 ? Number.POSITIVE_INFINITY : null
}

export function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
		return ((t ^ t >>> 14) >>> 0) / 4294967296
	}
}

function monthKey(timestamp: number): string {
	const date = new Date(timestamp)
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function atrQuintiles(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	from: number,
	to: number,
): Array<number | null> {
	const eligible = tr55.slice(Math.max(WARMUP, from), Math.min(to, rows.length - 1)).filter((x): x is number => x != null && x > 0)
	const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(eligible, p) ?? Number.POSITIVE_INFINITY)
	return tr55.map((value) => {
		if (value == null || value <= 0) return null
		let q = 0
		while (q < cuts.length && value > cuts[q]!) q++
		return q
	})
}

function arrows(rows: readonly ExactIndicatorRow[], from: number, to: number): Signal[] {
	const out: Signal[] = []
	for (let i = Math.max(WARMUP, from); i < Math.min(to, rows.length - 1); i++) {
		if (rows[i]!.buy) out.push({ idx: i, side: 1 })
		else if (rows[i]!.sell) out.push({ idx: i, side: -1 })
	}
	return out
}

function validCandidate(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], i: number): boolean {
	return i >= WARMUP && i < rows.length - 1 && validGgiBand(rows[i]!) && validGgiBand(rows[i + 1]!) && tr55[i] != null && tr55[i]! > 0
}

export function matchNullSignals(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	template: readonly Signal[],
	from: number,
	to: number,
	seed: number,
	mode: 'primary-regime-matched' | 'secondary-broad',
): MatchedSignal[] {
	const random = mulberry32(seed)
	const quintiles = atrQuintiles(rows, tr55, from, to)
	const excluded = new Set(template.map((s) => s.idx))
	const eligible = Array.from({ length: Math.max(0, Math.min(to, rows.length - 1) - Math.max(WARMUP, from)) }, (_, k) => k + Math.max(WARMUP, from))
		.filter((i) => validCandidate(rows, tr55, i) && !excluded.has(i))
	const selected: MatchedSignal[] = []
	const used = new Set<number>()
	const byMonth = new Map<string, number[]>()
	const byQuintile = new Map<number, number[]>()
	const byMonthQuintile = new Map<string, number[]>()
	for (const idx of eligible) {
		const month = monthKey(rows[idx]!.timestamp)
		const quintile = quintiles[idx]
		const monthRows = byMonth.get(month) ?? []
		monthRows.push(idx)
		byMonth.set(month, monthRows)
		if (quintile != null) {
			const quintileRows = byQuintile.get(quintile) ?? []
			quintileRows.push(idx)
			byQuintile.set(quintile, quintileRows)
			const key = `${month}:${quintile}`
			const combinedRows = byMonthQuintile.get(key) ?? []
			combinedRows.push(idx)
			byMonthQuintile.set(key, combinedRows)
		}
	}
	const orderedTemplate = template.map((signal, order) => ({ signal, order, noise: random() })).sort((a, b) => a.noise - b.noise)

	for (const { signal, order } of orderedTemplate) {
		const templateMonth = monthKey(rows[signal.idx]!.timestamp)
		const templateQuintile = quintiles[signal.idx]
		const allowed = (idx: number) => !used.has(idx) && !selected.some((s) => s.side === signal.side && Math.abs(s.idx - idx) <= COOLDOWN)
		const pools: Array<{ tier: MatchedSignal['tier']; rows: readonly number[] }> = mode === 'primary-regime-matched'
			? [
				{ tier: 'month-atr-quintile', rows: templateQuintile == null ? [] : byMonthQuintile.get(`${templateMonth}:${templateQuintile}`) ?? [] },
				{ tier: 'month', rows: byMonth.get(templateMonth) ?? [] },
				{ tier: 'atr-quintile', rows: templateQuintile == null ? [] : byQuintile.get(templateQuintile) ?? [] },
				{ tier: 'broad', rows: eligible },
			]
			: [{ tier: 'broad', rows: eligible }]
		let picked: number | null = null
		let tier: MatchedSignal['tier'] = 'unmatched'
		for (const pool of pools) {
			const candidates = pool.rows.filter(allowed)
			if (!candidates.length) continue
			picked = candidates[Math.floor(random() * candidates.length)]!
			tier = pool.tier
			break
		}
		if (picked != null) {
			used.add(picked)
			selected.push({ idx: picked, side: signal.side, templateIdx: signal.idx, tier, order } as MatchedSignal & { order: number })
		} else selected.push({ idx: -1, side: signal.side, templateIdx: signal.idx, tier: 'unmatched', order } as MatchedSignal & { order: number })
	}
	return (selected as Array<MatchedSignal & { order: number }>).sort((a, b) => a.order - b.order).map(({ order: _order, ...signal }) => signal)
}

export function fixedPath(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signal: Signal,
): RawPathPoint[] {
	const entryIndex = signal.idx + 1
	const entry = rows[entryIndex]
	const volatility = tr55[signal.idx]
	if (!entry || volatility == null || volatility <= 0) return []
	const risk = volatility * STOP_MULTIPLIER
	return HORIZONS.flatMap((horizonBars) => {
		const end = entryIndex + horizonBars - 1
		if (end >= rows.length) return []
		let mfeR = Number.NEGATIVE_INFINITY
		let maeR = Number.POSITIVE_INFINITY
		for (let i = entryIndex; i <= end; i++) {
			const row = rows[i]!
			const favourable = signal.side === 1 ? (row.high - entry.open) / risk : (entry.open - row.low) / risk
			const adverse = signal.side === 1 ? (row.low - entry.open) / risk : (entry.open - row.high) / risk
			mfeR = Math.max(mfeR, favourable)
			maeR = Math.min(maeR, adverse)
		}
		return [{ horizonBars, mfeR, maeR }]
	})
}

function createEvaluator(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[]) {
	const cache = new Map<string, SignalEvaluation>()
	return (signal: Signal): SignalEvaluation => {
		const key = `${signal.idx}:${signal.side}`
		const existing = cache.get(key)
		if (existing) return existing
		const evaluation = {
			signal,
			trade: signal.idx >= 0 ? replayDm3Trade(rows, tr55, signal.idx, signal.side, 'V2_movP_staticTPwick') : null,
			path: signal.idx >= 0 ? fixedPath(rows, tr55, signal) : [],
		}
		cache.set(key, evaluation)
		return evaluation
	}
}

function pathPoint(evaluation: SignalEvaluation, horizonBars: number): RawPathPoint | null {
	return evaluation.path.find((p) => p.horizonBars === horizonBars) ?? null
}

function summarizePath(evaluations: readonly SignalEvaluation[]): PathPointSummary[] {
	return HORIZONS.map((horizonBars) => {
		const points = evaluations.map((e) => pathPoint(e, horizonBars)).filter((p): p is RawPathPoint => p != null)
		return {
			horizonBars,
			meanMfeR: mean(points.map((p) => p.mfeR)) ?? 0,
			medianMfeR: median(points.map((p) => p.mfeR)),
			meanMaeR: mean(points.map((p) => p.maeR)) ?? 0,
			medianMaeR: median(points.map((p) => p.maeR)),
			mfeHalfRate: mean(points.map((p) => p.mfeR >= 0.5 ? 1 : 0)) ?? 0,
			mfeOneRate: mean(points.map((p) => p.mfeR >= 1 ? 1 : 0)) ?? 0,
			maeHalfRate: mean(points.map((p) => p.maeR <= -0.5 ? 1 : 0)) ?? 0,
			maeOneRate: mean(points.map((p) => p.maeR <= -1 ? 1 : 0)) ?? 0,
		}
	})
}

function summarizeEvaluations(evaluations: readonly SignalEvaluation[], referenceArrows: readonly Signal[]): EvalSummary {
	const closed = evaluations.map((e) => e.trade).filter((t): t is Dm3Trade => t != null && t.outcome !== 'End mark')
	const rs = closed.map((t) => t.grossR)
	const paths = summarizePath(evaluations)
	const sides = ([1, -1] as const).map((side) => {
		const subset = evaluations.filter((e) => e.signal.side === side)
		const sideTrades = subset.map((e) => e.trade).filter((t): t is Dm3Trade => t != null && t.outcome !== 'End mark')
		const p3 = subset.map((e) => pathPoint(e, 3)).filter((p): p is RawPathPoint => p != null)
		return { side, n: sideTrades.length, meanR: mean(sideTrades.map((t) => t.grossR)), profitFactor: profitFactor(sideTrades.map((t) => t.grossR)), meanMfe3R: mean(p3.map((p) => p.mfeR)), meanMae3R: mean(p3.map((p) => p.maeR)) }
	})
	const distances = evaluations.map((e) => {
		const sameSide = referenceArrows.filter((arrow) => arrow.side === e.signal.side)
		return sameSide.length ? Math.min(...sameSide.map((arrow) => Math.abs(arrow.idx - e.signal.idx))) : Number.POSITIVE_INFINITY
	}).filter(Number.isFinite)
	return {
		signals: evaluations.length,
		closedTrades: closed.length,
		meanR: mean(rs),
		profitFactor: profitFactor(rs),
		full: closed.filter((t) => t.outcome === 'Full fix').length,
		stop: closed.filter((t) => t.outcome === 'Stop').length,
		partial: closed.filter((t) => t.outcome === 'Partial').length,
		fullStop: closed.some((t) => t.outcome === 'Stop') ? closed.filter((t) => t.outcome === 'Full fix').length / closed.filter((t) => t.outcome === 'Stop').length : null,
		path: paths,
		sides,
		proximity: {
			exact: mean(distances.map((x) => x === 0 ? 1 : 0)),
			plusMinus1: mean(distances.map((x) => x <= 1 ? 1 : 0)),
			plusMinus3: mean(distances.map((x) => x <= 3 ? 1 : 0)),
		},
	}
}

function pairedMetric(
	rows: readonly ExactIndicatorRow[],
	real: readonly SignalEvaluation[],
	nullEvaluations: readonly SignalEvaluation[],
	metric: 'meanR' | 'meanMfe3R' | 'meanMae3R',
): Array<{ month: string; delta: number }> {
	const byTemplate = new Map<number, SignalEvaluation>()
	for (const evaluation of nullEvaluations) {
		const templateIdx = (evaluation.signal as MatchedSignal).templateIdx
		if (templateIdx != null) byTemplate.set(templateIdx, evaluation)
	}
	const pairs: Array<{ month: string; delta: number }> = []
	for (const realEvaluation of real) {
		const nullEvaluation = byTemplate.get(realEvaluation.signal.idx)
		if (!nullEvaluation) continue
		let realValue: number | null = null
		let nullValue: number | null = null
		if (metric === 'meanR') {
			realValue = realEvaluation.trade?.outcome === 'End mark' ? null : realEvaluation.trade?.grossR ?? null
			nullValue = nullEvaluation.trade?.outcome === 'End mark' ? null : nullEvaluation.trade?.grossR ?? null
		} else {
			realValue = metric === 'meanMfe3R' ? pathPoint(realEvaluation, 3)?.mfeR ?? null : pathPoint(realEvaluation, 3)?.maeR ?? null
			nullValue = metric === 'meanMfe3R' ? pathPoint(nullEvaluation, 3)?.mfeR ?? null : pathPoint(nullEvaluation, 3)?.maeR ?? null
		}
		if (realValue == null || nullValue == null) continue
		pairs.push({ month: monthKey(rows[realEvaluation.signal.idx]?.timestamp ?? 0), delta: realValue - nullValue })
	}
	return pairs
}

function pairedBlockBootstrap(
	drawPairs: ReadonlyArray<ReadonlyArray<{ month: string; delta: number }>>,
	seed: number,
): DistributionSummary {
	if (!drawPairs.some((pairs) => pairs.length)) return distribution([])
	const random = mulberry32(seed)
	const samples: number[] = []
	for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample++) {
		const pairs = drawPairs[Math.floor(random() * drawPairs.length)] ?? []
		const blocks = new Map<string, number[]>()
		for (const pair of pairs) {
			const block = blocks.get(pair.month) ?? []
			block.push(pair.delta)
			blocks.set(pair.month, block)
		}
		const blockValues = [...blocks.values()]
		if (!blockValues.length) continue
		const values: number[] = []
		for (let i = 0; i < blockValues.length; i++) values.push(...blockValues[Math.floor(random() * blockValues.length)]!)
		const value = mean(values)
		if (value != null) samples.push(value)
	}
	return distribution(samples)
}

function nullEnsemble(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	realSignals: readonly Signal[],
	realEvaluationsRaw: readonly SignalEvaluation[],
	realSummary: EvalSummary,
	from: number,
	to: number,
	seed: number,
	mode: NullEnsembleSummary['mode'],
	evaluate: (signal: Signal) => SignalEvaluation,
): NullEnsembleSummary {
	const realEvaluations = realEvaluationsRaw
	const summaries: EvalSummary[] = []
	const tierTotals: Record<MatchedSignal['tier'], number> = { 'month-atr-quintile': 0, month: 0, 'atr-quintile': 0, broad: 0, unmatched: 0 }
	const pairSets = { meanR: [] as Array<Array<{ month: string; delta: number }>>, meanMfe3R: [] as Array<Array<{ month: string; delta: number }>>, meanMae3R: [] as Array<Array<{ month: string; delta: number }>> }
	let matchedTotal = 0
	for (let draw = 0; draw < NULL_DRAWS; draw++) {
		const signals = matchNullSignals(rows, tr55, realSignals, from, to, seed + draw * 104729, mode)
		for (const signal of signals) tierTotals[signal.tier]++
		const matched = signals.filter((signal) => signal.idx >= 0)
		matchedTotal += matched.length
		const evaluations = matched.map((matchedSignal) => ({
			...evaluate(matchedSignal),
			signal: Object.assign({}, evaluate(matchedSignal).signal, { templateIdx: matchedSignal.templateIdx, tier: matchedSignal.tier }),
		}))
		summaries.push(summarizeEvaluations(evaluations, []))
		pairSets.meanR.push(pairedMetric(rows, realEvaluations, evaluations, 'meanR'))
		pairSets.meanMfe3R.push(pairedMetric(rows, realEvaluations, evaluations, 'meanMfe3R'))
		pairSets.meanMae3R.push(pairedMetric(rows, realEvaluations, evaluations, 'meanMae3R'))
	}
	const nullMeanR = summaries.map((s) => s.meanR).filter((x): x is number => x != null)
	const path = HORIZONS.map((horizonBars) => ({
		horizonBars,
		meanMfeR: distribution(summaries.map((s) => s.path.find((p) => p.horizonBars === horizonBars)?.meanMfeR).filter((x): x is number => x != null)),
		meanMaeR: distribution(summaries.map((s) => s.path.find((p) => p.horizonBars === horizonBars)?.meanMaeR).filter((x): x is number => x != null)),
	}))
	const realP3 = realSummary.path.find((p) => p.horizonBars === 3)
	const nullP3Mfe = path.find((p) => p.horizonBars === 3)?.meanMfeR.mean ?? null
	const nullP3Mae = path.find((p) => p.horizonBars === 3)?.meanMaeR.mean ?? null
	return {
		mode,
		draws: NULL_DRAWS,
		meanMatchedSignals: matchedTotal / NULL_DRAWS,
		meanMatchRate: realSignals.length ? matchedTotal / NULL_DRAWS / realSignals.length : 0,
		tiers: tierTotals,
		meanR: distribution(nullMeanR),
		profitFactor: distribution(summaries.map((s) => s.profitFactor).filter((x): x is number => x != null && Number.isFinite(x))),
		path,
		effect: {
			meanR: { observed: realSummary.meanR == null || mean(nullMeanR) == null ? null : realSummary.meanR - mean(nullMeanR)!, bootstrap: pairedBlockBootstrap(pairSets.meanR, seed + 11) },
			meanMfe3R: { observed: realP3 == null || nullP3Mfe == null ? null : realP3.meanMfeR - nullP3Mfe, bootstrap: pairedBlockBootstrap(pairSets.meanMfe3R, seed + 23) },
			meanMae3R: { observed: realP3 == null || nullP3Mae == null ? null : realP3.meanMaeR - nullP3Mae, bootstrap: pairedBlockBootstrap(pairSets.meanMae3R, seed + 37) },
		},
	}
}

function familyResult(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signals: readonly Signal[],
	referenceArrows: readonly Signal[],
	from: number,
	to: number,
	seed: number,
) {
	const evaluate = createEvaluator(rows, tr55)
	const evaluations = signals.map(evaluate)
	const summary = summarizeEvaluations(evaluations, referenceArrows)
	return {
		summary,
		primaryNull: nullEnsemble(rows, tr55, signals, evaluations, summary, from, to, seed, 'primary-regime-matched', evaluate),
		secondaryNull: nullEnsemble(rows, tr55, signals, evaluations, summary, from, to, seed + 1_000_003, 'secondary-broad', evaluate),
	}
}

export function buildInputManifest(specs: readonly DatasetSpec[] = DATASETS) {
	return specs.map((spec) => {
		const absolute = resolve(spec.file)
		return { ...spec, available: existsSync(absolute), sha256: existsSync(absolute) ? sha256File(absolute) : null }
	})
}

function run() {
	const inputManifest = buildInputManifest()
	const availableSpecs = inputManifest.filter((input) => input.available)
	const datasets = availableSpecs.map((spec, datasetOrder) => {
		const rows = parseExactIndicatorCsv(readFileSync(resolve(spec.file), 'utf8'), { allowInvalidBandOrder: true, allowIrregularBars: true })
		const tr55 = trueRangeSma(rows, 55)
		const body = bodySma20(rows)
		const allArrows = arrows(rows, 0, rows.length)
		const allOwn = own1Signals(rows, body, 1.5, 10, 0, rows.length)
		const windows = [
			{ label: 'full', from: 0, to: rows.length },
			{ label: 'first-half', from: 0, to: Math.floor(rows.length / 2) },
			{ label: 'second-half', from: Math.floor(rows.length / 2), to: rows.length },
		]
		return {
			id: spec.id,
			asset: spec.asset,
			group: spec.group,
			timeframeMinutes: spec.timeframeMinutes,
			rows: rows.length,
			sha256: spec.sha256,
			firstUtc: new Date(rows[0]!.timestamp).toISOString(),
			lastUtc: new Date(rows.at(-1)!.timestamp).toISOString(),
			windows: windows.map((window, windowOrder) => {
				const arrowSignals = allArrows.filter((s) => s.idx >= window.from && s.idx < window.to)
				const ownSignalsWindow = allOwn.filter((s) => s.idx >= window.from && s.idx < window.to)
				const baseSeed = RANDOM_SEED + datasetOrder * 100_000 + windowOrder * 10_000
				return {
					...window,
					GGI: familyResult(rows, tr55, arrowSignals, allArrows, window.from, window.to, baseSeed + 101),
					OWN1: familyResult(rows, tr55, ownSignalsWindow, allArrows, window.from, window.to, baseSeed + 503),
				}
			}),
		}
	})
	const missingRequired = inputManifest.filter((input) => input.requiredForFullHoldout && !input.available)
	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		scope: 'descriptive fixed-horizon path and identical DM3 replay comparison; frozen OWN1; no retuning; exact GGI proximity is diagnostic only',
		coverage: {
			status: missingRequired.length ? 'PARTIAL_INPUT_COVERAGE' : 'FULL_HOLDOUT_COVERAGE',
			available: availableSpecs.length,
			expected: inputManifest.length,
			fullHoldoutAvailable: missingRequired.length === 0,
			missingRequired: missingRequired.map((input) => input.id),
		},
		protocol: {
			management: 'DM3 V2: next-open; moving Mean wick 25% partial; static signal-bar opposite Inner wick full; static 12xSMA(TR,55) stop; adverse-first; no BE; no add',
			own1: 'body >= 1.5x SMA20(body); drought >= 10 bars since Mean touch; signal-side Mean close; directional candle; same-side cooldown 40',
			path: 'uncensored fixed-horizon MFE/MAE from next-open, normalized by signal-time 12xSMA(TR,55) risk',
			horizons: HORIZONS,
			primaryNull: 'same dataset/template side/calendar month/ATR55 quintile; deterministic draws; same-side cooldown; fallback tiers recorded',
			secondaryNull: 'same dataset/template side only; deterministic draws; same-side cooldown',
			nullDraws: NULL_DRAWS,
			bootstrap: `${BOOTSTRAP_SAMPLES} monthly-block paired resamples across deterministic null draws`,
		},
		inputs: inputManifest,
		datasets,
	}
}

function fmt(value: number | null, digits = 3): string {
	return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits)
}

function markdown(result: ReturnType<typeof run>): string {
	const lines = [
		'# GGI / OWN1 path and regime audit v1',
		'',
		`Coverage: **${result.coverage.status}** (${result.coverage.available}/${result.coverage.expected} datasets).`,
		'',
	]
	if (result.coverage.missingRequired.length) {
		lines.push('The independent ETH/SOL/XRP/AAVE/BNB 1h/2h CSV files are absent, so this run is a reproducible partial-coverage diagnostic, not the promised full holdout.', '')
		lines.push(`Missing required inputs: ${result.coverage.missingRequired.map((id) => `\`${id}\``).join(', ')}.`, '')
	}
	lines.push('## Dataset/window economics and early path', '', '| Dataset | Window | Family | Signals | Mean R | PF | Full:Stop | Primary null R | ΔR | 90% block CI ΔR | MFE 3b | ΔMFE 3b | MAE 3b | ΔMAE 3b | ±3 GGI |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
	for (const dataset of result.datasets) for (const window of dataset.windows) for (const family of ['GGI', 'OWN1'] as const) {
		const cell = window[family]
		const summary = cell.summary
		const p3 = summary.path.find((point) => point.horizonBars === 3)!
		const effect = cell.primaryNull.effect
		lines.push(`| ${dataset.id} | ${window.label} | ${family} | ${summary.signals} | ${fmt(summary.meanR, 4)} | ${fmt(summary.profitFactor)} | ${fmt(summary.fullStop, 2)} | ${fmt(cell.primaryNull.meanR.mean, 4)} | ${fmt(effect.meanR.observed, 4)} | [${fmt(effect.meanR.bootstrap.q05, 4)}, ${fmt(effect.meanR.bootstrap.q95, 4)}] | ${fmt(p3.meanMfeR)} | ${fmt(effect.meanMfe3R.observed)} | ${fmt(p3.meanMaeR)} | ${fmt(effect.meanMae3R.observed)} | ${fmt(summary.proximity.plusMinus3 == null ? null : summary.proximity.plusMinus3 * 100, 1)}% |`)
	}
	lines.push('', '## Decision rules', '', '- Full:Stop is descriptive only; positive mean R, PF > 1 and a positive real-minus-null effect are the economic gates.', '- MFE/MAE are post-entry path outcomes, not causal input features.', '- Exact/±1/±3 arrow proximity is diagnostic and is never the promotion target.', '- A positive broad or regime-matched null means DM3 mechanics or market regime can explain the apparent edge.', '- This run cannot settle cross-asset holdout transfer until the ten missing 1h/2h exports are restored.', '', '## Next detector decision', '', 'Do not retune OWN1. The next generation should be a separately preregistered state detector: persistent signal-side Mean episode, weakening continuation, directional reversal candle, then a causal failed-continuation/confirmation condition. Selection must use OOS mean R/PF/cost robustness and matched-null advantage; GGI proximity remains secondary.', '')
	return lines.join('\n')
}

export function main(): ReturnType<typeof run> {
	const result = run()
	writeFileSync(resolve('ci-results/ggi-own1-path-regime-audit-v1.json'), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve('ci-results/ggi-own1-path-regime-audit-v1.md'), `${markdown(result)}\n`)
	console.log(JSON.stringify({ output: 'ci-results/ggi-own1-path-regime-audit-v1.json', coverage: result.coverage, datasets: result.datasets.length }, null, 2))
	return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
