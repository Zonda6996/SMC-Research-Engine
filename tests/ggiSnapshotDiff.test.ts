import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { compareGgiSnapshots } from '../ci/research/compareGgiExportSnapshots.js'

function row(index: number, partial: Partial<ExactIndicatorRow> = {}): ExactIndicatorRow {
	return {
		timestamp: index * 60_000,
		open: 100,
		high: 101,
		low: 99,
		close: 100,
		volume: 1,
		mean: 100,
		upperOuter: 110,
		upperInner: 105,
		lowerInner: 95,
		lowerOuter: 90,
		buy: false,
		sell: false,
		...partial,
	}
}

it('GGI snapshot diff ignores changes on the newest open bar', () => {
	const older = Array.from({ length: 10 }, (_, index) => row(index))
	const newer = older.map((item) => ({ ...item }))
	newer[9] = row(9, { high: 104, close: 103, buy: true })
	const result = compareGgiSnapshots(older, newer, 60_000, 1)
	assert.equal(result.recentChanges, 1)
	assert.equal(result.historicalChanges, 0)
	assert.equal(result.verdict, 'no-historical-change-detected-in-this-pair')
})

it('GGI snapshot diff detects a historical Shape repaint', () => {
	const older = Array.from({ length: 10 }, (_, index) => row(index))
	const newer = older.map((item) => ({ ...item }))
	newer[3] = row(3, { buy: true })
	const result = compareGgiSnapshots(older, newer, 60_000, 1)
	assert.equal(result.historicalShapeChanges, 1)
	assert.equal(result.verdict, 'historical-shape-repaint-detected')
})

it('GGI snapshot diff distinguishes historical band recalculation', () => {
	const older = Array.from({ length: 10 }, (_, index) => row(index))
	const newer = older.map((item) => ({ ...item }))
	newer[5] = row(5, { mean: 100.25, upperInner: 105.25 })
	const result = compareGgiSnapshots(older, newer, 60_000, 1)
	assert.equal(result.historicalShapeChanges, 0)
	assert.equal(result.historicalBandChanges, 1)
	assert.equal(result.verdict, 'historical-band-recalculation-detected')
})
