import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LiquidityPoiCandidate } from '../../src/core/confirmation/LiquidityPoiCalibration.js'
import {
	blockBootstrapExpectancy,
	contributionShares,
	groupIndependentReversalMetrics,
	summarizeIndependentReversalTrades,
	type IndependentReversalResearchTrade,
} from '../../src/core/analysis/reversalResearchMetrics.js'
import {
	replayIndependentReversalTrade,
	type IndependentReversalFundingPayment,
} from '../../src/core/analysis/reversalTradeReplay.js'
import { computeLtfEvents } from '../../src/core/fib/MultiTfEntryEngine.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import {
	detectIndependentReversalSignals,
	type IndependentReversalSignalFamily,
} from '../../src/core/signals/IndependentReversalResearch.js'
import {
	INDEPENDENT_REVERSAL_FAMILIES,
	INDEPENDENT_REVERSAL_PROTOCOL,
	stableProtocolJson,
	type IndependentReversalFamily,
} from '../../src/core/signals/IndependentReversalProtocol.js'
import type { StructureEvent } from '../../src/models/events/StructureEvent.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { TF_MS } from '../../tools/shared/candleFetcher.js'
import { fetchFundingHistory } from '../../tools/shared/fundingFetcher.js'
import {
	buildIndependentReversalDataManifest,
	type IndependentReversalDataManifestEntry,
} from '../../tools/shared/reversalDataManifest.js'

export const INDEPENDENT_REVERSAL_RUNNER_VERSION = 'independent-reversal-runner-1.0-stage-guarded'

export type IndependentReversalResearchStage =
	| 'fit'
	| 'signal-validation'
	| 'management-validation'
	| 'portability'
	| 'sealed'

export interface IndependentReversalStageRequest {
	stage: IndependentReversalResearchStage
	symbol: string
	timeframe: string
	fromMs: number
	untilMs: number
	selectedFamilies?: readonly IndependentReversalFamily[]
	expectedModelHash?: string
	sealedConfirmation?: string
}

export interface IndependentReversalCellInput extends IndependentReversalStageRequest {
	candles: Candle[]
	funding: IndependentReversalFundingPayment[]
	structureEvents?: StructureEvent[]
	liquidityZones?: LiquidityPoiCandidate[]
	bootstrapRuns?: number
}

export interface IndependentReversalCellResult {
	runnerVersion: string
	protocolVersion: string
	protocolHash: string
	modelHash: string | null
	stage: IndependentReversalResearchStage
	symbol: string
	timeframe: string
	fromUtc: string
	untilUtc: string
	selectedFamilies: IndependentReversalSignalFamily[]
	liquidityInput: 'provided-pois' | 'structure-sweep-only'
	manifest: IndependentReversalDataManifestEntry
	counts: {
		signals: number
		closedTrades: number
		unresolved: number
		invalid: number
	}
	overall: ReturnType<typeof summarizeIndependentReversalTrades>
	byFamily: ReturnType<typeof groupIndependentReversalMetrics>
	byDirection: ReturnType<typeof groupIndependentReversalMetrics>
	bootstrap: ReturnType<typeof blockBootstrapExpectancy>
	positiveContributionBySymbol: Record<string, number>
	trades: IndependentReversalResearchTrade[]
}

const DEVELOPMENT_SYMBOLS = new Set(INDEPENDENT_REVERSAL_PROTOCOL.development.symbols)
const SEALED_SYMBOLS = new Set(INDEPENDENT_REVERSAL_PROTOCOL.sealed.symbols)
const DAY_MS = 86_400_000

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

export function independentReversalProtocolHash(): string {
	return hash(stableProtocolJson())
}

export function independentReversalModelHash(selectedFamilies: readonly IndependentReversalFamily[]): string {
	const unique = [...new Set(selectedFamilies)].sort()
	if (!unique.length || unique.some((family) => !INDEPENDENT_REVERSAL_FAMILIES.includes(family))) {
		throw new Error('Model hash requires one or more registered signal families')
	}
	return hash(stableProtocolJson({
		protocolHash: independentReversalProtocolHash(),
		selectedFamilies: unique,
		execution: INDEPENDENT_REVERSAL_PROTOCOL.execution,
	}))
}

function dateRange(range: readonly [string, string]): [number, number] {
	return [Date.parse(`${range[0]}T00:00:00Z`), Date.parse(`${range[1]}T00:00:00Z`)]
}

function sameRange(request: IndependentReversalStageRequest, expected: readonly [string, string]): boolean {
	const [from, until] = dateRange(expected)
	return request.fromMs === from && request.untilMs === until
}

function normalizedFamilies(request: IndependentReversalStageRequest): IndependentReversalFamily[] {
	return [...new Set(request.selectedFamilies ?? [])].sort()
}

