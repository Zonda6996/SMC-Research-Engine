import assert from 'node:assert/strict'
import { it } from 'node:test'
import { exactEvents, loadExactDatasets, parseExactIndicatorCsv } from '../ci/research/lib/exactIndicatorExport.js'

it('exact exports: manifest, hashes, counts and timestamps validate', () => {
	const datasets = loadExactDatasets()
	assert.equal(datasets.length, 6)
	assert.equal(datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0), 86_420)
	assert.equal(datasets.reduce((sum, dataset) => sum + exactEvents(dataset.rows).length, 0), 370)
	assert.equal(datasets.filter((dataset) => dataset.meta.market === 'spot').length, 1)
	assert.deepEqual(datasets.map((dataset) => dataset.meta.id), [
		'btc-perp-15m', 'btc-perp-1h', 'eth-perp-15m', 'sol-spot-15m', 'btc-perp-5m', 'btc-perp-4h',
	])
})

it('exact exports: parser rejects irregular chronology and invalid labels', () => {
	const header = 'time,open,high,low,close,GGI Mean,GGI Upper Outer,GGI Upper Inner,GGI Lower Inner,GGI Lower Outer,Shapes,Shapes'
	assert.throws(() => parseExactIndicatorCsv(`${header}\n1,1,2,0,1,1,3,2,0,-1,0,0\n3,1,2,0,1,1,3,2,0,-1,0,0`, 1_000), /irregular bar/)
	assert.throws(() => parseExactIndicatorCsv(`${header}\n1,1,2,0,1,1,3,2,0,-1,2,0`), /Invalid Shape0\/BUY label/)
})
