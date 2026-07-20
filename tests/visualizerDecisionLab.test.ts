import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { buildReactionCandidates } from '../tools/visualizer/server.js'
import { runAnalysis } from '../src/core/analysis/runAnalysis.js'

it('Decision Lab falls back to HTF when LTF history starts after setup', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 200, high: 250, low: 190, close: 240, volume: 1 }, // реальный first touch 141=241
		{ timestamp: 1_800_000, open: 240, high: 300, low: 230, close: 280, volume: 1 },
	]
	const ltfTooLate: Candle[] = [
		{ timestamp: 1_800_000, open: 240, high: 300, low: 230, close: 280, volume: 1 },
	]
	const variant = {
		start: { index: 0, timestamp: 0, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 0 },
		levels: [{ ratio: 0, price: 100, kind: 'anchor' }, { ratio: 100, price: 200, kind: 'anchor' }],
		legSize: 100,
		legAtrRatio: 5,
	}
	const snapshot = {
		candles,
		fib: { candidates: [{
			id: 'grid-1', eventId: 'event-1', trigger: 'bos', direction: 'long',
			end: { index: 0, timestamp: 0, price: 200, type: 'high', label: 'HH', knownAtIndex: 0 },
			variants: { local: variant, global: null }, createdAtIndex: 0,
			oppositeSweptBefore: false, explanation: '',
		}] },
	} as unknown as ReturnType<typeof runAnalysis>

	const result = buildReactionCandidates(snapshot, ltfTooLate, [], 900_000)
	const level141 = result.find((x) => x.ratio === 141)
	assert.ok(level141)
	assert.equal(level141.touchAt, 900_000)
	assert.equal(level141.touchHtfIndex, 1)
	assert.equal(level141.touchLtfIndex, null)
	assert.equal(level141.resolution, 'htf')
	assert.equal(level141.ageBars, 1)
})

it('Decision Lab excludes a grid expired by an opposite confirmed structure before touch', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 195, high: 210, low: 190, close: 205, volume: 1 },
		{ timestamp: 1_800_000, open: 205, high: 250, low: 200, close: 240, volume: 1 },
	]
	const variant = {
		start: { index: 0, timestamp: 0, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 0 },
		levels: [{ ratio: 0, price: 100, kind: 'anchor' }, { ratio: 100, price: 200, kind: 'anchor' }],
		legSize: 100, legAtrRatio: 5,
	}
	const snapshot = {
		candles,
		events: [{ direction: 'down', confirmIndex: 1 }],
		fib: { candidates: [{
			id: 'old-grid', eventId: 'event-1', trigger: 'bos', direction: 'long',
			end: { index: 0, timestamp: 0, price: 200, type: 'high', label: 'HH', knownAtIndex: 0 },
			variants: { local: variant, global: null }, createdAtIndex: 0,
			oppositeSweptBefore: false, explanation: '',
		}] },
	} as unknown as ReturnType<typeof runAnalysis>

	const result = buildReactionCandidates(snapshot, null, [], 900_000)
	assert.equal(result.some((x) => x.candidateId === 'old-grid'), false)
})

it('Decision Lab excludes an old same-direction grid superseded before its touch', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 195, high: 215, low: 190, close: 210, volume: 1 },
		{ timestamp: 1_800_000, open: 210, high: 250, low: 205, close: 240, volume: 1 },
	]
	const makeVariant = (start: number, end: number) => ({
		start: { index: 0, timestamp: 0, price: start, type: 'low', label: 'UNKNOWN', knownAtIndex: 0 },
		levels: [{ ratio: 0, price: start, kind: 'anchor' }, { ratio: 100, price: end, kind: 'anchor' }],
		legSize: end - start, legAtrRatio: 5,
	})
	const makeCandidate = (id: string, createdAtIndex: number, variant: ReturnType<typeof makeVariant>) => ({
		id, eventId: `event-${id}`, trigger: 'bos', direction: 'long',
		end: { index: createdAtIndex, timestamp: candles[createdAtIndex]!.timestamp, price: 200, type: 'high', label: 'HH', knownAtIndex: createdAtIndex },
		variants: { local: variant, global: null }, createdAtIndex,
		oppositeSweptBefore: false, explanation: '',
	})
	const snapshot = {
		candles, events: [],
		fib: { candidates: [
			makeCandidate('old-grid', 0, makeVariant(100, 200)),
			makeCandidate('new-grid', 1, makeVariant(150, 200)),
		] },
	} as unknown as ReturnType<typeof runAnalysis>

	const result = buildReactionCandidates(snapshot, null, [], 900_000)
	assert.equal(result.some((x) => x.candidateId === 'old-grid'), false)
})

it('Decision Lab reaction id is stable when candle-window candidate ids change', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 200, high: 250, low: 190, close: 240, volume: 1 },
	]
	const makeSnapshot = (candidateId: string) => ({
		candles, events: [],
		fib: { candidates: [{
			id: candidateId, eventId: `event-${candidateId}`, trigger: 'bos', direction: 'long',
			end: { index: 0, timestamp: 0, price: 200, type: 'high', label: 'HH', knownAtIndex: 0 },
			variants: { local: {
				start: { index: 0, timestamp: 0, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 0 },
				levels: [{ ratio: 0, price: 100, kind: 'anchor' }, { ratio: 100, price: 200, kind: 'anchor' }],
				legSize: 100, legAtrRatio: 5,
			}, global: null }, createdAtIndex: 0, oppositeSweptBefore: false, explanation: '',
		}] },
	}) as unknown as ReturnType<typeof runAnalysis>

	const first = buildReactionCandidates(makeSnapshot('window-index-10'), null, [], 900_000, 'BTC/USDT|1h')
	const shifted = buildReactionCandidates(makeSnapshot('window-index-999'), null, [], 900_000, 'BTC/USDT|1h')
	assert.equal(first.find((x) => x.ratio === 141)?.id, shifted.find((x) => x.ratio === 141)?.id)
})

it('Decision Lab exact candidate requires the requested left replay history', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 195, high: 250, low: 190, close: 240, volume: 1 },
	]
	const ltf: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 195, high: 220, low: 190, close: 210, volume: 1 },
		{ timestamp: 1_200_000, open: 210, high: 250, low: 205, close: 240, volume: 1 },
	]
	const snapshot = {
		candles, events: [],
		fib: { candidates: [{
			id: 'grid', eventId: 'event', trigger: 'bos', direction: 'long',
			end: { index: 0, timestamp: 0, price: 200, type: 'high', label: 'HH', knownAtIndex: 0 },
			variants: { local: {
				start: { index: 0, timestamp: 0, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 0 },
				levels: [{ ratio: 0, price: 100, kind: 'anchor' }, { ratio: 100, price: 200, kind: 'anchor' }],
				legSize: 100, legAtrRatio: 5,
			}, global: null }, createdAtIndex: 0, oppositeSweptBefore: false, explanation: '',
		}] },
	} as unknown as ReturnType<typeof runAnalysis>

	const enough = buildReactionCandidates(snapshot, ltf, [], 900_000, 'BTC/USDT|1h', 2)
	const tooClose = buildReactionCandidates(snapshot, ltf, [], 900_000, 'BTC/USDT|1h', 3)
	assert.ok(enough.some((x) => x.ratio === 141))
	assert.equal(tooClose.some((x) => x.ratio === 141), false)
})
