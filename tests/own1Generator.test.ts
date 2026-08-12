import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { bodySma20, own1Signals, COOLDOWN } from '../ci/research/runOwn1Generator.js'

const mk = (i: number, o: number, h: number, l: number, c: number, mean = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1,
	mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30,
	buy: false, sell: false,
})

it('own1: bodySma20 усредняет тела', () => {
	const rows = Array.from({ length: 30 }, (_, i) => mk(i, 100, 101, 99, i < 25 ? 100.5 : 102))
	const sma = bodySma20(rows)
	assert.equal(sma[18], null)
	assert.ok(Math.abs(sma[19]! - 0.5) < 1e-9)
})

it('own1: BUY требует засуху от средней, разворотное закрытие ниже mean и крупное тело', () => {
	const rows: ExactIndicatorRow[] = []
	// бары НЕ касаются mean=100 (диапазон 90..95) - засуха накапливается; мелкие тела
	for (let i = 0; i < 140; i++) rows.push(mk(i, 92, 93, 91, 92.3))
	// бар 120: бычье закрытие ниже mean, тело 2.4 >= 2*SMA20(~0.3)
	rows[120] = mk(120, 91, 94.5, 90.5, 93.4)
	const sigs = own1Signals(rows, bodySma20(rows), 2.0, 20, 0, rows.length)
	assert.equal(sigs.length, 1)
	assert.equal(sigs[0]!.idx, 120)
	assert.equal(sigs[0]!.side, 1)
})

it('own1: касание средней сбрасывает засуху; cooldown блокирует повтор', () => {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 160; i++) rows.push(mk(i, 92, 93, 91, 92.3))
	rows[110] = mk(110, 99, 101, 98, 100.2) // касание mean=100 -> сброс засухи
	rows[115] = mk(115, 91, 94.5, 90.5, 93.4) // крупная бычья - но засуха всего 5 < 20
	rows[135] = mk(135, 91, 94.5, 90.5, 93.4) // засуха 25 >= 20 -> сигнал
	rows[150] = mk(150, 91, 94.5, 90.5, 93.4) // в пределах cooldown 40 -> нет
	const sigs = own1Signals(rows, bodySma20(rows), 2.0, 20, 0, rows.length)
	assert.equal(sigs.length, 1)
	assert.equal(sigs[0]!.idx, 135)
	assert.ok(COOLDOWN === 40)
})

it('own1: SELL зеркален', () => {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 140; i++) rows.push(mk(i, 108, 109, 107, 107.7))
	rows[120] = mk(120, 109, 109.5, 105.5, 106.6) // медвежье закрытие выше mean, крупное тело
	const sigs = own1Signals(rows, bodySma20(rows), 2.0, 20, 0, rows.length)
	assert.equal(sigs.length, 1)
	assert.equal(sigs[0]!.side, -1)
})
