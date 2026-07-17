import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import type { FibSetupOutcome } from '../src/models/fib/FibLifecycle.js'
import type { Candle } from '../src/models/price/Candle.js'
import {
	FORWARD_VERSION,
	buildCausalMedianByCandidate,
	buildForwardReport,
	createRunnerState,
	firstLtfTouch,
	migrateRunnerState,
	processWindow,
	type SignalEvent,
} from '../tools/forward/forwardRunner.js'

function outcome(candidateId: string, createdAtIndex: number, legAtrRatio: number, scenario: 'ote' | 'deep'): FibSetupOutcome {
	return { candidateId, createdAtIndex, legAtrRatio, scenario } as FibSetupOutcome
}

function event(partial: Partial<SignalEvent> & Pick<SignalEvent, 'type' | 'id' | 'orderId' | 'stream'>): SignalEvent {
	return {
		version: FORWARD_VERSION,
		at: '2026-01-01T00:00:00.000Z',
		observedAt: '2026-01-01T00:00:01.000Z',
		symbol: 'BTC/USDT', timeframe: '15m', direction: 'long',
		entry: 100, stop: 90, take: 110, riskMult: 1,
		...partial,
	}
}

describe('forward runner v4', () => {
	it('causal median uses each candidate once and excludes current candidate', () => {
		const medians = buildCausalMedianByCandidate([
			outcome('a', 10, 4, 'ote'),
			outcome('a', 10, 4, 'deep'), // та же сетка не должна попасть дважды
			outcome('b', 20, 8, 'ote'),
			outcome('c', 30, 6, 'ote'),
		])
		assert.equal(medians.get('a'), null)
		assert.equal(medians.get('b'), 4)
		assert.equal(medians.get('c'), 8) // median массива [4, 8] по принятой upper-middle конвенции
	})

	it('report separates honest forward from catch-up by fill eligibility, not outcome time', () => {
		const rows: SignalEvent[] = [
			event({ type: 'signal', id: 's-old', orderId: 'old', stream: 'ote', forwardEligible: false }),
			event({ type: 'outcome', id: 'o-old', orderId: 'old', stream: 'ote', forwardEligible: false, netR: 1, result: 'tp' }),
			event({ type: 'signal', id: 's-new', orderId: 'new', stream: 'deep', forwardEligible: true }),
			event({ type: 'outcome', id: 'o-new', orderId: 'new', stream: 'deep', forwardEligible: true, netR: -1, result: 'stop' }),
			event({ type: 'setup', id: 'setup-p', orderId: 'pending', stream: 'ote', forwardEligible: true }),
			event({ type: 'signal', id: 's-open', orderId: 'open', stream: 'deep', forwardEligible: true }),
			event({ type: 'signal', id: 's-shadow', orderId: 'shadow', stream: 'mirror', forwardEligible: true, shadow: true, riskMult: 0 }),
			event({ type: 'outcome', id: 'o-shadow', orderId: 'shadow', stream: 'mirror', forwardEligible: true, shadow: true, riskMult: 0, netR: 1, result: 'tp' }),
		]
		const report = buildForwardReport(rows)
		assert.deepEqual(report.forwardOutcomes.map((e) => e.orderId), ['new'])
		assert.deepEqual(report.backfillOutcomes.map((e) => e.orderId), ['old'])
		assert.deepEqual(report.shadowOutcomes.map((e) => e.orderId), ['shadow'])
		assert.deepEqual(report.pendingOrders.map((e) => e.orderId), ['pending'])
		assert.deepEqual(report.openTrades.map((e) => e.orderId), ['open'])
	})

	it('same stateless replay is idempotent and state has no mutable swingPool', () => {
		const candles = JSON.parse(readFileSync(new URL('./fixtures/btcusdt-15m-500.json', import.meta.url), 'utf8')) as Candle[]
		const state = createRunnerState(new Date('2100-01-01T00:00:00.000Z'))
		const written: SignalEvent[] = []
		const first = processWindow(state, 'BTC/USDT', '15m', candles, (e) => written.push(e), () => '2100-01-01T00:00:00.000Z')
		const emittedAfterFirst = state.emitted.length
		const second = processWindow(state, 'BTC/USDT', '15m', candles, (e) => written.push(e), () => '2100-01-01T00:01:00.000Z')
		assert.ok(first.length > 0)
		assert.equal(second.length, 0)
		assert.equal(state.emitted.length, emittedAfterFirst)
		assert.equal(written.length, first.length)
		assert.ok(!('swingPool' in state))

		assert.equal(first.some((e) => e.stream === 'mirror'), false)
	})

	it('version change starts a clean state without deleting the journal', () => {
		const now = new Date('2026-07-17T12:00:00.000Z')
		const result = migrateRunnerState({ version: 'old', firstRunAt: '2020-01-01T00:00:00.000Z', emitted: ['x'], orderEligible: {}, tradeEligible: {} }, now)
		assert.equal(result.migrated, true)
		assert.equal(result.state.version, FORWARD_VERSION)
		assert.equal(result.state.firstRunAt, now.toISOString())
		assert.deepEqual(result.state.emitted, [])
	})

	it('first-5 gate identifies only the first LTF touch as skipped', () => {
		const ltf: Candle[] = [
			{ timestamp: 0, open: 110, high: 111, low: 99, close: 100, volume: 1 },
			{ timestamp: 300_000, open: 100, high: 102, low: 98, close: 101, volume: 1 },
		]
		assert.deepEqual(firstLtfTouch(ltf, 0, 900_000, true, 100), { offset: 0, at: 0 })
		const later = firstLtfTouch([{ ...ltf[0]!, low: 101 }, ltf[1]!], 0, 900_000, true, 100)
		assert.deepEqual(later, { offset: 1, at: 300_000 })
	})
})
