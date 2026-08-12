import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { trueRangeSma } from '../ci/research/lib/ggiCorrectedReplay.js'
import { distanceDm3, replayDm3Trade, tallyDm3, DASH_BTC_2H } from '../ci/research/runDm3StaticExit.js'

const mk = (i: number, o: number, h: number, l: number, c: number, mean = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: o, high: h, low: l, close: c, volume: 1,
	mean, upperOuter: mean + 30, upperInner: mean + 15, lowerInner: mean - 15, lowerOuter: mean - 30,
	buy: false, sell: false,
})

function fixture(extra: ExactIndicatorRow[]): { rows: ExactIndicatorRow[]; tr55: Array<number | null>; sig: number } {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 60; i++) rows.push(mk(i, 100, 102, 98, 100))
	const sig = 59
	rows.push(...extra)
	return { rows, tr55: trueRangeSma(rows, 55), sig }
}

it('dm3: V2 статичный TP по фитилю даёт Full, когда moving-Inner V1 не даёт', () => {
	// сигнал на 59 (BUY), вход на 60 open=100; статичный TP = upperInner(59) = 115
	// бар 61: фитиль до 115.5, close 108 (ниже moving Inner 115 этого бара -> V1 не Full)
	const { rows, tr55, sig } = fixture([
		mk(60, 100, 104, 99.5, 103),
		mk(61, 103, 115.5, 102, 108),
		mk(62, 108, 109, 107, 108),
	])
	const v2 = replayDm3Trade(rows, tr55, sig, 1, 'V2_movP_staticTPwick')!
	assert.equal(v2.outcome, 'Full fix')
	assert.equal(v2.exitIndex, 61)
	const v1 = replayDm3Trade(rows, tr55, sig, 1, 'V1_moving_moving')!
	assert.notEqual(v1.outcome === 'Full fix' && v1.exitIndex === 61 && rows[61]!.close < 115, true)
	// partial у V2 сработал по moving mean (100) НА баре 60? high 104 >= mean 100 -> да
	// booked 25% на 100 = 0 pnl; full на 115: grossR > 0
	assert.ok(v2.grossR > 0)
})

it('dm3: V6 - partial по касанию TP, Full только по close за TP после partial', () => {
	const { rows, tr55, sig } = fixture([
		mk(60, 100, 116, 99.5, 110), // фитиль до 116 >= TP 115 -> partial 25% на 115; close 110 < 115 -> не Full
		mk(61, 110, 117, 109, 116),  // close 116 >= 115 -> Full
	])
	const t = replayDm3Trade(rows, tr55, sig, 1, 'V6_tp_partial_then_close')!
	assert.equal(t.outcome, 'Full fix')
	assert.equal(t.exitIndex, 61)
	// partial-then-stop -> Partial
	const { rows: r2, tr55: tr2, sig: s2 } = fixture([
		mk(60, 100, 116, 99.5, 110),
		mk(61, 110, 111, 40, 45), // рушимся сквозь стоп (100 - 12*4 = 52)
	])
	const t2 = replayDm3Trade(r2, tr2, s2, 1, 'V6_tp_partial_then_close')!
	assert.equal(t2.outcome, 'Partial')
})

it('dm3: стоп-first, short зеркален, tally/distance согласованы', () => {
	// SHORT: сигнал 59, вход 100, static TP = lowerInner(59) = 85, стоп = 100 + 48 = 148
	const { rows, tr55, sig } = fixture([
		mk(60, 100, 101, 84.5, 86), // фитиль до 84.5 <= 85 -> V2: Full сразу (partial тоже мог: mean 100 wick)
	])
	const t = replayDm3Trade(rows, tr55, sig, -1, 'V2_movP_staticTPwick')!
	assert.equal(t.outcome, 'Full fix')
	assert.ok(t.grossR > 0)
	const tal = tallyDm3([t, { ...t, outcome: 'End mark' }])
	assert.equal(tal.short.trades, 1)
	assert.equal(tal.short.end, 1)
	const exact = { long: { trades: 50, partial: 16, stop: 7, full: 27, end: 0 }, short: { trades: 40, partial: 13, stop: 3, full: 24, end: 0 } }
	assert.equal(distanceDm3(exact, DASH_BTC_2H), 0)
})
