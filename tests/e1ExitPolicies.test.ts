import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { computeAtr } from '../ci/research/runO1LabelOutcomes.js'
import { simulateTrade, summarizePolicy } from '../ci/research/runE1ExitPolicies.js'

const mk = (i: number, o: number, h: number, l: number, c: number): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1,
	mean: 100, upperOuter: 130, upperInner: 115, lowerInner: 85, lowerOuter: 70,
	buy: false, sell: false,
})

/** flat warm-up (TR=4 -> ATR=4), then a deterministic path */
function mkSeries(path: Array<[number, number, number, number]>): { rows: ExactIndicatorRow[]; entryIdx: number } {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 30; i++) rows.push(mk(i, 100, 102, 98, 100))
	const entryIdx = 29
	let i = 30
	for (const [o, h, l, c] of path) rows.push(mk(i++, o, h, l, c))
	while (rows.length < entryIdx + 60) rows.push(mk(i++, rows[rows.length - 1]!.close, rows[rows.length - 1]!.close + 1, rows[rows.length - 1]!.close - 1, rows[rows.length - 1]!.close))
	return { rows, entryIdx }
}

it('e1: fixed_2to1 long — чистый ход к +2R даёт target с realizedR=2', () => {
	// entry 100, R=4 -> target 108, stop 96; ход вверх без касания 96
	const { rows, entryIdx } = mkSeries([[100, 104, 99, 103], [103, 109, 102, 108]])
	const atr = computeAtr(rows)
	const t = simulateTrade(rows, atr, entryIdx, 'long', 'fixed_2to1')!
	assert.equal(t.exit, 'target')
	assert.equal(t.realizedR, 2)
})

it('e1: both-touch бар исполняется как ADVERSE (замороженное правило)', () => {
	// один бар накрывает и stop (96) и target (108) -> stop
	const { rows, entryIdx } = mkSeries([[100, 110, 95, 100]])
	const atr = computeAtr(rows)
	const t = simulateTrade(rows, atr, entryIdx, 'long', 'fixed_2to1')!
	assert.equal(t.exit, 'stop')
	assert.equal(t.realizedR, -1)
})

it('e1: partial_be — partial на +1.14R, затем возврат к entry даёт be-scratch с banked 0.57R (vendor-style WIN)', () => {
	// entry 100, R=4: partial уровень 104.56; затем откат к 100
	const { rows, entryIdx } = mkSeries([[100, 105, 99.5, 104], [104, 104.5, 100, 100.2], [100.2, 100.5, 99.9, 100.1]])
	const atr = computeAtr(rows)
	const t = simulateTrade(rows, atr, entryIdx, 'long', 'partial_be')!
	assert.equal(t.partialTaken, true)
	assert.equal(t.exit, 'be-scratch')
	assert.ok(Math.abs(t.realizedR - 0.5 * 1.14) < 1e-9)
	const s = summarizePolicy([t])
	assert.equal(s.winrateVendorStyle, 1) // >0 R
	assert.equal(s.winrateStrict, 1) // 0.57 >= 0.5
	assert.equal(s.partialBeRate, 1)
})

it('e1: short зеркален; time_stop закрывается по close на 96-м баре', () => {
	// short: entry 100, R=4, stop 108, target 92; лёгкий дрейф вниз без касаний
	const drift: Array<[number, number, number, number]> = []
	for (let k = 0; k < 100; k++) {
		const b = 100 - k * 0.02
		drift.push([b, b + 0.5, b - 0.5, b - 0.02])
	}
	const { rows, entryIdx } = mkSeries(drift)
	const atr = computeAtr(rows)
	const t = simulateTrade(rows, atr, entryIdx, 'short', 'time_stop')!
	assert.equal(t.exit, 'time')
	assert.equal(t.bars, 96)
	assert.ok(t.realizedR > 0, `short drift down should be positive, got ${t.realizedR}`)
})
