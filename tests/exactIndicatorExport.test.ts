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

it('exact exports: parser accepts ISO offsets, duplicate Shapes and trailing Volume', () => {
	const header = 'time,open,high,low,close,GGI Mean,GGI Upper Outer,GGI Upper Inner,GGI Lower Inner,GGI Lower Outer,Shapes,Shapes,Volume'
	const rows = parseExactIndicatorCsv(
		`${header}\n2026-08-02T19:00:00+05:00,100,105,95,102,100,120,110,90,80,1,0,1234\n2026-08-02T20:00:00+05:00,102,106,96,101,100,120,110,90,80,0,1,2345`,
		3_600_000,
	)
	assert.equal(rows.length, 2)
	assert.equal(new Date(rows[0]!.timestamp).toISOString(), '2026-08-02T14:00:00.000Z')
	assert.equal(rows[0]!.buy, true)
	assert.equal(rows[1]!.sell, true)
	assert.equal(rows[1]!.volume, 2345)
})

it('exact exports: parser can preserve session gaps and startup-invalid bands when explicitly allowed', () => {
	const header = 'time,open,high,low,close,GGI Mean,GGI Upper Outer,GGI Upper Inner,GGI Lower Inner,GGI Lower Outer,Shapes,Shapes,Volume'
	const rows = parseExactIndicatorCsv(
		`${header}\n2026-08-01T01:59:00+05:00,1,2,0.5,1,1,0.2,0.4,2,3,0,0,10\n2026-08-03T03:00:00+05:00,1,2,0.5,1,1,3,2,0.5,0.2,0,0,10`,
		{ expectedTimeframeMs: 60_000, allowIrregularBars: true, allowInvalidBandOrder: true },
	)
	assert.equal(rows.length, 2)
})
