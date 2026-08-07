import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { selectCausalLiquidityPool, completedPrefixLength, type CausalPoolMatch } from '../../src/core/analysis/CausalLiquidityPoolState.js'
import {
	deterministicMonthBlockBootstrap,
	simulateIndependentReversalG2Portfolio,
	summarizeIndependentReversalG2,
	type IndependentReversalG2EvaluatedTrade,
} from '../../src/core/analysis/IndependentReversalG2Metrics.js'
import { detectIndependentReversalG2Candidates, type IndependentReversalG2Candidate } from '../../src/core/signals/IndependentReversalG2.js'
import {
	INDEPENDENT_REVERSAL_G2_PROTOCOL,
	stableIndependentReversalG2ProtocolJson,
	type IndependentReversalG2Variant,
} from '../../src/core/signals/IndependentReversalG2Protocol.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import { detectIndependentReversalSignals } from '../../src/core/signals/IndependentReversalResearch.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { applyOneWayCostBps, collectCorrectedSignalTrades, trueRangeSma, type CorrectedGgiSignal, type CorrectedGgiTrade } from './lib/ggiCorrectedReplay.js'
import { detectLiquidityHeatmap, heatmapConfigForTf } from './lib/liquidityHeatmapEngine.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'

export const INDEPENDENT_REVERSAL_G2_RUNNER_VERSION = 'independent-reversal-g2-runner-1.0-frozen'
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const DISCOVERY_FROM = Date.parse('2025-06-01T00:00:00Z')
const DISCOVERY_UNTIL = Date.parse('2026-08-01T00:00:00Z')
const TRANSFER_FROM = Date.parse(`${INDEPENDENT_REVERSAL_G2_PROTOCOL.validation.transferFrom}T00:00:00Z`)
const TRANSFER_UNTIL = Date.parse(`${INDEPENDENT_REVERSAL_G2_PROTOCOL.validation.transferUntil}T00:00:00Z`)
const PRIMARY_VARIANTS: IndependentReversalG2Variant[] = ['EXT', 'EXT_POOL', 'OWN1_POOL', 'EXT_POOL_SEQ', 'G1', 'MATCHED_NULL']

interface Dataset {
	symbol: string
	role: 'development' | 'transfer'
	candles1h: Candle[]
	candles4h: Candle[]
	rows: ReturnType<typeof buildRows>
	tr55: Array<number | null>
	sha256: string
}

interface PoolAnnotatedCandidate {
	candidate: IndependentReversalG2Candidate
	pool: CausalPoolMatch | null
}

interface VariantEvaluation {
	variant: IndependentReversalG2Variant
	signals: number
	grossTrades: CorrectedGgiTrade[]
	trades: IndependentReversalG2EvaluatedTrade[]
	summary: ReturnType<typeof summarizeIndependentReversalG2>
	bootstrap: ReturnType<typeof deterministicMonthBlockBootstrap>
	portfolio: ReturnType<typeof simulateIndependentReversalG2Portfolio>
	stress: Record<string, ReturnType<typeof summarizeIndependentReversalG2>>
}

function protocolHash(): string {
	return createHash('sha256').update(stableIndependentReversalG2ProtocolJson()).digest('hex')
}

function candleHash(candles1h: readonly Candle[], candles4h: readonly Candle[]): string {
	const hash = createHash('sha256')
	for (const candle of [...candles1h, ...candles4h]) hash.update(`${candle.timestamp},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume}\n`)
	return hash.digest('hex')
}

function monthKey(timestamp: number): string {
	const date = new Date(timestamp)
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function rng(seed: number): () => number {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
		return ((value ^ value >>> 14) >>> 0) / 4294967296
	}
}

