import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import type { ApexBand } from '../src/core/signals/ApexEngine.js'
import type { ArrowSignal } from '../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, replayArrowTrade, summarizeArrowTrades } from '../src/core/signals/ArrowTradeReplay.js'

const HOUR = 3_600_000
const candle = (index: number, values: Partial<Candle> = {}): Candle => ({
	timestamp: index * HOUR,
	open: 100,
	high: 100.5,
	low: 99.5,
	close: 100,
	volume: 1_000,
	...values,
})
const band = (values: Partial<ApexBand> = {}): ApexBand => ({
	mean: 101,
	s: 0.01,
	redLo: 102,
	redHi: 104,
	greenHi: 98,
	greenLo: 96,
	...values,
})
const signal = (signalIndex = 0): ArrowSignal => ({
	version: 'test',
	signalIndex,
	signalAt: signalIndex * HOUR,
	side: 'long',
	close: 99,
	mean: 101,
	inner: 98,
	outer: 96,
	atr200: 1,
	trigger: { family: 'own2-extension', penetrationInner: 0.5, distanceMeanPct: 4, relativeVolume: 2 },
})
const geometry = { stepDivisor: 5.5, stopSteps: 1, oneWayCostBps: 0 }

it('replays static full TP and gives stop priority on same-bar ambiguity', () => {
	const full = replayArrowTrade(
		[candle(0), candle(1, { low: 99.5, high: 102.2 })],
		[band(), band()], signal(), 'standard', geometry,
	)
	assert.equal(full?.outcome, 'full-tp')
	assert.equal(full?.grossR, 2)

	const ambiguous = replayArrowTrade(
		[candle(0), candle(1, { low: 99, high: 102.2 })],
		[band(), band()], signal(), 'standard', geometry,
	)
	assert.equal(ambiguous?.outcome, 'stop')
	assert.equal(ambiguous?.grossR, -1)
})

it('replays Partial -> Stop when price drops back to original stop', () => {
	const partialStop = replayArrowTrade(
		[candle(0), candle(1, { low: 100.2, high: 101.2 }), candle(2, { low: 98, high: 100.8 })],
		[band(), band({ mean: 101 }), band({ mean: 101 })], signal(), 'safe', { ...geometry, partialFraction: 0.25 },
	)
	assert.equal(partialStop?.outcome, 'partial-stop')
	assert.equal(partialStop?.partialTaken, true)
	assert.ok(partialStop != null && partialStop.grossR < 0)
})

it('requires a close beyond moving opposite Inner for Safe/Risk full TP', () => {
	const trade = replayArrowTrade(
		[
			candle(0),
			candle(1, { high: 103, close: 101.5 }),
			candle(2, { high: 103, close: 102.1 }),
		],
		[band(), band({ mean: 105, redLo: 102 }), band({ mean: 105, redLo: 102 })],
		signal(), 'safe', geometry,
	)
	assert.equal(trade?.outcome, 'full-tp')
	assert.equal(trade?.exitIndex, 2)
	assert.deepEqual(trade?.eventPrices, { partial: null, full: 102 })
	assert.deepEqual(trade?.events.find((event) => event.type === 'full'), { type: 'full', index: 2, at: 2 * HOUR, price: 102 })
	assert.ok(!trade?.events.some((event) => event.type === 'full' && event.index === 1))
})

it('records changing moving trajectory and leaves Standard trajectory empty/static', () => {
	const candles = [candle(0), candle(1), candle(2)]
	const bands = [band(), band({ mean: 101, redLo: 102 }), band({ mean: 101.5, redLo: 102.5 })]
	const moving = replayArrowTrade(candles, bands, signal(), 'risk', geometry)
	assert.equal(moving?.management, 'moving-apex')
	assert.deepEqual(moving?.trajectory.map((point) => [point.mean, point.oppositeInner]), [[101, 102], [101.5, 102.5]])
	assert.equal(moving?.partial, null)
	assert.deepEqual(moving?.eventPrices, { partial: null, full: null })
	assert.deepEqual(moving?.currentLevels, { mean: 101.5, oppositeInner: 102.5, staticFull: null })
	const staticTrade = replayArrowTrade(candles, bands, signal(), 'standard', geometry)
	assert.equal(staticTrade?.management, 'static')
	assert.deepEqual(staticTrade?.trajectory, [])
})

it('records the GEO4 add fill and uses add-filled stake as the R basis', () => {
	const trade = replayArrowTrade(
		[candle(0), candle(1, { low: 99, high: 100.4 }), candle(2, { low: 99.2, high: 102.2 })],
		[band(), band(), band()], signal(), 'standard', { ...geometry, stopSteps: 2 },
	)
	assert.equal(trade?.addFilled, true)
	assert.equal(trade?.averageEntry, 99.5)
	assert.equal(trade?.grossR, 5 / 3)
	assert.ok(trade?.events.some((event) => event.type === 'add'))
})

it('keeps the correct blended basis when a 25% Partial happens before the add', () => {
	const trade = replayArrowTrade(
		[
			candle(0),
			candle(1, { low: 100.2, high: 101.2 }), // Partial: sell 0.25 of the entry lot at 101
			candle(2, { low: 99, high: 100.2 }), // then add one full lot at 99
			candle(3, { low: 98, high: 100 }), // stop the remaining 1.75 lots
		],
		[band(), band({ mean: 101 }), band({ mean: 101 }), band({ mean: 101 })],
		signal(), 'safe', { ...geometry, stopSteps: 2, partialFraction: 0.25 },
	)!
	assert.equal(trade.outcome, 'partial-stop')
	assert.equal(trade.addFilled, true)
	assert.equal(trade.averageEntry, (100 * 0.75 + 99) / 1.75)
	// Manual cash ledger: +0.25 at Partial, then losses of 1.50 on the
	// remaining entry lot and 1.00 on the add; 1R = 3.
	assert.ok(Math.abs(trade.grossR - (-2.25 / 3)) < 1e-12)
})