/** Enforces the preregistered asset, timeframe and chronological stage boundaries. */
export function assertIndependentReversalStage(request: IndependentReversalStageRequest): void {
	if (!Number.isSafeInteger(request.fromMs) || !Number.isSafeInteger(request.untilMs) || request.fromMs >= request.untilMs) {
		throw new Error('Research stage requires a valid half-open UTC interval')
	}
	const developmentCell = DEVELOPMENT_SYMBOLS.has(request.symbol)
	if (request.stage === 'fit') {
		if (!developmentCell || request.timeframe !== '15m' || !sameRange(request, INDEPENDENT_REVERSAL_PROTOCOL.development.fit)) {
			throw new Error('Fit stage is restricted to preregistered development 15m cells and 2021-2022')
		}
		return
	}
	if (request.stage === 'signal-validation') {
		if (!developmentCell || request.timeframe !== '15m' || !sameRange(request, INDEPENDENT_REVERSAL_PROTOCOL.development.signalValidation)) {
			throw new Error('Signal validation is restricted to preregistered development 15m cells and 2023')
		}
		return
	}

	const families = normalizedFamilies(request)
	const actualModelHash = independentReversalModelHash(families)
	if (request.expectedModelHash !== actualModelHash) {
		throw new Error(`Frozen model hash mismatch: expected ${actualModelHash}`)
	}
	if (request.stage === 'management-validation') {
		if (!developmentCell || request.timeframe !== '15m' || !sameRange(request, INDEPENDENT_REVERSAL_PROTOCOL.development.managementValidation)) {
			throw new Error('Management validation is restricted to preregistered development 15m cells and 2024')
		}
		return
	}
	if (request.stage === 'portability') {
		const [fitFrom] = dateRange(INDEPENDENT_REVERSAL_PROTOCOL.development.fit)
		const [, managementUntil] = dateRange(INDEPENDENT_REVERSAL_PROTOCOL.development.managementValidation)
		if (!developmentCell || !INDEPENDENT_REVERSAL_PROTOCOL.portability.timeframes.includes(request.timeframe as '5m' | '1h') || request.fromMs !== fitFrom || request.untilMs !== managementUntil) {
			throw new Error('Portability is restricted to development symbols, 5m/1h and 2021-2024 without retuning')
		}
		return
	}
	if (!SEALED_SYMBOLS.has(request.symbol) || !INDEPENDENT_REVERSAL_PROTOCOL.sealed.timeframes.includes(request.timeframe as '5m' | '15m' | '1h')) {
		throw new Error('Sealed stage uses only preregistered unseen symbol×timeframe cells')
	}
	const sealedFrom = Date.parse(`${INDEPENDENT_REVERSAL_PROTOCOL.sealed.from}T00:00:00Z`)
	if (request.fromMs !== sealedFrom || request.untilMs <= sealedFrom + DAY_MS) throw new Error('Invalid sealed UTC boundary')
	const confirmation = `OPEN-SEALED:${actualModelHash}:${new Date(request.untilMs).toISOString()}`
	if (request.sealedConfirmation !== confirmation) {
		throw new Error(`Sealed stage is locked; exact confirmation required: ${confirmation}`)
	}
}

function includedFamilies(request: IndependentReversalStageRequest): IndependentReversalSignalFamily[] {
	if (request.stage === 'fit' || request.stage === 'signal-validation') return ['CORE', ...INDEPENDENT_REVERSAL_FAMILIES]
	return normalizedFamilies(request)
}