async function loadDataset(symbol: string, role: Dataset['role'], from: number, until: number): Promise<Dataset> {
	const warmupFrom = from - 400 * 4 * HOUR_MS
	const [raw1h, raw4h] = await Promise.all([
		fetchArchiveKlines(symbol, '1h', 'futures', warmupFrom, until),
		fetchArchiveKlines(symbol, '4h', 'futures', warmupFrom, until),
	])
	const candles1h = raw1h.filter((candle) => candle.timestamp >= warmupFrom && candle.timestamp + HOUR_MS <= until)
	const candles4h = raw4h.filter((candle) => candle.timestamp >= warmupFrom && candle.timestamp + 4 * HOUR_MS <= until)
	if (candles1h.length < 1_000 || candles4h.length < 300) throw new Error(`${symbol}: insufficient 1h/4h coverage`)
	const rows = buildRows(candles1h.map((candle) => ({ t: candle.timestamp, o: candle.open, h: candle.high, l: candle.low, c: candle.close, v: candle.volume })))
	return { symbol, role, candles1h, candles4h, rows, tr55: trueRangeSma(rows, 55), sha256: candleHash(candles1h, candles4h) }
}

function annotatePools(data: Dataset, candidates: readonly IndependentReversalG2Candidate[], from: number, until: number): PoolAnnotatedCandidate[] {
	const protocol = INDEPENDENT_REVERSAL_G2_PROTOCOL
	const config = {
		minimumAgeMs: protocol.pool.minimumAgeHours * HOUR_MS,
		sweepRecencyMs: protocol.pool.sweepRecencyHours * HOUR_MS,
		maximumNotionalRank: protocol.pool.maximumNotionalRank,
		requireStrictBandEntry: protocol.pool.requireStrictBandEntry,
	}
	const heatmapConfig = heatmapConfigForTf(4 * HOUR_MS)
	let cachedPrefix = -1
	let cachedPools = detectLiquidityHeatmap([], heatmapConfig)
	const out: PoolAnnotatedCandidate[] = []
	for (const candidate of candidates) {
		const signal = data.rows[candidate.index]!
		const entry = data.rows[candidate.index + 1]
		const decisionAt = signal.timestamp + HOUR_MS
		if (!entry || decisionAt < from || decisionAt >= until) continue
		const prefix = completedPrefixLength(data.candles4h, decisionAt, 4 * HOUR_MS)
		if (prefix < protocol.pool.minimumHistoryBars) { out.push({ candidate, pool: null }); continue }
		if (prefix !== cachedPrefix) {
			cachedPools = detectLiquidityHeatmap(data.candles4h.slice(0, prefix), heatmapConfig)
			cachedPrefix = prefix
		}
		out.push({ candidate, pool: selectCausalLiquidityPool(cachedPools, decisionAt, entry.open, candidate.side, config) })
	}
	return out
}

function g1Signals(data: Dataset, from: number, until: number): CorrectedGgiSignal[] {
	const signals = detectIndependentReversalSignals({ candles: data.candles1h, apexBands: computeApexBands(data.candles1h) })
	const seen = new Set<string>()
	return signals.filter((signal) => signal.family === 'CORE' && signal.at + HOUR_MS >= from && signal.at + HOUR_MS < until)
		.filter((signal) => { if (seen.has(signal.episodeId)) return false; seen.add(signal.episodeId); return true })
		.map((signal) => ({ signalIndex: signal.index, side: signal.direction === 'long' ? 1 : -1 }))
}

function matchedNullSignals(
	all: readonly PoolAnnotatedCandidate[],
	template: readonly PoolAnnotatedCandidate[],
	seed: number,
): CorrectedGgiSignal[] {
	const random = rng(seed)
	const blocked = new Set(template.map(({ candidate }) => candidate.index))
	const used = new Set<number>()
	const eligible = all.filter(({ candidate }) => candidate.source === 'EXT' && !blocked.has(candidate.index))
	return template.flatMap(({ candidate }) => {
		const month = monthKey(candidate.at)
		const candidates = eligible.filter((item) => !used.has(item.candidate.index)
			&& item.candidate.side === candidate.side
			&& monthKey(item.candidate.at) === month
			&& Math.abs(item.candidate.features.sequenceScore - candidate.features.sequenceScore) <= 1)
		const fallback = eligible.filter((item) => !used.has(item.candidate.index) && item.candidate.side === candidate.side && monthKey(item.candidate.at) === month)
		const pool = candidates.length ? candidates : fallback
		if (!pool.length) return []
		const picked = pool[Math.floor(random() * pool.length)]!.candidate
		used.add(picked.index)
		return [{ signalIndex: picked.index, side: picked.side }]
	})
}

