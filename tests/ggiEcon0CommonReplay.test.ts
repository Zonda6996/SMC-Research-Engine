import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { collectCorrectedSignalTrades, replayCorrectedSignalTrade } from '../ci/research/lib/ggiCorrectedReplay.js'
import { causalAtrQuintiles, ggiSignals, matchEcon0NullSignals, summarizeEcon0 } from '../ci/research/runGgiEcon0CommonReplayV1.js'

function row(index: number, partial: Partial<ExactIndicatorRow> = {}): ExactIndicatorRow {
	return { timestamp: Date.UTC(2026, 0, 1) + index * 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1, mean: 105, upperOuter: 120, upperInner: 110, lowerInner: 90, lowerOuter: 80, buy: false, sell: false, ...partial }
}

it('ECON0 arbitrary-signal replay does not require a vendor arrow and stays prefix-stable after closure', () => {
	const rows = Array.from({ length: 25 }, (_, index) => row(index))
	rows[14] = row(14, { buy: false, sell: false })
	rows[15] = row(15, { open: 100, high: 106, low: 99, close: 104, mean: 105 })
	rows[16] = row(16, { open: 104, high: 105, low: 99, close: 100, mean: 105 })
	const tr55 = Array<number | null>(rows.length).fill(2)
	const config = { stopMultiplier: 4, beBound: 'next-bar-entry-be' as const, addEnabled: false, maxHoldingBars: 2_000 }
	const trade = replayCorrectedSignalTrade(rows, tr55, 14, 1, config)
	assert.ok(trade)
	assert.equal(trade.outcome, 'Partial')
	assert.equal(trade.exitIndex, 16)
	const prefix = replayCorrectedSignalTrade(rows.slice(0, 17), tr55.slice(0, 17), 14, 1, config)
	assert.deepEqual(prefix, trade)
})

it('ECON0 GGI wrapper and arbitrary signal collection remain behaviorally identical', () => {
	const rows = Array.from({ length: 125 }, (_, index) => row(index))
	rows[110] = row(110, { buy: true })
	rows[111] = row(111, { open: 100, high: 106, low: 99, close: 105, mean: 105 })
	rows[112] = row(112, { high: 112, low: 101, close: 111, upperInner: 110 })
	const tr55 = Array<number | null>(rows.length).fill(2)
	const signals = ggiSignals(rows)
	assert.deepEqual(signals, [{ signalIndex: 110, side: 1 }])
	const trades = collectCorrectedSignalTrades(rows, tr55, signals, { stopMultiplier: 4, beBound: 'next-bar-entry-be', addEnabled: false })
	assert.equal(trades.length, 1)
	assert.equal(trades[0]!.outcome, 'Full fix')
})

it('ECON0 metrics expose dashboard WR separately from true positive net return', () => {
	const rows = Array.from({ length: 30 }, (_, index) => row(index))
	const tr55 = Array<number | null>(rows.length).fill(2)
	rows[14] = row(14)
	rows[15] = row(15, { open: 100, high: 106, low: 99, mean: 105 })
	rows[16] = row(16, { low: 99 })
	const trade = replayCorrectedSignalTrade(rows, tr55, 14, 1, { stopMultiplier: 4, beBound: 'next-bar-entry-be', addEnabled: false })
	assert.ok(trade)
	const summary = summarizeEcon0([trade], rows.length)
	assert.equal(summary.dashboardWinRate, 1)
	assert.equal(summary.positiveNetRate, 1)
	assert.equal(summary.partial, 1)
	assert.ok((summary.meanNetR ?? 0) > 0)
	assert.equal(summary.outcomes.Partial.count, 1)
})

it('ECON0 null matching preserves side, mean state and count without selecting template bars', () => {
	const rows = Array.from({ length: 240 }, (_, index) => row(index, { close: index % 2 ? 101 : 99, mean: 100 }))
	const tr55 = Array.from({ length: rows.length }, (_, index) => index < 55 ? null : 1 + index / 100)
	const template = [{ signalIndex: 120, side: 1 as const }, { signalIndex: 122, side: -1 as const }, { signalIndex: 124, side: 1 as const }]
	const matched = matchEcon0NullSignals(rows, tr55, template, 100, 220, 17)
	assert.equal(matched.filter((signal) => signal.signalIndex >= 0).length, template.length)
	assert.equal(new Set(matched.map((signal) => signal.signalIndex)).size, template.length)
	for (let i = 0; i < matched.length; i++) {
		assert.equal(matched[i]!.side, template[i]!.side)
		assert.notEqual(matched[i]!.signalIndex, template[i]!.signalIndex)
		assert.equal(Math.sign(rows[matched[i]!.signalIndex]!.close - rows[matched[i]!.signalIndex]!.mean), Math.sign(rows[template[i]!.signalIndex]!.close - rows[template[i]!.signalIndex]!.mean))
	}
	assert.deepEqual(matchEcon0NullSignals(rows, tr55, template, 100, 220, 17), matched)
})

it('ECON0 ATR strata are causal and prefix-stable', () => {
	const rows = Array.from({ length: 150 }, (_, index) => row(index))
	const tr55 = Array.from({ length: rows.length }, (_, index) => index < 100 ? null : index - 99)
	const full = causalAtrQuintiles(rows, tr55, 100, rows.length)
	const prefix = causalAtrQuintiles(rows.slice(0, 130), tr55.slice(0, 130), 100, 130)
	assert.equal(full[100], 2)
	assert.equal(full[119], 4)
	assert.deepEqual(prefix.slice(0, 129), full.slice(0, 129))
	assert.equal(full[149], null)
})
