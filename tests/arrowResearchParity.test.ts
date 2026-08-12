import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ApexBand } from '../src/core/signals/ApexEngine.js'
import { detectArrowSignalsFromBands } from '../src/core/signals/ArrowSignalEngine.js'
import { own2Raw } from '../ci/research/runOwn2ExtensionTrigger.js'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'

const HOUR = 3_600_000
const rows: ExactIndicatorRow[] = Array.from({ length: 260 }, (_, index) => {
	const close = index === 220 ? 78 : 100
	return {
		timestamp: index * HOUR,
		open: close,
		high: close + 1,
		low: close - 1,
		close,
		volume: index === 220 ? 5_000 : 1_000,
		mean: 100,
		upperOuter: 110,
		upperInner: 106,
		lowerInner: 94,
		lowerOuter: 90,
		buy: false,
		sell: false,
	}
})
const bands: ApexBand[] = rows.map((row) => ({
	mean: row.mean,
	s: Math.abs(row.upperInner - row.mean) / row.mean,
	redLo: row.upperInner,
	redHi: row.upperOuter,
	greenHi: row.lowerInner,
	greenLo: row.lowerOuter,
}))

it('research own2Raw and production ArrowSignalEngine emit identical raw triggers', () => {
	const production = detectArrowSignalsFromBands(rows, bands).candidates.map((signal) => ({ idx: signal.signalIndex, side: signal.side === 'long' ? 1 : -1 }))
	assert.deepEqual(own2Raw(rows), production)
})
