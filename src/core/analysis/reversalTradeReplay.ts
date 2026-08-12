import type { Candle } from '../../models/price/Candle.js'
import type {
	IndependentReversalDirection,
	IndependentReversalSignal,
} from '../signals/IndependentReversalResearch.js'
import { INDEPENDENT_REVERSAL_PROTOCOL } from '../signals/IndependentReversalProtocol.js'

export const INDEPENDENT_REVERSAL_TRADE_REPLAY_VERSION =
	'independent-reversal-trade-replay-1.0-next-open'

export interface IndependentReversalTradeConfig {
	takerFeeRate: number
	makerFeeRate: number
	marketSlippageRate: number
	stopBufferAtr: number
	minRiskAtr: number
	maxRiskAtr: number
	targetR: number
	timeStopBars: number
}

export const DEFAULT_INDEPENDENT_REVERSAL_TRADE_CONFIG: IndependentReversalTradeConfig = {
	takerFeeRate: INDEPENDENT_REVERSAL_PROTOCOL.execution.takerFeeRate,
	makerFeeRate: INDEPENDENT_REVERSAL_PROTOCOL.execution.makerFeeRate,
	marketSlippageRate: INDEPENDENT_REVERSAL_PROTOCOL.execution.marketSlippageRate,
	stopBufferAtr: INDEPENDENT_REVERSAL_PROTOCOL.execution.stopBufferAtr,
	minRiskAtr: INDEPENDENT_REVERSAL_PROTOCOL.execution.minRiskAtr,
	maxRiskAtr: INDEPENDENT_REVERSAL_PROTOCOL.execution.maxRiskAtr,
	targetR: INDEPENDENT_REVERSAL_PROTOCOL.execution.targetR,
	timeStopBars: INDEPENDENT_REVERSAL_PROTOCOL.execution.timeStopBars,
}

/**
 * Funding rate observed at an actual settlement timestamp. Positive rate means
 * longs pay shorts; negative rate means shorts pay longs. markPrice is the
 * settlement mark used to convert the rate into quote-currency PnL per unit.
 */
export interface IndependentReversalFundingPayment {
	timestamp: number
	rate: number
	markPrice: number
}

export type IndependentReversalTradeStatus =
	| 'closed'
	| 'unresolved'
	| 'no-next-bar'
	| 'gap-invalid'
	| 'risk-invalid'

export type IndependentReversalExitReason = 'target' | 'stop' | 'time'

export interface IndependentReversalTradeReplay {
	version: string
	tradeId: string
	status: IndependentReversalTradeStatus
	direction: IndependentReversalDirection
	signalIndex: number
	entryIndex: number | null
	exitIndex: number | null
	entryAt: number | null
	exitAt: number | null
	entryReferencePrice: number | null
	entryPrice: number | null
	stopPrice: number | null
	targetPrice: number | null
	exitReferencePrice: number | null
	exitPrice: number | null
	exitReason: IndependentReversalExitReason | null
	risk: number | null
	riskAtr: number | null
	holdingBars: number | null
	grossR: number | null
	entryFeeR: number | null
	exitFeeR: number | null
	feeR: number | null
	slippageR: number | null
	fundingR: number | null
	fundingPayments: number
	netR: number | null
}

interface ExitFill {
	reason: IndependentReversalExitReason
	index: number
	referencePrice: number
	fillPrice: number
	feeRate: number
}

function adverseMarketFill(
	price: number,
	direction: IndependentReversalDirection,
	isEntry: boolean,
	slippageRate: number,
): number {
	const adverseUp = (direction === 'long') === isEntry
	return price * (adverseUp ? 1 + slippageRate : 1 - slippageRate)
}

function directionalPnl(
	direction: IndependentReversalDirection,
	entry: number,
	exit: number,
): number {
	return direction === 'long' ? exit - entry : entry - exit
}

