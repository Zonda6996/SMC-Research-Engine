import { createHash } from 'node:crypto'
import type { IndependentReversalFundingPayment } from '../../src/core/analysis/reversalTradeReplay.js'
import type { Candle } from '../../src/models/price/Candle.js'

export const INDEPENDENT_REVERSAL_DATA_MANIFEST_VERSION = 1

export interface IndependentReversalDataManifestEntry {
	schemaVersion: 1
	symbol: string
	market: 'futures'
	timeframe: string
	timeframeMs: number
	requestedFromUtc: string
	requestedUntilUtc: string
	candleRows: number
	uniqueCandles: number
	duplicateCandles: number
	missingBars: number
	irregularIntervals: number
	firstCandleUtc: string | null
	lastCandleUtc: string | null
	fundingRows: number
	uniqueFunding: number
	duplicateFunding: number
	firstFundingUtc: string | null
	lastFundingUtc: string | null
	candlesSha256: string
	fundingSha256: string
	combinedSha256: string
}

function sha256(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function iso(timestamp: number | undefined): string | null {
	return timestamp == null ? null : new Date(timestamp).toISOString()
}

function validateCandle(candle: Candle, index: number): void {
	if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp < 0) throw new Error(`Invalid candle timestamp at row ${index}`)
	for (const [field, value] of Object.entries(candle)) {
		if (field === 'timestamp') continue
		if (!Number.isFinite(value)) throw new Error(`Invalid candle ${field} at row ${index}`)
	}
	if (candle.low > candle.high || candle.open < candle.low || candle.open > candle.high || candle.close < candle.low || candle.close > candle.high || candle.volume < 0) {
		throw new Error(`Invalid candle geometry at row ${index}`)
	}
}

function validateFunding(payment: IndependentReversalFundingPayment, index: number): void {
	if (!Number.isSafeInteger(payment.timestamp) || payment.timestamp < 0) throw new Error(`Invalid funding timestamp at row ${index}`)
	if (!Number.isFinite(payment.rate) || !Number.isFinite(payment.markPrice) || payment.markPrice <= 0) {
		throw new Error(`Invalid funding row ${index}`)
	}
}

/**
 * Builds a deterministic audit manifest for exactly the rows supplied to a
 * symbol×timeframe research cell. Hashes cover sorted, timestamp-deduplicated
 * canonical rows; duplicate counts preserve evidence that input cleanup was
 * required. requestedUntilMs is exclusive.
 */
export function buildIndependentReversalDataManifest(
	symbol: string,
	timeframe: string,
	timeframeMs: number,
	requestedFromMs: number,
	requestedUntilMs: number,
	candles: readonly Candle[],
	funding: readonly IndependentReversalFundingPayment[],
): IndependentReversalDataManifestEntry {
	if (!symbol || !timeframe || !Number.isSafeInteger(timeframeMs) || timeframeMs <= 0) throw new Error('Invalid manifest cell identity')
	if (!Number.isSafeInteger(requestedFromMs) || !Number.isSafeInteger(requestedUntilMs) || requestedFromMs >= requestedUntilMs) {
		throw new Error('Invalid manifest requested interval')
	}
	candles.forEach(validateCandle)
	funding.forEach(validateFunding)
	const candleMap = new Map<number, Candle[]>()
	for (const candle of candles) candleMap.set(candle.timestamp, [...(candleMap.get(candle.timestamp) ?? []), candle])
	const canonicalCandles = [...candleMap.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, rows]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))).at(-1)!)
	const fundingMap = new Map<number, IndependentReversalFundingPayment[]>()
	for (const payment of funding) fundingMap.set(payment.timestamp, [...(fundingMap.get(payment.timestamp) ?? []), payment])
	const canonicalFunding = [...fundingMap.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, rows]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))).at(-1)!)

	let missingBars = 0
	let irregularIntervals = 0
	for (let i = 1; i < canonicalCandles.length; i++) {
		const delta = canonicalCandles[i]!.timestamp - canonicalCandles[i - 1]!.timestamp
		if (delta % timeframeMs !== 0) irregularIntervals++
		else if (delta > timeframeMs) missingBars += delta / timeframeMs - 1
	}
	const candlesSha256 = sha256(canonicalCandles)
	const fundingSha256 = sha256(canonicalFunding)
	const base = {
		schemaVersion: INDEPENDENT_REVERSAL_DATA_MANIFEST_VERSION as 1,
		symbol,
		market: 'futures' as const,
		timeframe,
		timeframeMs,
		requestedFromUtc: new Date(requestedFromMs).toISOString(),
		requestedUntilUtc: new Date(requestedUntilMs).toISOString(),
		candleRows: candles.length,
		uniqueCandles: canonicalCandles.length,
		duplicateCandles: candles.length - canonicalCandles.length,
		missingBars,
		irregularIntervals,
		firstCandleUtc: iso(canonicalCandles[0]?.timestamp),
		lastCandleUtc: iso(canonicalCandles.at(-1)?.timestamp),
		fundingRows: funding.length,
		uniqueFunding: canonicalFunding.length,
		duplicateFunding: funding.length - canonicalFunding.length,
		firstFundingUtc: iso(canonicalFunding[0]?.timestamp),
		lastFundingUtc: iso(canonicalFunding.at(-1)?.timestamp),
		candlesSha256,
		fundingSha256,
	}
	return { ...base, combinedSha256: sha256(base) }
}