function variantSignals(
	variant: IndependentReversalG2Variant,
	annotated: readonly PoolAnnotatedCandidate[],
	data: Dataset,
	from: number,
	until: number,
): CorrectedGgiSignal[] {
	const ext = annotated.filter(({ candidate }) => candidate.source === 'EXT')
	const extPool = ext.filter(({ pool }) => pool?.qualified)
	const own1Pool = annotated.filter(({ candidate, pool }) => candidate.source === 'OWN1' && pool?.qualified)
	const chosen = variant === 'EXT' ? ext
		: variant === 'EXT_POOL' ? extPool
			: variant === 'OWN1_POOL' ? own1Pool
				: variant === 'EXT_POOL_SEQ' ? extPool.filter(({ candidate }) => candidate.features.sequenceScore >= INDEPENDENT_REVERSAL_G2_PROTOCOL.sequence.minimumScore)
					: []
	if (variant === 'G1') return g1Signals(data, from, until)
	if (variant === 'MATCHED_NULL') return matchedNullSignals(ext, extPool, INDEPENDENT_REVERSAL_G2_PROTOCOL.seed + data.symbol.length)
	return chosen.map(({ candidate }) => ({ signalIndex: candidate.index, side: candidate.side }))
}

function convertTrade(symbol: string, trade: CorrectedGgiTrade, oneWayCostBps: number): IndependentReversalG2EvaluatedTrade {
	const net = applyOneWayCostBps(trade, oneWayCostBps)
	return {
		symbol,
		signalAt: trade.signalTimestamp,
		entryIndex: trade.entryIndex,
		exitIndex: trade.exitIndex,
		netR: net.netR,
		turnover: trade.turnover,
		holdingBars: trade.holdingBars,
		outcome: trade.outcome,
	}
}

function evaluateVariant(data: Dataset, variant: IndependentReversalG2Variant, annotated: readonly PoolAnnotatedCandidate[], from: number, until: number): VariantEvaluation {
	const protocol = INDEPENDENT_REVERSAL_G2_PROTOCOL
	const signals = variantSignals(variant, annotated, data, from, until)
	const replayConfig = {
		stopMultiplier: protocol.execution.stopMultiplier,
		beBound: 'next-bar-entry-be' as const,
		addEnabled: false,
		partialFraction: protocol.execution.partialFraction,
		maxHoldingBars: protocol.execution.maxHoldingBars,
	}
	const gross = collectCorrectedSignalTrades(data.rows, data.tr55, signals, replayConfig)
		.filter((trade) => trade.signalTimestamp + HOUR_MS >= from && trade.signalTimestamp + HOUR_MS < until)
	const trades = gross.map((trade) => convertTrade(data.symbol, trade, protocol.execution.baseOneWayCostBps))
	const stress = Object.fromEntries(protocol.execution.stressOneWayCostBps.map((cost) => [String(cost), summarizeIndependentReversalG2(gross.map((trade) => convertTrade(data.symbol, trade, cost)))]))
	return {
		variant,
		signals: signals.length,
		grossTrades: gross,
		trades,
		summary: summarizeIndependentReversalG2(trades),
		bootstrap: deterministicMonthBlockBootstrap(trades, 2_000, protocol.seed + variant.length + data.symbol.length),
		portfolio: simulateIndependentReversalG2Portfolio(trades),
		stress,
	}
}

function combine(variant: IndependentReversalG2Variant, evaluations: readonly VariantEvaluation[]): VariantEvaluation {
	const trades = evaluations.flatMap((evaluation) => evaluation.trades)
	const grossTrades = evaluations.flatMap((evaluation) => evaluation.grossTrades)
	const stressCosts = INDEPENDENT_REVERSAL_G2_PROTOCOL.execution.stressOneWayCostBps
	return {
		variant,
		signals: evaluations.reduce((sum, evaluation) => sum + evaluation.signals, 0),
		grossTrades,
		trades,
		summary: summarizeIndependentReversalG2(trades),
		bootstrap: deterministicMonthBlockBootstrap(trades, 10_000, INDEPENDENT_REVERSAL_G2_PROTOCOL.seed + variant.length),
		portfolio: simulateIndependentReversalG2Portfolio(trades),
		stress: Object.fromEntries(stressCosts.map((cost) => [String(cost), summarizeIndependentReversalG2(evaluations.flatMap((evaluation) => evaluation.grossTrades.map((trade) => convertTrade(evaluation.trades[0]?.symbol ?? 'UNKNOWN', trade, cost))))])),
	}
}

