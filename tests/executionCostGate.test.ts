import assert from 'node:assert/strict'
import { it } from 'node:test'
import { plannedFullStop } from '../tools/shared/executionCostGate.js'

it('execution cost gate reproduces the BTC $20 stop catastrophe', () => {
	const x = plannedFullStop(63_989.0916, 63_968.8308)
	assert.ok(Math.abs(x.stopPct - 0.03166) < 0.001)
	assert.ok(Math.abs(x.netR - (-3.842)) < 0.01)
	assert.ok(x.costR > 2.8)
})

it('reaction market entry has higher planned cost than resting maker entry', () => {
	const maker = plannedFullStop(100, 99.8)
	const market = plannedFullStop(100, 99.8, 0.0007)
	assert.ok(market.netR < maker.netR)
})

it('execution cost gate is scale-invariant for equal percentage stops', () => {
	const a = plannedFullStop(100, 99.8)
	const b = plannedFullStop(10_000, 9_980)
	assert.ok(Math.abs(a.netR - b.netR) < 1e-12)
	assert.ok(Math.abs(a.stopPct - b.stopPct) < 1e-12)
})
