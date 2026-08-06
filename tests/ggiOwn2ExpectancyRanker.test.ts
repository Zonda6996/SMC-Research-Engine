import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { bodySma20 } from '../ci/research/runOwn1Generator.js'
import { own2Candidates } from '../ci/research/runGgiOwn2ExpectancyRankerV1.js'

const mk = (i: number, o: number, h: number, l: number, c: number, mean = 100): ExactIndicatorRow => ({ timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1, mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30, buy: false, sell: false })

it('own2: candidate extraction is causal and mirrors BUY/SELL anatomy', () => {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 140; i++) rows.push(mk(i, 92, 93, 91, 92.3))
	rows[120] = mk(120, 91, 94.5, 90.5, 93.4)
	const c = own2Candidates(rows, Array(rows.length).fill(1), bodySma20(rows))
	assert.ok(c.some((x) => x.idx === 120 && x.side === 1))
	const prefix = own2Candidates(rows.slice(0, 121), Array(121).fill(1), bodySma20(rows.slice(0, 121)))
	assert.deepEqual(prefix.map((x) => [x.idx, x.side]), c.filter((x) => x.idx < 120).map((x) => [x.idx, x.side]))
})

it('own2: neutral candles do not create candidates', () => {
	const rows = Array.from({ length: 140 }, (_, i) => mk(i, 92, 93, 91, 92))
	assert.equal(own2Candidates(rows, Array(rows.length).fill(1), bodySma20(rows)).length, 0)
})
