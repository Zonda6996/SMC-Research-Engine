import assert from 'node:assert/strict'
import test from 'node:test'
import {
	replayIndependentReversalTrade,
	type IndependentReversalFundingPayment,
} from '../src/core/analysis/reversalTradeReplay.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { IndependentReversalSignal } from '../src/core/signals/IndependentReversalResearch.js'

const candle = (
	timestamp: number,
	open: number,
	high: number,
	low: number,
	close: number,
): Candle => ({ timestamp, open, high, low, close, volume: 100 })

const signal = (direction: 'long' | 'short' = 'long'): IndependentReversalSignal => ({
	version: 'fixture',
	episodeId: `${direction}-0`,
	family: 'P',
	at: 0,
	index: 0,
	direction,
	episodeStartIndex: 0,
	episodeBars: 0,
	extremeIndex: 0,
	extremePrice: direction === 'long' ? 98 : 102,
	atr: 2,
	innerHalfWidth: 10,
	penetrationInnerWidth: 0.2,
	recoveryInnerWidth: 0.5,
	relativeVolume: 1,
	peakRelativeVolume: 1,
	bodyAtr: 1,
	liquidityQualified: false,
	structureQualified: false,
	volumeQualified: false,
	priceQualified: true,
})

const zeroCosts = {
	takerFeeRate: 0,
	makerFeeRate: 0,
	marketSlippageRate: 0,
	stopBufferAtr: 0,
	minRiskAtr: 0,
	maxRiskAtr: 10,
	targetR: 2,
	timeStopBars: 48,
}

test('Independent Reversal replay: enters at next bar open and target fill is 2R', () => {
	const candles = [
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 101, 99, 100),
		candle(2, 100, 104, 99.5, 103),
	]
	const replay = replayIndependentReversalTrade(candles, signal(), [], zeroCosts)
	assert.equal(replay.status, 'closed')
	assert.equal(replay.entryIndex, 1)
	assert.equal(replay.entryPrice, 100)
	assert.equal(replay.exitIndex, 2)
	assert.equal(replay.exitReason, 'target')
	assert.equal(replay.targetPrice, 104)
	assert.equal(replay.grossR, 2)
	assert.equal(replay.netR, 2)
})

test('Independent Reversal replay: stop wins a same-bar stop/target conflict', () => {
	const candles = [
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 105, 97, 102),
	]
	const replay = replayIndependentReversalTrade(candles, signal(), [], zeroCosts)
	assert.equal(replay.exitReason, 'stop')
	assert.equal(replay.exitPrice, 98)
	assert.equal(replay.netR, -1)
})

test('Independent Reversal replay: a stop gap fills at the worse open', () => {
	const candles = [
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 101, 99, 100),
		candle(2, 96, 97, 95, 96),
	]
	const replay = replayIndependentReversalTrade(candles, signal(), [], zeroCosts)
	assert.equal(replay.exitReason, 'stop')
	assert.equal(replay.exitReferencePrice, 96)
	assert.equal(replay.exitPrice, 96)
	assert.equal(replay.netR, -2)
})

test('Independent Reversal replay: time stop closes on the configured held bar', () => {
	const candles = [
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 101, 99, 100),
		candle(2, 100, 101, 99, 101),
	]
	const replay = replayIndependentReversalTrade(candles, signal(), [], {
		...zeroCosts,
		timeStopBars: 2,
	})
	assert.equal(replay.exitReason, 'time')
	assert.equal(replay.exitIndex, 2)
	assert.equal(replay.holdingBars, 2)
	assert.equal(replay.netR, 0.5)
})

test('Independent Reversal replay: fees and adverse slippage are decomposed without double counting', () => {
	const candles = [
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 100.5, 99.5, 100),
		candle(2, 100, 104.4, 99.5, 103),
	]
	const replay = replayIndependentReversalTrade(candles, signal(), [], {
		...zeroCosts,
		takerFeeRate: 0.001,
		makerFeeRate: 0.002,
		marketSlippageRate: 0.001,
	})
	assert.equal(replay.status, 'closed')
	assert.equal(replay.entryReferencePrice, 100)
	assert.equal(replay.entryPrice, 100.1)
	assert.equal(replay.exitReason, 'target')
	assert.ok(Math.abs(replay.slippageR! - (0.1 / 2.1)) < 1e-12)
	assert.ok(Math.abs(replay.feeR! - ((100.1 * 0.001 + replay.exitPrice! * 0.002) / 2.1)) < 1e-12)
	assert.ok(Math.abs(replay.netR! - (replay.grossR! - replay.feeR!)) < 1e-12)
})

test('Independent Reversal replay: positive funding is a long cost and a short credit', () => {
	const longCandles = [
		candle(0, 99, 101, 98, 100),
		candle(10, 100, 101, 99, 100),
		candle(20, 100, 101, 99, 100),
		candle(30, 100, 104, 99, 103),
	]
	const payments: IndependentReversalFundingPayment[] = [
		{ timestamp: 10, rate: 0.01, markPrice: 100 },
		{ timestamp: 20, rate: 0.01, markPrice: 100 },
		{ timestamp: 30, rate: 0.01, markPrice: 100 },
		{ timestamp: 31, rate: 0.01, markPrice: 100 },
	]
	const long = replayIndependentReversalTrade(longCandles, signal('long'), payments, zeroCosts)
	assert.equal(long.fundingPayments, 1)
	assert.equal(long.fundingR, -0.5)
	assert.equal(long.netR, 1.5)

	const shortCandles = [
		candle(0, 101, 102, 99, 100),
		candle(10, 100, 101, 99, 100),
		candle(20, 100, 101, 99, 100),
		candle(30, 100, 101, 96, 97),
	]
	const short = replayIndependentReversalTrade(shortCandles, signal('short'), payments, zeroCosts)
	assert.equal(short.fundingPayments, 1)
	assert.equal(short.fundingR, 0.5)
	assert.equal(short.netR, 2.5)
})

test('Independent Reversal replay: explicit statuses cover no-next-bar, invalid gap, risk and unresolved tail', () => {
	const noNext = replayIndependentReversalTrade([candle(0, 99, 101, 98, 100)], signal(), [], zeroCosts)
	assert.equal(noNext.status, 'no-next-bar')

	const gapSignal = { ...signal(), extremePrice: 101 }
	const gap = replayIndependentReversalTrade([
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 101, 99, 100),
	], gapSignal, [], zeroCosts)
	assert.equal(gap.status, 'gap-invalid')

	const risk = replayIndependentReversalTrade([
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 101, 99, 100),
	], signal(), [], { ...zeroCosts, minRiskAtr: 2 })
	assert.equal(risk.status, 'risk-invalid')

	const unresolved = replayIndependentReversalTrade([
		candle(0, 99, 101, 98, 100),
		candle(1, 100, 101, 99, 100),
	], signal(), [], zeroCosts)
	assert.equal(unresolved.status, 'unresolved')
})
