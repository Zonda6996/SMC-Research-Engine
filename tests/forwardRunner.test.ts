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

describe('forward runner v2', () => {
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
			event({ type: 'signal', id: 's-open', orderId: 'open', stream: 'mirror', forwardEligible: true }),
		]
		const report = buildForwardReport(rows)
		assert.deepEqual(report.forwardOutcomes.map((e) => e.orderId), ['new'])
		assert.deepEqual(report.backfillOutcomes.map((e) => e.orderId), ['old'])
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

		// Mirror нельзя заполнить на OTE entry-баре: setup создаётся после
		// OTE fill и активен только со следующего бара.
		const signals = new Map(first.filter((e) => e.type === 'signal').map((e) => [e.orderId, e]))
		const mirrorSignals = first.filter((e) => e.type === 'signal' && e.stream === 'mirror')
		assert.ok(mirrorSignals.length > 0)
		for (const mirror of mirrorSignals) {
			const parent = signals.get(mirror.orderId.replace(/\|mirror$/, ''))
			assert.ok(parent)
			assert.ok(Date.parse(mirror.at) > Date.parse(parent.at))
		}
	})
})