function emptyReplay(
	signal: IndependentReversalSignal,
	status: Exclude<IndependentReversalTradeStatus, 'closed'>,
	partial: Partial<IndependentReversalTradeReplay> = {},
): IndependentReversalTradeReplay {
	return {
		version: INDEPENDENT_REVERSAL_TRADE_REPLAY_VERSION,
		tradeId: `${signal.episodeId}-${signal.family}-${signal.index}`,
		status,
		direction: signal.direction,
		signalIndex: signal.index,
		entryIndex: null,
		exitIndex: null,
		entryAt: null,
		exitAt: null,
		entryReferencePrice: null,
		entryPrice: null,
		stopPrice: null,
		targetPrice: null,
		exitReferencePrice: null,
		exitPrice: null,
		exitReason: null,
		risk: null,
		riskAtr: null,
		holdingBars: null,
		grossR: null,
		entryFeeR: null,
		exitFeeR: null,
		feeR: null,
		slippageR: null,
		fundingR: null,
		fundingPayments: 0,
		netR: null,
		...partial,
	}
}

function validateConfig(config: IndependentReversalTradeConfig): void {
	for (const [key, value] of Object.entries(config)) {
		if (!Number.isFinite(value) || value < 0) {
			throw new Error(`Independent Reversal trade replay: invalid ${key}`)
		}
	}
	if (config.minRiskAtr > config.maxRiskAtr) {
		throw new Error('Independent Reversal trade replay: minRiskAtr exceeds maxRiskAtr')
	}
	if (!Number.isInteger(config.timeStopBars) || config.timeStopBars < 1) {
		throw new Error('Independent Reversal trade replay: timeStopBars must be a positive integer')
	}
}

function fundingPnlR(
	payments: readonly IndependentReversalFundingPayment[],
	direction: IndependentReversalDirection,
	entryAt: number,
	exitAt: number,
	risk: number,
): { fundingR: number; count: number } {
	let quotePnl = 0
	let count = 0
	for (const payment of payments) {
		if (payment.timestamp <= entryAt || payment.timestamp >= exitAt) continue
		if (!Number.isFinite(payment.rate) || !Number.isFinite(payment.markPrice) || payment.markPrice <= 0) continue
		const longQuotePnl = -payment.markPrice * payment.rate
		quotePnl += direction === 'long' ? longQuotePnl : -longQuotePnl
		count++
	}
	return { fundingR: quotePnl / risk, count }
}

/**
 * Replays one frozen G1 signal with no look-ahead:
 * - the signal is final at signalIndex close;
 * - entry is the next candle open with adverse market slippage;
 * - stop is beyond the episode extreme, target is 2R by default;
 * - stop wins any same-bar stop/target ambiguity;
 * - a gap through the stop exits from the worse of stop or candle open, then
 *   receives adverse market slippage;
 * - the 48th held candle (default) closes the trade at its slipped close;
 * - only funding settlements strictly between entry and exit count.
 *
 * slippageR is diagnostic. Slippage is already embedded in grossR through the
 * actual entry/exit fills and therefore is not subtracted a second time.
 */
