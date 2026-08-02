import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { computeAtr, measureOutcome, median, summarize } from '../ci/research/runO1LabelOutcomes.js'

const mk = (i: number, o: number, h: number, l: number, c: number): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1,
	mean: 100, upperOuter: 130, upperInner: 115, lowerInner: 85, lowerOuter: 70,
	buy: false, sell: false,
})

it('o1: computeAtr - Wilder seed и рекурсия корректны на постоянном TR', () => {
	const rows = Array.from({ length: 40 }, (_, i) => mk(i, 100, 102, 98, 100)) // TR=4 всегда
	const atr = computeAtr(rows)
	assert.ok(Number.isNaN(atr[12]!))
	assert.equal(atr[13], 4)
	assert.ok(Math.abs(atr[30]! - 4) < 1e-9)
})

it('o1: measureOutcome - long с чистым ростом трогает +1R раньше -1R, MFE/MAE и terminal верны', () => {
	// ATR стабилизируется на 4; вход close=100; рост по +1 за бар
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 20; i++) rows.push(mk(i, 100, 102, 98, 100))
	for (let i = 20; i < 130; i++) {
		const base = 100 + (i - 20)
		rows.push(mk(i, base, base + 2, base - 1, base + 1))
	}
	const atr = computeAtr(rows)
	const out = measureOutcome(rows, atr, 20, 'long')!
	assert.ok(out)
	const r = atr[20]!
	assert.equal(out.firstTouch['1'], 'fav')
	assert.equal(out.firstTouch['2'], 'fav')
	assert.ok(out.mfe > out.mae)
	assert.ok(out.barsToPlus1R != null && out.barsToPlus1R! <= Math.ceil(r) + 2)
	assert.ok(out.terminal24! > 0)
	// short в том же росте — зеркально: adverse первым
	const outS = measureOutcome(rows, atr, 20, 'short')!
	assert.equal(outS.firstTouch['1'], 'adv')
	assert.ok(outS.terminal24! < 0)
})

it('o1: intrabar tie считается adverse; недостаток форварда отбрасывает сигнал; median корректна', () => {
	// один гигантский бар трогает и +1R и -1R сразу -> adv (замороженное консервативное правило)
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 30; i++) rows.push(mk(i, 100, 102, 98, 100))
	rows.push(mk(30, 100, 120, 80, 100)) // huge both-ways bar
	for (let i = 31; i < 60; i++) rows.push(mk(i, 100, 102, 98, 100))
	const atr = computeAtr(rows)
	const out = measureOutcome(rows, atr, 29, 'long')!
	assert.equal(out.firstTouch['1'], 'adv')
	// signal too close to data end -> null
	assert.equal(measureOutcome(rows, atr, rows.length - 5, 'long'), null)
	assert.equal(median([3, 1, 2]), 2)
	assert.equal(median([4, 1, 2, 3]), 2.5)
	const s = summarize([out])
	assert.equal(s.n, 1)
	assert.equal(s.winRate['1'], 0)
})
