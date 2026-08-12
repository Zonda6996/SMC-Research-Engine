import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { detectIndependentReversalG2Candidates } from '../src/core/signals/IndependentReversalG2.js'

function row(index: number, partial: Partial<ExactIndicatorRow> = {}): ExactIndicatorRow {
	return {
		timestamp: index * 3_600_000,
		open: 100,
		high: 101,
		low: 99,
		close: 100,
		volume: 100,
		mean: 100,
		upperInner: 103,
		upperOuter: 106,
		lowerInner: 97,
		lowerOuter: 94,
		buy: false,
		sell: false,
		...partial,
	}
}

it('G2 extension detector uses prior volume only and is future-append invariant', () => {
	const rows = Array.from({ length: 260 }, (_, index) => row(index))
	rows[230] = row(230, { open: 96, close: 96.5, low: 95.5, high: 97, volume: 200 })
	const prefix = detectIndependentReversalG2Candidates(rows.slice(0, 240))
	const full = detectIndependentReversalG2Candidates(rows)
	assert.ok(prefix.some((candidate) => candidate.index === 230 && candidate.side === 1 && candidate.source === 'EXT'))
	assert.deepEqual(full.filter((candidate) => candidate.index < 240), prefix)
})

it('G2 does not emit extension without displacement and volume confirmation', () => {
	const rows = Array.from({ length: 240 }, (_, index) => row(index))
	rows[230] = row(230, { open: 99, close: 98.5, volume: 120 })
	assert.equal(detectIndependentReversalG2Candidates(rows).filter((candidate) => candidate.source === 'EXT').length, 0)
})

it('G2 keeps EXT and OWN1 as independent frozen timing controls', () => {
	const rows = Array.from({ length: 280 }, (_, index) => row(index, { close: 100.1 }))
	for (let index = 210; index < 230; index++) rows[index] = row(index, { open: 98, close: 98.1, low: 97.5, high: 98.5 })
	rows[230] = row(230, { open: 96, close: 96.5, low: 95, high: 97, volume: 200 })
	const candidates = detectIndependentReversalG2Candidates(rows)
	assert.ok(candidates.some((candidate) => candidate.index === 230 && candidate.source === 'EXT'))
	assert.ok(candidates.some((candidate) => candidate.index === 230 && candidate.source === 'OWN1'))
})
