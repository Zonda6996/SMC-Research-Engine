import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectReversalRecoveries, type ReversalRecoveryConfig } from '../src/core/signals/ReversalRecoveryResearch.js'
import type { ReversalResearchRow } from '../src/core/signals/ReversalStateMachineResearch.js'

const config: ReversalRecoveryConfig = { arm: 'inner', recoveryLevel: 0.75, minRecoveryDelta: 0.1, maxEpisodeBars: 128, globalCooldownBars: 50, requireDirectional: true, requireCloseInsideInner: true }
const row = (timestamp: number, open: number, close: number, low = Math.min(open, close) - 1, high = Math.max(open, close) + 1): ReversalResearchRow => ({ timestamp, open, high, low, close, volume: 1, mean: 100, upperOuter: 115, upperInner: 110, lowerInner: 90, lowerOuter: 85 })

it('Reversal recovery: emits on recovery-level crossing after an earlier inner visit', () => {
	const rows = [row(0, 100, 100), row(1, 91, 88, 87), row(2, 88, 90), row(3, 90, 91), row(4, 91, 93)]
	const signals = detectReversalRecoveries(rows, config)
	assert.equal(signals.length, 1)
	assert.equal(signals[0]!.direction, 'long')
	assert.equal(signals[0]!.at, 4)
})

it('Reversal recovery: global cooldown suppresses nearby opposite emissions and future bars do not repaint', () => {
	const prefix = [row(0, 100, 100), row(1, 91, 88, 87), row(2, 88, 93), row(3, 109, 112, 111, 113), row(4, 112, 107)]
	const before = detectReversalRecoveries(prefix, config)
	assert.equal(before.length, 1)
	const after = detectReversalRecoveries([...prefix, row(5, 107, 106), row(6, 106, 105)], config).filter((signal) => signal.index < prefix.length)
	assert.deepEqual(after, before)
})
