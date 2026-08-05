import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { trueRangeSma } from '../ci/research/lib/ggiCorrectedReplay.js'
import { buildLtfMap, replayLtfTrade, summarizeLtf, type LtfMap } from '../ci/research/runLtf1BeResolution.js'

const DUR2H = 7_200_000
const DUR15M = 900_000

const mk2h = (i: number, o: number, h: number, l: number, c: number, mean = 100): ExactIndicatorRow => ({
	timestamp: i * DUR2H, open: o, high: h, low: l, close: c, volume: 1,
	mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30,
	buy: false, sell: false,
})
const mk15 = (t: number, o: number, h: number, l: number, c: number): ExactIndicatorRow => ({
	timestamp: t, open: o, high: h, low: l, close: c, volume: 1,
	mean: 100, upperOuter: 130, upperInner: 115, lowerInner: 85, lowerOuter: 70,
	buy: false, sell: false,
})

/** flat warm-up then a scripted 2h path with exact 8x15m decomposition per bar */
function build(script: Array<{ bar: [number, number, number, number, number?]; subs: Array<[number, number, number, number]> }>): {
	rows2h: ExactIndicatorRow[]; rows15m: ExactIndicatorRow[]; ltf: LtfMap; tr55: Array<number | null>; entrySignal: number
} {
	const rows2h: ExactIndicatorRow[] = []
	const rows15m: ExactIndicatorRow[] = []
	for (let i = 0; i < 120; i++) {
		rows2h.push(mk2h(i, 100, 102, 98, 100))
		for (let s = 0; s < 8; s++) rows15m.push(mk15(i * DUR2H + s * DUR15M, 100, 102, 98, 100))
	}
	const entrySignal = 119
	let i = 120
	for (const step of script) {
		const [o, h, l, c, m] = step.bar
		rows2h.push(mk2h(i, o, h, l, c, m ?? 100))
		assert.equal(step.subs.length, 8, 'script must give 8 sub-bars')
		step.subs.forEach(([so, sh, sl, sc], s) => rows15m.push(mk15(i * DUR2H + s * DUR15M, so, sh, sl, sc)))
		i++
	}
	// tail so trades can end
	for (let k = 0; k < 30; k++) {
		const prev = rows2h[rows2h.length - 1]!
		rows2h.push(mk2h(i, prev.close, prev.close + 1, prev.close - 1, prev.close))
		for (let s = 0; s < 8; s++) rows15m.push(mk15(i * DUR2H + s * DUR15M, prev.close, prev.close + 1, prev.close - 1, prev.close))
		i++
	}
	const ltf = buildLtfMap(rows2h, rows15m)
	return { rows2h, rows15m, ltf, tr55: trueRangeSma(rows2h, 55), entrySignal }
}

it('ltf1: buildLtfMap выравнивает 8x15m на 2h бар и режектит расхождение конверта', () => {
	const { ltf, rows2h } = build([{ bar: [100, 104, 98, 103], subs: [[100, 101, 99, 100], [100, 102, 99, 101], [101, 104, 100, 103], [103, 104, 102, 103], [103, 103.5, 101, 102], [102, 103, 100, 101], [101, 102, 98, 99], [99, 103.5, 98.5, 103]] }])
	assert.equal(ltf.violations, 0)
	assert.ok(ltf.slices[120] != null)
	assert.equal(ltf.slices[120]![1] - ltf.slices[120]![0], 8)
	assert.equal(ltf.alignedBars, ltf.coveredBars) // every covered bar aligned
	void rows2h
})

