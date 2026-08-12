import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectReversalEpisodes, type ReversalEpisodeConfig } from '../src/core/signals/ReversalEpisodeResearch.js'
import type { ReversalResearchRow } from '../src/core/signals/ReversalStateMachineResearch.js'

const row = (timestamp: number, close: number, open = close): ReversalResearchRow => ({ timestamp, open, high: close + 1, low: close - 1, close, volume: 1, mean: 100, upperInner: 105, lowerInner: 95 })
const config: ReversalEpisodeConfig = {
	armInner: true, armThreshold: 30, oscillator: 'rsi', smoothFast: 3, smoothSlow: 8,
	releaseThreshold: 35, confirm: 'price-recovery', minDwellBars: 2, maxEpisodeBars: 100,
	minRecoveryWidth: 0.3, rearm: 'mean', cooldownBars: 0,
}

it('Reversal episode: long-memory episode can confirm dozens of bars after first inner visit', () => {
	const rows = Array.from({ length: 30 }, (_, i) => row(i, 100 + Math.sin(i / 4)))
	rows.push(row(30, 94, 96))
	for (let i = 31; i < 55; i++) rows.push(row(i, 92 - (i - 31) * 0.05, 93))
	rows.push(row(55, 95, 92))
	const signals = detectReversalEpisodes(rows, config).filter((signal) => signal.index >= 30 && signal.direction === 'long')
	assert.equal(signals.length, 1)
	assert.ok(signals[0]!.episodeBars >= 20)
})

it('Reversal episode: appending future bars does not change earlier emissions', () => {
	const prefix = Array.from({ length: 80 }, (_, i) => row(i, 100 + 8 * Math.sin(i / 8), 100 + 8 * Math.sin((i - 1) / 8)))
	const before = detectReversalEpisodes(prefix, config)
	const after = detectReversalEpisodes([...prefix, ...Array.from({ length: 20 }, (_, i) => row(80 + i, 150 - i))], config).filter((signal) => signal.index < prefix.length)
	assert.deepEqual(after, before)
})
