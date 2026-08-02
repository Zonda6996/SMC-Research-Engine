import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { computeAtr } from '../ci/research/runO1LabelOutcomes.js'
import { simulateE2Trade } from '../ci/research/runE2BandTrail.js'

const mk = (i: number, o: number, h: number, l: number, c: number, mean = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1,
	mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30,
	buy: false, sell: false,
})

function mkSeries(path: Array<[number, number, number, number, number?]>): { rows: ExactIndicatorRow[]; entryIdx: number } {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 30; i++) rows.push(mk(i, 100, 102, 98, 100))
	const entryIdx = 29
	let i = 30
	for (const [o, h, l, c, m] of path) rows.push(mk(i++, o, h, l, c, m))
	while (rows.length < entryIdx + 60) {
		const prev = rows[rows.length - 1]!
		rows.push(mk(i++, prev.close, prev.close + 1, prev.close - 1, prev.close, prev.mean))
	}
	return { rows, entryIdx }
}

it('e2: band_trail long — трейл включается после +1R и выходит на пересечении mean ПРЕДЫДУЩЕГО бара', () => {
	// entry 100, R=4 -> arm на 104; рост со сдвигом mean вверх, затем пробой mean вниз
	const { rows, entryIdx } = mkSeries([
		[100, 105, 99.5, 104.5, 101], // fav 1.25R -> trail armed; low 99.5 > prior mean? prior mean=100, low<100? нет: 99.5<100 -> но trail ещё не armed на этом баре? armed в шаге 3 ЭТОГО бара, проверка cross в шаге 4 того же бара: low 99.5 < prior mean 100 -> выход
	])
	const atr = computeAtr(rows)
	const t = simulateE2Trade(rows, atr, entryIdx, 'long', 'band_trail')!
	// в этом сценарии armed и cross в одном баре -> выход по close 104.5 => ~+1.125R
	assert.equal(t.exit, 'target')
	assert.ok(Math.abs(t.realizedR - 4.5 / 4) < 1e-9, `got ${t.realizedR}`)
})

it('e2: band_trail не выходит пока mean не пробит, wide_hold держит до 192/конца', () => {
	// чистый тренд вверх, mean поднимается ниже low — трейл не срабатывает до конца
	const path: Array<[number, number, number, number, number]> = []
	for (let k = 0; k < 100; k++) {
		const base = 100 + k
		path.push([base, base + 1.5, base - 0.5, base + 1, base - 5])
	}
	const { rows, entryIdx } = mkSeries(path)
	const atr = computeAtr(rows)
	const t = simulateE2Trade(rows, atr, entryIdx, 'long', 'band_trail')!
	assert.equal(t.exit, 'forced')
	assert.ok(t.realizedR > 5, `trend should bank > 5R, got ${t.realizedR}`)
	const w = simulateE2Trade(rows, atr, entryIdx, 'long', 'wide_hold')!
	assert.ok(['time', 'forced'].includes(w.exit))
	assert.ok(Math.abs(w.realizedR - t.realizedR) < 1e-9, 'no-cross trend: trail == hold')
})

it('e2: band_trail_be — partial на +1.14R банкует 0.57R и BE-scratch при возврате к entry', () => {
	const { rows, entryIdx } = mkSeries([
		[100, 105, 99.9, 104.6, 90], // fav 1.25R: partial + trail armed; prior mean 100, но low 99.9<100 -> НО mean прошлого бара = 100 (warm-up)... cross сработал бы; ставим mean=90 у warm-up? нет - prior bar это warm-up c mean 100
	])
	// упростим: проверяем только partial-байкинг через сценарий без cross
	const path: Array<[number, number, number, number, number]> = [
		[100, 105, 100.1, 104.6, 95], // low 100.1 > prior mean 100 -> нет cross; fav 1.25R -> partial (bank 0.57), BE active, trail armed
		[104.6, 104.8, 99.8, 100.0, 95], // adv: low 99.8 < entry 100 -> BE scratch
	]
	const { rows: rows2, entryIdx: e2 } = mkSeries(path)
	const atr2 = computeAtr(rows2)
	const t = simulateE2Trade(rows2, atr2, e2, 'long', 'band_trail_be')!
	assert.equal(t.partialTaken, true)
	assert.equal(t.exit, 'be-scratch')
	assert.ok(Math.abs(t.realizedR - 0.57) < 1e-9, `got ${t.realizedR}`)
	void rows
	void entryIdx
})

it('e2: short зеркален — стоп на -3R по adverse, трейл по high > prior mean', () => {
	// short от 100, R=4: стоп на 112; рэлли до 113 стопит
	const { rows, entryIdx } = mkSeries([[100, 113, 99, 112.5]])
	const atr = computeAtr(rows)
	const t = simulateE2Trade(rows, atr, entryIdx, 'short', 'band_trail')!
	assert.equal(t.exit, 'stop')
	assert.equal(t.realizedR, -3)
})