it('ltf1: порядок внутри 2h бара решает — partial-до-стопа против OHLC-консерватизма', () => {
	// 2h бар трогает и mean(100+) сверху и стоп снизу; 15m путь: СНАЧАЛА вверх к mean, потом вниз
	// entry по open=98 следующего 2h бара... упростим: сигнал на 119, вход на 120 open=100
	// stop = 12*TR55(=4) = 48 -> стоп 52, недостижим; сузим через low. Вместо стопа тестируем BE:
	// bar1: чистый заход вверх до 104.6 (partial wick: mean=100... уже выше) — поставим mean=104
	const { rows2h, rows15m, ltf, tr55, entrySignal } = build([
		{ bar: [100, 105, 99, 104, 104], subs: [[100, 101, 99.5, 100.5], [100.5, 103, 100, 102.5], [102.5, 105, 102, 104.5], [104.5, 104.8, 104, 104.2], [104.2, 104.4, 103, 103.5], [103.5, 104, 102.5, 103], [103, 103.5, 102, 102.5], [102.5, 103, 99, 104]] }, // partial на sub2 (high 105 >= 104), затем откат к 99 на sub7 -> BE (100) пробит wick
	])
	const b1 = replayLtfTrade(rows2h, rows15m, ltf, tr55, entrySignal, 1, 'B1_wick_avg')!
	assert.ok(b1)
	assert.equal(b1.partial, true)
	assert.equal(b1.outcome, 'Partial') // BE scratch после partial
	// banked 25% на 104: pnl = 4% * 0.25 = 1%; остальное по entry (100) = 0
	// grossR = 1% / plannedRiskPct(48%) ~ 0.0208
	assert.ok(Math.abs(b1.grossR - 0.25 * (4 / 100) * 100 / 48) < 1e-9, `got ${b1.grossR}`)
	// B0: BE нет — позиция живёт дальше и в хвосте (flat ~104->103.98) закрывается позже
	const b0 = replayLtfTrade(rows2h, rows15m, ltf, tr55, entrySignal, 1, 'B0_none')
	assert.ok(b0 == null || b0.outcome !== 'Partial' || b0.exitIndex > b1.exitIndex, 'B0 must not BE-scratch')
})

it('ltf1: B3 close-entry не выбивается wick-проколом entry, B1 выбивается; B1==B2', () => {
	const { rows2h, rows15m, ltf, tr55, entrySignal } = build([
		{ bar: [100, 105, 99.5, 104.5, 104], subs: [[100, 105, 100, 104.5], [104.5, 104.6, 104, 104.2], [104.2, 104.5, 99.5, 104.3], [104.3, 104.5, 104, 104.2], [104.2, 104.4, 104, 104.1], [104.1, 104.3, 104, 104.2], [104.2, 104.4, 104, 104.3], [104.3, 104.6, 104.2, 104.5]] }, // sub0: partial (105>=104); sub2: wick до 99.5 НО close 104.3 (выше entry 100)
	])
	const b1 = replayLtfTrade(rows2h, rows15m, ltf, tr55, entrySignal, 1, 'B1_wick_avg')!
	const b2 = replayLtfTrade(rows2h, rows15m, ltf, tr55, entrySignal, 1, 'B2_wick_entry')!
	const b3 = replayLtfTrade(rows2h, rows15m, ltf, tr55, entrySignal, 1, 'B3_close_entry')
	assert.equal(b1.outcome, 'Partial') // wick 99.5 <= 100 -> BE scratch
	assert.equal(b1.exitIndex, 120)
	assert.equal(b2.outcome, b1.outcome)
	assert.ok(Math.abs(b2.grossR - b1.grossR) < 1e-12, 'B1 == B2 under no-add')
	assert.ok(b3 == null || b3.exitIndex > 120 || b3.outcome !== 'Partial', 'B3 survives the wick')
	const s = summarizeLtf([b1])
	assert.equal(s.partial, 1)
	assert.ok(s.wr === 1) // banked partial > 0
})

it('ltf1: short зеркален и Full fix срабатывает по close за Inner в конце 2h бара', () => {
	// short: сигнал 119, вход 100; 2h бар закрывается ниже lowerInner (85)
	const subsDown: Array<[number, number, number, number]> = []
	for (let s = 0; s < 8; s++) {
		const from = 100 - s * 2
		const to = 100 - (s + 1) * 2
		subsDown.push([from, from + 0.5, to, to])
	}
	// composite: open 100, high 100.5, low 84, close 84 == the 2h bar exactly
	const { rows2h, rows15m, ltf, tr55, entrySignal } = build([
		{ bar: [100, 100.5, 84, 84, 100], subs: subsDown },
	])
	const t = replayLtfTrade(rows2h, rows15m, ltf, tr55, entrySignal, -1, 'B1_wick_avg')!
	assert.equal(t.outcome, 'Full fix')
	assert.equal(t.exitIndex, 120)
	assert.ok(t.grossR > 0)
})