function winner(evaluations: Record<string, VariantEvaluation>): IndependentReversalG2Variant {
	const candidates: IndependentReversalG2Variant[] = ['EXT_POOL', 'OWN1_POOL', 'EXT_POOL_SEQ']
	return candidates.sort((a, b) => {
		const x = evaluations[a]!.summary
		const y = evaluations[b]!.summary
		return (y.meanNetR ?? -Infinity) - (x.meanNetR ?? -Infinity)
			|| (y.profitFactor ?? -Infinity) - (x.profitFactor ?? -Infinity)
			|| x.maximumSequentialDrawdownR - y.maximumSequentialDrawdownR
	})[0]!
}

function compact(evaluation: VariantEvaluation) {
	return { variant: evaluation.variant, signals: evaluation.signals, summary: evaluation.summary, bootstrap: evaluation.bootstrap, portfolio: evaluation.portfolio, stress: evaluation.stress }
}

function foldResults(data: Dataset, evaluation: VariantEvaluation): Array<{ month: string; summary: ReturnType<typeof summarizeIndependentReversalG2> }> {
	const grouped = new Map<string, IndependentReversalG2EvaluatedTrade[]>()
	for (const trade of evaluation.trades) {
		const month = monthKey(trade.signalAt)
		const list = grouped.get(month)
		if (list) list.push(trade)
		else grouped.set(month, [trade])
	}
	return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, trades]) => ({ month, summary: summarizeIndependentReversalG2(trades) }))
}

export interface IndependentReversalG2PromotionInput {
	completeFrozenTransfer: boolean
	candidate: ReturnType<typeof summarizeIndependentReversalG2>
	matchedNull: ReturnType<typeof summarizeIndependentReversalG2>
	stress: ReturnType<typeof summarizeIndependentReversalG2>
	positiveCells: number
	totalCells: number
	maximumSingleSymbolPositiveContribution: number
	maximumPortfolioDrawdownPct: number
}

export function independentReversalG2PromotionVerdict(input: IndependentReversalG2PromotionInput): string {
	if (!input.completeFrozenTransfer) return 'INSUFFICIENT_SEALED_COVERAGE'
	const gates = INDEPENDENT_REVERSAL_G2_PROTOCOL.gates
	const nonCountPass = (input.candidate.meanNetR ?? -Infinity) >= gates.minimumMeanNetR
		&& (input.candidate.profitFactor ?? -Infinity) >= gates.minimumProfitFactor
		&& (input.candidate.bestOnePercentRemovedR ?? -Infinity) > gates.minimumBestOnePercentRemovedR
		&& (input.stress.meanNetR ?? -Infinity) > gates.minimumStressMeanNetR
		&& (input.stress.profitFactor ?? -Infinity) >= gates.minimumStressProfitFactor
		&& input.matchedNull.trades === input.candidate.trades
		&& (input.candidate.meanNetR ?? -Infinity) - (input.matchedNull.meanNetR ?? 0) >= gates.minimumNullAdvantageR
		&& input.positiveCells >= gates.minimumPositiveTransferCells
		&& input.totalCells > 0 && input.positiveCells / input.totalCells >= gates.minimumNonNegativeCellShare
		&& input.maximumSingleSymbolPositiveContribution <= gates.maximumSingleSymbolPositiveContribution
		&& input.maximumPortfolioDrawdownPct <= gates.maximumPortfolioDrawdownPct
	if (nonCountPass && input.candidate.trades >= gates.minimumOosTrades) return 'PROMOTE_G2'
	if (nonCountPass && input.candidate.trades < gates.minimumOosTrades) return 'PROMISING_NOT_PROVEN'
	return 'REJECT_G2'
}