export function runIndependentReversalCell(input: IndependentReversalCellInput): IndependentReversalCellResult {
	assertIndependentReversalStage(input)
	const timeframeMs = TF_MS[input.timeframe]
	if (timeframeMs == null) throw new Error(`Unknown timeframe ${input.timeframe}`)
	const candles = input.candles.filter((candle) => candle.timestamp >= input.fromMs && candle.timestamp + timeframeMs <= input.untilMs)
	const funding = input.funding.filter((payment) => payment.timestamp >= input.fromMs && payment.timestamp < input.untilMs)
	const manifest = buildIndependentReversalDataManifest(
		input.symbol, input.timeframe, timeframeMs, input.fromMs, input.untilMs, input.candles, input.funding,
	)
	if (manifest.duplicateCandles || manifest.duplicateFunding || manifest.irregularIntervals || manifest.missingBars) {
		throw new Error(`Research cell data integrity failed: candleDuplicates=${manifest.duplicateCandles}, fundingDuplicates=${manifest.duplicateFunding}, missing=${manifest.missingBars}, irregular=${manifest.irregularIntervals}`)
	}
	if (manifest.firstCandleUtc !== new Date(input.fromMs).toISOString() || manifest.lastCandleUtc !== new Date(input.untilMs - timeframeMs).toISOString()) {
		throw new Error(`Research cell does not cover the full requested candle interval: ${manifest.firstCandleUtc}..${manifest.lastCandleUtc}`)
	}
	const structureEvents = input.structureEvents ?? computeLtfEvents(candles)
	const signals = detectIndependentReversalSignals({
		candles,
		apexBands: computeApexBands(candles),
		structureEvents,
		...(input.liquidityZones ? { liquidityZones: input.liquidityZones } : {}),
	})
	const families = includedFamilies(input)
	const selectedSignals = signals.filter((signal) => families.includes(signal.family))
	const replays = selectedSignals.map((signal) => ({ signal, replay: replayIndependentReversalTrade(candles, signal, funding) }))
	const trades: IndependentReversalResearchTrade[] = replays
		.filter(({ replay }) => replay.status === 'closed' && replay.netR != null && replay.entryAt != null && replay.exitAt != null && replay.exitReason != null)
		.map(({ signal, replay }) => ({
			...replay,
			status: 'closed',
			netR: replay.netR!,
			entryAt: replay.entryAt!,
			exitAt: replay.exitAt!,
			exitReason: replay.exitReason!,
			symbol: input.symbol,
			timeframe: input.timeframe,
			family: signal.family,
		}))
	const invalidStatuses = new Set(['gap-invalid', 'risk-invalid', 'no-next-bar'])
	const modelFamilies = normalizedFamilies(input)
	return {
		runnerVersion: INDEPENDENT_REVERSAL_RUNNER_VERSION,
		protocolVersion: INDEPENDENT_REVERSAL_PROTOCOL.version,
		protocolHash: independentReversalProtocolHash(),
		modelHash: modelFamilies.length ? independentReversalModelHash(modelFamilies) : null,
		stage: input.stage,
		symbol: input.symbol,
		timeframe: input.timeframe,
		fromUtc: new Date(input.fromMs).toISOString(),
		untilUtc: new Date(input.untilMs).toISOString(),
		selectedFamilies: families,
		liquidityInput: input.liquidityZones ? 'provided-pois' : 'structure-sweep-only',
		manifest,
		counts: {
			signals: selectedSignals.length,
			closedTrades: trades.length,
			unresolved: replays.filter(({ replay }) => replay.status === 'unresolved').length,
			invalid: replays.filter(({ replay }) => invalidStatuses.has(replay.status)).length,
		},
		overall: summarizeIndependentReversalTrades(trades),
		byFamily: groupIndependentReversalMetrics(trades, (trade) => trade.family),
		byDirection: groupIndependentReversalMetrics(trades, (trade) => trade.direction),
		bootstrap: blockBootstrapExpectancy(trades, input.bootstrapRuns ?? 10_000, INDEPENDENT_REVERSAL_PROTOCOL.seed),
		positiveContributionBySymbol: contributionShares(trades),
		trades,
	}
}

interface CliArgs {
	stage: IndependentReversalResearchStage
	symbol: string
	timeframe: string
	fromMs: number
	untilMs: number
	selectedFamilies?: IndependentReversalFamily[]
	expectedModelHash?: string
	sealedConfirmation?: string
	output: string
}

function parseCli(argv: string[]): CliArgs {
	const values = new Map<string, string>()
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i]
		const value = argv[i + 1]
		if (!key?.startsWith('--') || value == null) throw new Error(`Invalid CLI argument near ${key ?? '<end>'}`)
		values.set(key.slice(2), value)
	}
	const stage = values.get('stage') as IndependentReversalResearchStage
	const symbol = values.get('symbol')
	const timeframe = values.get('timeframe')
	const from = values.get('from')
	const until = values.get('until')
	if (!stage || !symbol || !timeframe || !from || !until) throw new Error('Required: --stage --symbol --timeframe --from --until')
	const families = values.get('families')?.split(',').filter(Boolean) as IndependentReversalFamily[] | undefined
	const output = values.get('output') ?? resolve('ci-results', `independent-reversal-${stage}-${symbol.replace(/\W/g, '')}-${timeframe}.json`)
	const expectedModelHash = values.get('model-hash')
	const sealedConfirmation = values.get('sealed-confirmation')
	return {
		stage,
		symbol,
		timeframe,
		fromMs: Date.parse(`${from}T00:00:00Z`),
		untilMs: Date.parse(`${until}T00:00:00Z`),
		...(families ? { selectedFamilies: families } : {}),
		...(expectedModelHash ? { expectedModelHash } : {}),
		...(sealedConfirmation ? { sealedConfirmation } : {}),
		output,
	}
}

async function main(): Promise<void> {
	const args = parseCli(process.argv.slice(2))
	assertIndependentReversalStage(args)
	const [candles, funding] = await Promise.all([
		fetchArchiveKlines(args.symbol, args.timeframe, 'futures', args.fromMs, args.untilMs),
		fetchFundingHistory(args.symbol, args.fromMs, args.untilMs),
	])
	const result = runIndependentReversalCell({ ...args, candles, funding })
	mkdirSync(dirname(args.output), { recursive: true })
	writeFileSync(args.output, JSON.stringify(result, null, 2))
	console.log(JSON.stringify({
		output: args.output,
		protocolHash: result.protocolHash,
		modelHash: result.modelHash,
		stage: result.stage,
		cell: `${result.symbol}|${result.timeframe}`,
		counts: result.counts,
		overall: result.overall,
	}, null, 2))
}

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