it('covers add-filled stop and Standard no-add TP/stop R arithmetic', () => {
	// Under the replay's level-fill OHLC model a stop wick beyond add must fill
	// add first; therefore a Safe/Risk "no-add stop" cannot be represented.
	const safeAddStop = replayArrowTrade(
		[candle(0), candle(1, { low: 98, high: 100.2 })], [band(), band({ mean: 105 })], signal(), 'safe',
		{ ...geometry, stopSteps: 2 },
	)!
	assert.equal(safeAddStop.events[1]?.type, 'add')
	assert.equal(safeAddStop.grossR, -1)

	const standardNoAddTp = replayArrowTrade(
		[candle(0), candle(1, { low: 99.5, high: 102 })], [band(), band()], signal(), 'standard',
		{ ...geometry, stopSteps: 1.75 },
	)!
	assert.equal(standardNoAddTp.grossR, 0.8)
	const standardAddStop = replayArrowTrade(
		[candle(0), candle(1, { low: 98.25, high: 100.2 })], [band(), band()], signal(), 'standard',
		{ ...geometry, stopSteps: 1.75 },
	)!
	assert.equal(standardAddStop.grossR, -1)
})

it('classifies timeout and open at the edge of loaded data', () => {
	const timeout = replayArrowTrade(
		[candle(0), candle(1), candle(2, { close: 100.5 }), candle(3)],
		[band(), band(), band(), band()], signal(), 'standard', { ...geometry, maxHoldingBars: 2 },
	)
	assert.equal(timeout?.outcome, 'timeout')
	assert.equal(timeout?.exitIndex, 2)

	const open = replayArrowTrade(
		[candle(0), candle(1)], [band(), band()], signal(), 'standard', { ...geometry, maxHoldingBars: 20 },
	)
	assert.equal(open?.outcome, 'open')
	assert.equal(open?.exitIndex, null)
})

it('blocks new signals while a trade and its post-exit gate occupy the mode slot', () => {
	const candles = Array.from({ length: 8 }, (_, index) => candle(index, index === 1 || index === 7 ? { high: 102.2 } : {}))
	const result = replayArrowSignals(candles, candles.map(() => band()), [signal(0), signal(2), signal(6)], 'standard', { ...geometry, postExitBars: 3 })
	assert.deepEqual(result.signals.map((x) => x.signalIndex), [0, 6])
	assert.equal(result.trades.length, 2)
})

it('uses mutually-exclusive finalized taxonomy and excludes open/timeout from vendor WR', () => {
	const full = replayArrowTrade([candle(0), candle(1, { high: 102.2 })], [band(), band()], signal(), 'standard', geometry)!
	const stop = replayArrowTrade([candle(0), candle(1, { low: 99 })], [band(), band()], signal(), 'standard', geometry)!
	const partial = replayArrowTrade(
		[candle(0), candle(1, { high: 101.2 }), candle(2, { low: 98 })],
		[band(), band({ mean: 101 }), band({ mean: 101 })], signal(), 'safe', geometry,
	)!
	const open = replayArrowTrade([candle(0), candle(1)], [band(), band()], signal(), 'standard', geometry)!
	const timeout = replayArrowTrade(
		[candle(0), candle(1), candle(2), candle(3)], [band(), band(), band(), band()], signal(), 'standard', { ...geometry, maxHoldingBars: 2 },
	)!
	const summary = summarizeArrowTrades([full, stop, partial, open, timeout])
	assert.deepEqual({ full: summary.fullTp, partial: summary.partial, stop: summary.stop, open: summary.open, timeout: summary.timeout }, { full: 1, partial: 1, stop: 1, open: 1, timeout: 1 })
	assert.equal(summary.vendorStyleWinrate, 2 / 3)
	assert.equal(summarizeArrowTrades([open, timeout]).vendorStyleWinrate, 0)
})

it('summarizes outcomes with and without costs from the same canonical trades', () => {
	const trades = [
		replayArrowTrade([candle(0), candle(1, { high: 102.2 })], [band(), band()], signal(), 'standard', { ...geometry, oneWayCostBps: 10 }),
		replayArrowTrade([candle(0), candle(1, { low: 99 })], [band(), band()], signal(), 'standard', { ...geometry, oneWayCostBps: 10 }),
	].filter((x): x is NonNullable<typeof x> => x != null)
	const net = summarizeArrowTrades(trades, true)
	const gross = summarizeArrowTrades(trades, false)
	assert.equal(net.signals, 2)
	assert.equal(net.fullTp, 1)
	assert.equal(net.stop, 1)
	assert.ok(net.totalNetR < gross.totalNetR)
	// Vendor-style winrate counts unique signals with any TP touch (no double-counting)
	const expectedVendorWins = trades.filter((t) => t.partialTaken || t.outcome === 'full-tp').length
	assert.equal(net.vendorStyleWinrate, expectedVendorWins / net.signals)
	assert.equal(gross.vendorStyleWinrate, net.vendorStyleWinrate) // outcome counts are identical regardless of cost mode
})