function promotion(transfer: Record<string, VariantEvaluation>, selected: IndependentReversalG2Variant, completeFrozenTransfer: boolean): string {
	const candidate = transfer[selected]!
	const nullEvaluation = transfer.MATCHED_NULL!
	const cells = transfer.__cells as unknown as Array<{ variant: IndependentReversalG2Variant; evaluation: VariantEvaluation }>
	const selectedCells = cells.filter((cell) => cell.variant === selected)
	const positive = selectedCells.filter((cell) => (cell.evaluation.summary.meanNetR ?? -Infinity) >= 0)
	const positiveR = positive.map((cell) => Math.max(0, (cell.evaluation.summary.meanNetR ?? 0) * cell.evaluation.summary.trades))
	const positiveTotalR = positiveR.reduce((sum, value) => sum + value, 0)
	const maximumSingleSymbolPositiveContribution = positiveTotalR > 0 ? Math.max(...positiveR) / positiveTotalR : 0
	const stress = candidate.stress[String(INDEPENDENT_REVERSAL_G2_PROTOCOL.execution.stressOneWayCostBps.at(-1))]!
	return independentReversalG2PromotionVerdict({
		completeFrozenTransfer,
		candidate: candidate.summary,
		matchedNull: nullEvaluation.summary,
		stress,
		positiveCells: positive.length,
		totalCells: selectedCells.length,
		maximumSingleSymbolPositiveContribution,
		maximumPortfolioDrawdownPct: candidate.portfolio.maximumDrawdownPct,
	})
}

export async function runIndependentReversalG2Research() {
	const protocol = INDEPENDENT_REVERSAL_G2_PROTOCOL
	const requestedDevelopment = process.env.G2_DEVELOPMENT_SYMBOLS?.split(',').filter(Boolean) ?? [...protocol.validation.discoverySymbols]
	const requestedTransfer = process.env.G2_TRANSFER_SYMBOLS?.split(',').filter(Boolean) ?? [...protocol.validation.transferSymbols]
	console.log(`[g2] loading development: ${requestedDevelopment.join(', ')}`)
	const developmentData = await Promise.all(requestedDevelopment.map((symbol) => loadDataset(symbol, 'development', DISCOVERY_FROM, DISCOVERY_UNTIL)))
	const developmentCells: Array<{ symbol: string; evaluations: Record<string, VariantEvaluation> }> = []
	for (const data of developmentData) {
		console.log(`[g2] development ${data.symbol}`)
		const candidates = detectIndependentReversalG2Candidates(data.rows)
		const annotated = annotatePools(data, candidates, DISCOVERY_FROM, DISCOVERY_UNTIL)
		developmentCells.push({ symbol: data.symbol, evaluations: Object.fromEntries(PRIMARY_VARIANTS.map((variant) => [variant, evaluateVariant(data, variant, annotated, DISCOVERY_FROM, DISCOVERY_UNTIL)])) })
	}
	const developmentAggregate = Object.fromEntries(PRIMARY_VARIANTS.map((variant) => [variant, combine(variant, developmentCells.map((cell) => cell.evaluations[variant]!))])) as Record<string, VariantEvaluation>
	const selected = winner(developmentAggregate)

	console.log(`[g2] loading transfer: ${requestedTransfer.join(', ')}`)
	const transferData = await Promise.all(requestedTransfer.map((symbol) => loadDataset(symbol, 'transfer', TRANSFER_FROM, TRANSFER_UNTIL)))
	const transferCells: Array<{ symbol: string; variant: IndependentReversalG2Variant; evaluation: VariantEvaluation }> = []
	for (const data of transferData) {
		console.log(`[g2] transfer ${data.symbol}`)
		const candidates = detectIndependentReversalG2Candidates(data.rows)
		const annotated = annotatePools(data, candidates, TRANSFER_FROM, TRANSFER_UNTIL)
		for (const variant of PRIMARY_VARIANTS) transferCells.push({ symbol: data.symbol, variant, evaluation: evaluateVariant(data, variant, annotated, TRANSFER_FROM, TRANSFER_UNTIL) })
	}
	const transferAggregate = Object.fromEntries(PRIMARY_VARIANTS.map((variant) => [variant, combine(variant, transferCells.filter((cell) => cell.variant === variant).map((cell) => cell.evaluation))])) as Record<string, VariantEvaluation>
	Object.defineProperty(transferAggregate, '__cells', { value: transferCells, enumerable: false })
	const completeFrozenTransfer = requestedTransfer.length === protocol.validation.transferSymbols.length
	const verdict = promotion(transferAggregate, selected, completeFrozenTransfer)
	return {
		runnerVersion: INDEPENDENT_REVERSAL_G2_RUNNER_VERSION,
		protocolVersion: protocol.version,
		protocolHash: protocolHash(),
		selectionRule: 'winner frozen on contaminated development symbols before transfer evaluation',
		selectedVariant: selected,
		verdict,
		coverage: { development: developmentData.length, transfer: transferData.length, expectedTransfer: protocol.validation.transferSymbols.length, completeFrozenTransfer: requestedTransfer.length === protocol.validation.transferSymbols.length },
		manifests: [...developmentData, ...transferData].map((data) => ({ symbol: data.symbol, role: data.role, bars1h: data.candles1h.length, bars4h: data.candles4h.length, sha256: data.sha256 })),
		development: {
			aggregate: Object.fromEntries(PRIMARY_VARIANTS.map((variant) => [variant, compact(developmentAggregate[variant]!)])),
			cells: developmentCells.map((cell) => ({ symbol: cell.symbol, variants: Object.fromEntries(PRIMARY_VARIANTS.map((variant) => [variant, compact(cell.evaluations[variant]!)])) })),
		},
		transfer: {
			aggregate: Object.fromEntries(PRIMARY_VARIANTS.map((variant) => [variant, compact(transferAggregate[variant]!)])),
			cells: transferCells.map((cell) => ({ symbol: cell.symbol, ...compact(cell.evaluation), months: foldResults(transferData.find((data) => data.symbol === cell.symbol)!, cell.evaluation) })),
		},
	}
}

