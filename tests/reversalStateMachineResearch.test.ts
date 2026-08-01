import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectReversalStateMachine, type ReversalStateMachineConfig, type ReversalResearchRow } from '../src/core/signals/ReversalStateMachineResearch.js'

const config: ReversalStateMachineConfig = {
	armKind: 'inner',
	maxPendingBars: 3,
	confirmKind: 'directional',
	rearmKind: 'mean',
	cooldownBars: 0,
	neutralBars: 1,
}

const row = (timestamp: number, open: number, high: number, low: number, close: number): ReversalResearchRow => ({
	timestamp, open, high, low, close, volume: 1, mean: 100, upperInner: 105, lowerInner: 95,
})

it('Reversal state machine: touch arms, directional confirmation emits once, mean rearms', () => {
	const rows = [
		row(0, 100, 101, 99, 100),
		row(1, 96, 97, 94, 94.5),
		row(2, 94.5, 97, 94, 96),
		row(3, 96, 98, 94, 97),
		row(4, 97, 101, 97, 100.5),
		row(5, 100, 101, 94, 94.5),
		row(6, 94.5, 97, 94, 96),
	]
	const signals = detectReversalStateMachine(rows, config)
	assert.deepEqual(signals.filter((signal) => signal.direction === 'long').map((signal) => signal.at), [2, 6])
})

it('Reversal state machine: pending expires and future rows cannot change past signals', () => {
	const prefix = [
		row(0, 100, 101, 99, 100),
		row(1, 96, 97, 94, 94.5),
		row(2, 94, 96, 93, 93.5),
		row(3, 93, 95, 92, 92.5),
		row(4, 92, 94, 91, 91.5),
		row(5, 96, 98, 96, 97),
	]
	const before = detectReversalStateMachine(prefix, { ...config, maxPendingBars: 2 })
	assert.equal(before.length, 0)
	const extended = [...prefix, row(6, 97, 110, 90, 108), row(7, 108, 109, 100, 101)]
	const after = detectReversalStateMachine(extended, { ...config, maxPendingBars: 2 }).filter((signal) => signal.index < prefix.length)
	assert.deepEqual(after, before)
})
