import assert from 'node:assert/strict'
import { it } from 'node:test'
import { matchDirectionalEvents } from '../ci/research/lib/eventMetrics.js'

it('event metrics: one prediction cannot match multiple labels', () => {
	const truth = [{ at: 1_000, direction: 'long' as const }, { at: 2_000, direction: 'long' as const }]
	const predictions = [{ at: 1_500, direction: 'long' as const }]
	const result = matchDirectionalEvents(truth, predictions, 1_000, 1)
	assert.equal(result.tp, 1)
	assert.equal(result.fn, 1)
	assert.equal(result.fp, 0)
})

it('event metrics: direction is strict and tolerance is measured in bars', () => {
	const truth = [{ at: 10_000, direction: 'long' as const }]
	assert.equal(matchDirectionalEvents(truth, [{ at: 11_000, direction: 'short' }], 1_000, 1).tp, 0)
	assert.equal(matchDirectionalEvents(truth, [{ at: 11_000, direction: 'long' }], 1_000, 0).tp, 0)
	const tolerant = matchDirectionalEvents(truth, [{ at: 11_000, direction: 'long' }], 1_000, 1)
	assert.equal(tolerant.tp, 1)
	assert.equal(tolerant.matches[0]!.deltaBars, 1)
})
