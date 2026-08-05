import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { replayVar1Trade } from '../ci/research/runVar1ExitSweep.js'

const mk = (i: number, o: number, h: number, l: number, c: number, mean = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1,
	mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30,
	buy: false, sell: false,
})

// tr55 задаём вручную: vol=1 на сигнальном баре -> stopDist = stopMult
const tr = (rows: ExactIndicatorRow[]) => rows.map(() => 1 as number | null)

it('var1: базовый P25/S12 - partial по Mean, затем стоп = исход Partial с отрицательным R', () => {
	const rows = [mk(0, 90, 91, 89, 90), mk(1, 90, 90, 90, 90), mk(2, 90, 100.5, 89, 99), mk(3, 90, 90, 77, 78)]
	const t = replayVar1Trade(rows, tr(rows), 0, 1, { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false })!
	assert.equal(t.outcome, 'Partial')
	// partial 25% на +10 (0.833R) = +0.208R; 75% на -1R = -0.75R
	assert.ok(Math.abs(t.grossR - (0.25 * (10 / 12) - 0.75)) < 1e-9)
})

it('var1: BE после partial превращает пробой в выход по среднему входу (0 на остатке)', () => {
	const rows = [mk(0, 90, 91, 89, 90), mk(1, 90, 90, 90, 90), mk(2, 90, 100.5, 89, 99), mk(3, 90, 90, 89.9, 89.95)]
	const t = replayVar1Trade(rows, tr(rows), 0, 1, { partialFrac: 0.25, breakeven: true, stopMult: 12, addOn: true })!
	assert.equal(t.outcome, 'Partial')
	assert.ok(Math.abs(t.grossR - 0.25 * (10 / 12)) < 1e-9) // остаток вышел в ноль
})

it('var1: ADD усредняет вход и удваивает вес; стоп после добора стоит ~1.5R', () => {
	// вход 90, stopMult 8 -> стоп 82, add на 86; бар 2 касается 86 но не 82; бар 3 стоп
	const rows = [mk(0, 90, 91, 89, 90), mk(1, 90, 90, 90, 90), mk(2, 90, 90, 85.5, 87), mk(3, 87, 87, 81, 81.5)]
	const t = replayVar1Trade(rows, tr(rows), 0, 1, { partialFrac: 0.25, breakeven: false, stopMult: 8, addOn: true })!
	assert.equal(t.outcome, 'Stop')
	// avgEntry 88, вес 2: убыток 2*(82-88)/90 pct / (8/90 pct) = -1.5R
	assert.ok(Math.abs(t.grossR - -1.5) < 1e-9)
})

it('var1: Full fix по статичному TP фитилём', () => {
	const rows = [mk(0, 90, 91, 89, 90), mk(1, 90, 90, 90, 90), mk(2, 90, 116, 90, 114)]
	const t = replayVar1Trade(rows, tr(rows), 0, 1, { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false })!
	assert.equal(t.outcome, 'Full fix')
})
