import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAndAuditOwn2Csv } from '../ci/research/runOwn2FundingSignBtcEthSolHoldout.js'

const header = 'time,open,high,low,close,GGI Mean,GGI Upper Outer,GGI Upper Inner,GGI Lower Inner,GGI Lower Outer,Shapes,Shapes,Volume'

test('holdout OHLCV parser ignores vendor values and audits a clean hourly sequence', () => {
	const rows = parseAndAuditOwn2Csv(`${header}\n1704067200,100,110,90,105,999,999,999,999,999,1,0,10\n1704070800,105,112,100,108,-999,-999,-999,-999,-999,0,1,20`)
	assert.deepEqual(rows.candles, [
		{ timestamp: 1_704_067_200_000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
		{ timestamp: 1_704_070_800_000, open: 105, high: 112, low: 100, close: 108, volume: 20 },
	])
	assert.equal(rows.audit.missingHourlyBars, 0)
	assert.equal(rows.audit.ohlcInvalid, 0)
	assert.equal(rows.audit.volumeInvalid, 0)
})

test('holdout OHLCV audit exposes gaps and invalid price/volume without consuming vendor columns', () => {
	const rows = parseAndAuditOwn2Csv(`${header}\n1704067200,100,110,90,105,NaN,NaN,NaN,NaN,NaN,1,0,10\n1704074400,105,104,106,108,NaN,NaN,NaN,NaN,NaN,0,1,-1`)
	assert.equal(rows.audit.missingHourlyBars, 1)
	assert.equal(rows.audit.irregularIntervals, 1)
	assert.equal(rows.audit.ohlcInvalid, 1)
	assert.equal(rows.audit.volumeInvalid, 1)
})
