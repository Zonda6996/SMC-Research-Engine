import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadExactDatasets } from '../ci/research/lib/exactIndicatorExport.js'
import { computeApexBands } from '../src/core/signals/ApexEngine.js'

function widthMae(rows: ReturnType<typeof loadExactDatasets>[number]['rows'], devSigma: number): number {
	const bands = computeApexBands(rows, { devSigma })
	let absoluteError = 0
	let count = 0
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!, band = bands[i]!
		if (!Number.isFinite(band.mean) || !Number.isFinite(band.s)) continue
		const target = (Math.log(row.upperInner / row.mean) + Math.log(row.mean / row.lowerInner)) / 11.2
		absoluteError += Math.abs(band.s / target - 1)
		count++
	}
	return absoluteError / count
}

it('Apex: sigma=4 beats 3.5 on every exact OOS dataset', () => {
	const holdouts = loadExactDatasets().filter((dataset) => dataset.meta.role !== 'development')
	assert.deepEqual(holdouts.map((dataset) => dataset.meta.id), ['eth-perp-15m', 'sol-spot-15m', 'btc-perp-5m', 'btc-perp-4h'])
	for (const dataset of holdouts) {
		const oldMae = widthMae(dataset.rows, 3.5)
		const newMae = widthMae(dataset.rows, 4)
		assert.ok(newMae < oldMae, `${dataset.meta.id}: sigma=4 ${newMae} must beat sigma=3.5 ${oldMae}`)
	}
})
