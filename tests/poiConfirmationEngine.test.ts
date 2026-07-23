import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectPoiConfirmation, POI_CONFIRMATION_VERSION } from '../src/core/confirmation/PoiConfirmationEngine.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { LiquidityPoiCandidate } from '../src/core/confirmation/LiquidityPoiCalibration.js'

function makePoi(overrides: Partial<LiquidityPoiCandidate> = {}): LiquidityPoiCandidate {
	return {
		id: 'poi-test', version: 'test', direction: 'long', zoneClass: 'protected-structure',
		anchorId: 'a', componentAnchorIds: ['a'], componentClasses: ['protected-structure'],
		originAt: 0, knownAt: 0, near: 100, far: 90, atr: 1, boundarySource: 'atr-calibration',
		liquidityBands: [], pivotCount: 1, pivotPrices: [100], pivotTimes: [0], eventType: null,
		pdZone: 'none', pdAligned: null, lifecycleState: 'fresh', valid: true, active: true,
		priority: 'nearest', interaction: 'untouched', touchCount: 0, armedAt: 0, firstTouchAt: null,
		consumedAt: null, failedAt: null, retiredAt: null, geometryKnownAt: 0, lineageSupersededAt: null,
		supersededAt: null, invalidatedAt: null, endAt: 1000, mergedCount: 0, suppressedCount: 0,
		...overrides,
	}
}

// Bearish touch into the [90,100] zone followed by a bullish stopping bar, a rebound,
// a second sweep, protection, a low-volume test, a bullish entry bar, and a rally to TP2.
const fullLongSequence = (offset = 0): Candle[] => [
	{ timestamp: offset + 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
	{ timestamp: offset + 8, open: 96, high: 97, low: 90, close: 91, volume: 10 },
	{ timestamp: offset + 9, open: 91, high: 95, low: 90.5, close: 94, volume: 10 },
	{ timestamp: offset + 10, open: 94, high: 98, low: 93.5, close: 97, volume: 10 },
	{ timestamp: offset + 11, open: 97, high: 99, low: 96, close: 98, volume: 10 },
	{ timestamp: offset + 12, open: 98, high: 99, low: 97, close: 97.5, volume: 10 },
	{ timestamp: offset + 13, open: 97.5, high: 98, low: 88, close: 89, volume: 10 },
	{ timestamp: offset + 14, open: 89, high: 93, low: 88.5, close: 92, volume: 10 },
	{ timestamp: offset + 15, open: 92, high: 97, low: 91, close: 96, volume: 20 },
	{ timestamp: offset + 16, open: 96, high: 96.5, low: 94, close: 95, volume: 5 },
	{ timestamp: offset + 17, open: 95, high: 99, low: 94.5, close: 98, volume: 15 },
	{ timestamp: offset + 18, open: 98, high: 105, low: 96, close: 104, volume: 10 },
	{ timestamp: offset + 19, open: 104, high: 112, low: 102, close: 110, volume: 10 },
	{ timestamp: offset + 20, open: 110, high: 122, low: 108, close: 119, volume: 10 },
	{ timestamp: offset + 21, open: 119, high: 120, low: 118, close: 119.5, volume: 10 },
	{ timestamp: offset + 22, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
	{ timestamp: offset + 23, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
	{ timestamp: offset + 24, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
]

const baseline = (n: number, start: number, price: number): Candle[] =>
	Array.from({ length: n }, (_, k) => ({ timestamp: start + k, open: price, high: price + 1, low: price - 1, close: price - 0.5, volume: 10 }))

it('POI confirmation engine has a frozen version and returns empty for empty input', () => {
	assert.equal(POI_CONFIRMATION_VERSION, 'poi-confirmation-1.2-armed-touch')
	assert.deepEqual(detectPoiConfirmation([], []), [])
})

it('full LONG sequence: touch -> stopping -> rebound -> second sweep -> protected -> low-volume test -> entry -> TP2', () => {
	const ltf: Candle[] = [...baseline(7, 0, 150), ...fullLongSequence(0)]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.rejectionReason, null)
	assert.equal(attempt.outcome, 'tp')
	assert.equal(attempt.grossR, 2)
	assert.deepEqual(attempt.trace.map(t => t.state), ['POI_TOUCH', 'STOP_CONFIRMED', 'REBOUND', 'SECOND_SWEEP', 'PROTECTED', 'LOW_VOLUME_TEST', 'ENTRY', 'TP2'])
})

it('spec 14.5: a failed attempt does not destroy the POI - a later re-touch can still enter', () => {
	// First touch (idx7) is followed by 30 non-bullish bars away from the zone -> "no-stopping"
	// rejection. The scan then resumes and finds a fresh touch later, which runs the exact same
	// full successful sequence as the standalone test above.
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		...baseline(30, 8, 245),
		...fullLongSequence(31),
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 2)
	const [first, second] = result!.attempts
	assert.equal(first!.status, 'rejected')
	assert.equal(first!.rejectionReason, 'no-stopping')
	assert.equal(second!.status, 'entered')
	assert.equal(second!.outcome, 'tp')
})

it('confirmation is bounded to [knownAt, endAt): no attempts once the POI window has already ended', () => {
	const ltf: Candle[] = [...baseline(7, 0, 150), ...fullLongSequence(0)]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 3 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 0)
	assert.equal(result!.knownAt, 0)
	assert.equal(result!.endAt, 3)
})