export function replayIndependentReversalTrade(
	candles: Candle[],
	signal: IndependentReversalSignal,
	fundingPayments: readonly IndependentReversalFundingPayment[] = [],
	partial: Partial<IndependentReversalTradeConfig> = {},
): IndependentReversalTradeReplay {
	const config = { ...DEFAULT_INDEPENDENT_REVERSAL_TRADE_CONFIG, ...partial }
	validateConfig(config)
	if (signal.index < 0 || signal.index >= candles.length) {
		return emptyReplay(signal, 'unresolved')
	}
	const entryIndex = signal.index + 1
	const entryCandle = candles[entryIndex]
	if (entryCandle == null) return emptyReplay(signal, 'no-next-bar')
	if (!Number.isFinite(signal.atr) || signal.atr <= 0 || !Number.isFinite(signal.extremePrice)) {
		return emptyReplay(signal, 'risk-invalid', { entryIndex, entryAt: entryCandle.timestamp })
	}

	const entryReferencePrice = entryCandle.open
	const entryPrice = adverseMarketFill(
		entryReferencePrice,
		signal.direction,
		true,
		config.marketSlippageRate,
	)
	const stopPrice = signal.direction === 'long'
		? signal.extremePrice - config.stopBufferAtr * signal.atr
		: signal.extremePrice + config.stopBufferAtr * signal.atr
	const gapInvalid = signal.direction === 'long'
		? entryPrice <= stopPrice
		: entryPrice >= stopPrice
	if (gapInvalid) {
		return emptyReplay(signal, 'gap-invalid', {
			entryIndex,
			entryAt: entryCandle.timestamp,
			entryReferencePrice,
			entryPrice,
			stopPrice,
		})
	}

	const risk = Math.abs(entryPrice - stopPrice)
	const riskAtr = risk / signal.atr
	const targetPrice = signal.direction === 'long'
		? entryPrice + config.targetR * risk
		: entryPrice - config.targetR * risk
	if (!Number.isFinite(riskAtr) || riskAtr < config.minRiskAtr || riskAtr > config.maxRiskAtr || targetPrice <= 0) {
		return emptyReplay(signal, 'risk-invalid', {
			entryIndex,
			entryAt: entryCandle.timestamp,
			entryReferencePrice,
			entryPrice,
			stopPrice,
			targetPrice,
			risk,
			riskAtr,
		})
	}

	let exit: ExitFill | null = null
	for (let i = entryIndex; i < candles.length; i++) {
		const candle = candles[i]!
		const holdingBars = i - entryIndex + 1
		const hitStop = signal.direction === 'long'
			? candle.low <= stopPrice
			: candle.high >= stopPrice
		const hitTarget = signal.direction === 'long'
			? candle.high >= targetPrice
			: candle.low <= targetPrice

		if (hitStop) {
			const gapReference = signal.direction === 'long'
				? Math.min(stopPrice, candle.open)
				: Math.max(stopPrice, candle.open)
			exit = {
				reason: 'stop',
				index: i,
				referencePrice: gapReference,
				fillPrice: adverseMarketFill(gapReference, signal.direction, false, config.marketSlippageRate),
				feeRate: config.takerFeeRate,
			}
			break
		}
		if (hitTarget) {
			exit = {
				reason: 'target',
				index: i,
				referencePrice: targetPrice,
				fillPrice: targetPrice,
				feeRate: config.makerFeeRate,
			}
			break
		}
		if (holdingBars >= config.timeStopBars) {
			exit = {
				reason: 'time',
				index: i,
				referencePrice: candle.close,
				fillPrice: adverseMarketFill(candle.close, signal.direction, false, config.marketSlippageRate),
				feeRate: config.takerFeeRate,
			}
			break
		}
	}

	if (exit == null) {
		return emptyReplay(signal, 'unresolved', {
			entryIndex,
			entryAt: entryCandle.timestamp,
			entryReferencePrice,
			entryPrice,
			stopPrice,
			targetPrice,
			risk,
			riskAtr,
		})
	}

	const exitCandle = candles[exit.index]!
	const grossR = directionalPnl(signal.direction, entryPrice, exit.fillPrice) / risk
	const entryFeeR = entryPrice * config.takerFeeRate / risk
	const exitFeeR = exit.fillPrice * exit.feeRate / risk
	const feeR = entryFeeR + exitFeeR
	const entrySlippageR = Math.abs(entryPrice - entryReferencePrice) / risk
	const exitSlippageR = Math.abs(exit.fillPrice - exit.referencePrice) / risk
	const slippageR = entrySlippageR + exitSlippageR
	const funding = fundingPnlR(
		fundingPayments,
		signal.direction,
		entryCandle.timestamp,
		exitCandle.timestamp,
		risk,
	)
	const netR = grossR - feeR + funding.fundingR

	return {
		version: INDEPENDENT_REVERSAL_TRADE_REPLAY_VERSION,
		tradeId: `${signal.episodeId}-${signal.family}-${signal.index}`,
		status: 'closed',
		direction: signal.direction,
		signalIndex: signal.index,
		entryIndex,
		exitIndex: exit.index,
		entryAt: entryCandle.timestamp,
		exitAt: exitCandle.timestamp,
		entryReferencePrice,
		entryPrice,
		stopPrice,
		targetPrice,
		exitReferencePrice: exit.referencePrice,
		exitPrice: exit.fillPrice,
		exitReason: exit.reason,
		risk,
		riskAtr,
		holdingBars: exit.index - entryIndex + 1,
		grossR,
		entryFeeR,
		exitFeeR,
		feeR,
		slippageR,
		fundingR: funding.fundingR,
		fundingPayments: funding.count,
		netR,
	}
}
