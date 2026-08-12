import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { mulberry32, surrogateSignals, volumeSma, COOLDOWN } from '../ci/research/runSur1SurrogateSignal.js'

const mk = (i: number, o: number, h: number, l: number, c: number, vol = 100, mean = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: vol,
	mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30,
	buy: false, sell: false,
})

it('sur1: volumeSma считает скользящее среднее объёма', () => {
	const rows = Array.from({ length: 60 }, (_, i) => mk(i, 100, 101, 99, 100, i < 50 ? 100 : 200))
	const sma = volumeSma(rows, 50)
	assert.equal(sma[48], null)
	assert.equal(sma[49], 100)
	assert.ok(Math.abs(sma[59]! - (40 * 100 + 10 * 200) / 50) < 1e-9)
})

it('sur1: S1 wick-outer + volume-k + cooldown порождает сигнал и блокирует повтор', () => {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 150; i++) rows.push(mk(i, 100, 101, 99, 100, 100))
	// бар 120: фитиль ниже lowerOuter(70) с объёмом 3x
	rows[120] = mk(120, 100, 101, 69, 95, 300)
	// бар 130: то же самое - внутри cooldown 40, должен быть отфильтрован
	rows[130] = mk(130, 100, 101, 69, 95, 300)
	const sigs = surrogateSignals(rows, volumeSma(rows, 50), 'S1_wick_outer', 1.75)
	assert.equal(sigs.length, 1)
	assert.equal(sigs[0]!.idx, 120)
	assert.equal(sigs[0]!.side, 1)
	assert.ok(COOLDOWN === 40)
})

it('sur1: SELL зеркален (S2 close-outer), объём ниже порога отфильтрован', () => {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 150; i++) rows.push(mk(i, 100, 101, 99, 100, 100))
	rows[120] = mk(120, 100, 132, 99, 131, 300) // close 131 >= upperOuter 130 -> SELL
	rows[125] = mk(125, 100, 132, 99, 131, 110) // объём 110 < 1.75*~102 -> нет сигнала
	const sigs = surrogateSignals(rows, volumeSma(rows, 50), 'S2_close_outer', 1.75)
	assert.equal(sigs.length, 1)
	assert.equal(sigs[0]!.side, -1)
})

it('sur1: mulberry32 детерминирован', () => {
	const a = mulberry32(1337)
	const b = mulberry32(1337)
	for (let i = 0; i < 5; i++) assert.equal(a(), b())
})