function markdown(result: Awaited<ReturnType<typeof runIndependentReversalG2Research>>): string {
	const lines = [
		'# Independent Reversal G2 — frozen fit/transfer verdict', '',
		`Protocol: \`${result.protocolVersion}\``,
		`Protocol hash: \`${result.protocolHash}\``,
		`Development-selected variant: **${result.selectedVariant}**`,
		`Verdict: **${result.verdict}**`, '',
		'## Development aggregate', '',
		'| Variant | Trades | Mean net R | PF | Best 1% removed | 95% block CI | Portfolio DD |',
		'|---|---:|---:|---:|---:|---:|---:|',
	]
	const table = (section: typeof result.development | typeof result.transfer) => {
		for (const variant of PRIMARY_VARIANTS) {
			const evaluation = section.aggregate[variant]!
			const summary = evaluation.summary
			lines.push(`| ${variant} | ${summary.trades} | ${(summary.meanNetR ?? NaN).toFixed(4)} | ${(summary.profitFactor ?? NaN).toFixed(3)} | ${(summary.bestOnePercentRemovedR ?? NaN).toFixed(4)} | [${(evaluation.bootstrap.low95 ?? NaN).toFixed(4)}, ${(evaluation.bootstrap.high95 ?? NaN).toFixed(4)}] | ${evaluation.portfolio.maximumDrawdownPct.toFixed(2)}% |`)
		}
	}
	table(result.development)
	lines.push('', '## Frozen transfer aggregate', '', '| Variant | Trades | Mean net R | PF | Best 1% removed | 95% block CI | Portfolio DD |', '|---|---:|---:|---:|---:|---:|---:|')
	table(result.transfer)
	lines.push('', '## Interpretation', '')
	lines.push('- Winner selection used development symbols only; transfer results did not change the selected variant.')
	lines.push('- All returns include 6 bps one-way cost under the common corrected replay. Dashboard WR is not a promotion metric.')
	lines.push(`- Final machine verdict: **${result.verdict}**.`)
	return `${lines.join('\n')}\n`
}

export async function main() {
	const result = await runIndependentReversalG2Research()
	writeFileSync(resolve('ci-results/independent-reversal-g2-fit-validation.json'), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve('ci-results/independent-reversal-g2-fit-validation.md'), markdown(result))
	console.log(JSON.stringify({ selectedVariant: result.selectedVariant, verdict: result.verdict, coverage: result.coverage }, null, 2))
	return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
