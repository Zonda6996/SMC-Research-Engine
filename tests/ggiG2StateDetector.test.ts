import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { bodySma20 } from '../ci/research/runOwn1Generator.js'
import { g2Signals } from '../ci/research/runGgiG2StateDetectorV1.js'

const mk = (i: number, open: number, high: number, low: number, close: number, mean = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000,
	open, high, low, close, volume: 1,
	mean,
	upperOuter: mean + 30,
	upperInner: mean + 15,
	lowerInner: mean - 15,
	lowerOuter: mean - 30,
	buy: false,
	sell: false,
})

it('G2: BUY требует ослабление новых low, reversal candle и следующий failed-continuation bar', () => {
	const rows = Array.from({ length: 170 }, (_, i) => mk(i, 92, 92.4, 91.7, 92.1))
	rows[120] = mk(120, 92, 92.3, 90, 91.8)
	rows[125] = mk(125, 91.5, 91.8, 88, 89.8)
	rows[130] = mk(130, 89.2, 94.5, 87, 94.2)
	rows[131] = mk(131, 94.0, 96.5, 93.2, 95.5)
	const signals = g2Signals(rows, bodySma20(rows))
	assert.deepEqual(signals, [{ idx: 131, side: 1 }])
})

it('G2: новый adverse low на confirmation bar отменяет BUY', () => {
	const rows = Array.from({ length: 170 }, (_, i) => mk(i, 92, 92.4, 91.7, 92.1))
	rows[120] = mk(120, 92, 92.3, 90, 91.8)
	rows[125] = mk(125, 91.5, 91.8, 88, 89.8)
	rows[130] = mk(130, 89.2, 94.5, 87, 94.2)
	rows[131] = mk(131, 94.0, 96.5, 86.5, 95.5)
	assert.equal(g2Signals(rows, bodySma20(rows)).length, 0)
})

it('G2: confirmation BUY может проколоть low reversal candle, но не episode low', () => {
	const rows = Array.from({ length: 170 }, (_, i) => mk(i, 92, 92.4, 91.7, 92.1))
	rows[120] = mk(120, 92, 92.3, 90, 91.8)
	rows[125] = mk(125, 91.5, 91.8, 88, 89.8)
	rows[130] = mk(130, 89.2, 94.5, 87, 94.2)
	rows[131] = mk(131, 94.0, 96.5, 87.2, 95.5)
	assert.deepEqual(g2Signals(rows, bodySma20(rows)), [{ idx: 131, side: 1 }])
})

it('G2: SELL зеркален', () => {
	const rows = Array.from({ length: 170 }, (_, i) => mk(i, 108, 108.3, 107.6, 107.9))
	rows[120] = mk(120, 108, 110, 107.7, 108.2)
	rows[125] = mk(125, 109, 112, 108.5, 110.2)
	rows[130] = mk(130, 110.8, 113, 105.5, 105.8)
	rows[131] = mk(131, 106, 106.8, 103.5, 104.5)
	assert.deepEqual(g2Signals(rows, bodySma20(rows)), [{ idx: 131, side: -1 }])
})

it('G2: confirmation SELL может проколоть high reversal candle, но не episode high', () => {
	const rows = Array.from({ length: 170 }, (_, i) => mk(i, 108, 108.3, 107.6, 107.9))
	rows[120] = mk(120, 108, 110, 107.7, 108.2)
	rows[125] = mk(125, 109, 112, 108.5, 110.2)
	rows[130] = mk(130, 110.8, 113, 105.5, 105.8)
	rows[131] = mk(131, 106, 112.5, 103.5, 104.5)
	assert.deepEqual(g2Signals(rows, bodySma20(rows)), [{ idx: 131, side: -1 }])
})

it('G2: касание Mean сбрасывает episode и drought', () => {
	const rows = Array.from({ length: 170 }, (_, i) => mk(i, 92, 92.4, 91.7, 92.1))
	rows[125] = mk(125, 99, 101, 98, 99.5)
	rows[128] = mk(128, 92, 92.3, 90, 91.8)
	rows[129] = mk(129, 91.5, 91.8, 88, 89.8)
	rows[130] = mk(130, 89.2, 94.5, 87, 94.2)
	rows[131] = mk(131, 94.0, 96.5, 93.2, 95.5)
	assert.equal(g2Signals(rows, bodySma20(rows)).length, 0)
})
