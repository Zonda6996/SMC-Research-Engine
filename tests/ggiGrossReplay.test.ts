import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { collectCorrectedGgiTrades, replayCorrectedGgiTrade, trueRangeSma } from '../ci/research/lib/ggiCorrectedReplay.js'
import { collectGgiGrossTrades, replayGgiTrade } from '../ci/research/lib/ggiGrossReplay.js'

function row(index: number, partial: Partial<ExactIndicatorRow> = {}): ExactIndicatorRow {
	return {
		timestamp: index * 60_000,
		open: 100,
		high: 101,
		low: 99,
		close: 100,
		volume: 1,
		mean: 105,
		upperOuter: 120,
		upperInner: 110,
		lowerInner: 90,
		lowerOuter: 80,
		buy: false,
		sell: false,
		...partial,
	}
}

it('GGI gross replay enters at next open and reaches moving mean then moving upper inner', () => {
	const rows = Array.from({ length: 20 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true })
	rows[15] = row(15, { open: 100, high: 104, low: 99 })
	rows[16] = row(16, { high: 106, low: 100, mean: 105 })
	rows[17] = row(17, { high: 109, low: 102, upperInner: 108 })
	const trade = replayGgiTrade(rows, 14, { warmupBars: 14, stopFamily: 'atr', atrMultiplier: 2, addEnabled: false })
	assert.ok(trade)
	assert.equal(trade.entryIndex, 15)
	assert.equal(trade.partialIndex, 16)
	assert.equal(trade.fullIndex, 17)
	assert.equal(trade.outcome, 'Full fix')
})

it('GGI gross replay classifies stop after partial as Partial', () => {
	const rows = Array.from({ length: 20 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true })
	rows[15] = row(15, { open: 100, high: 106, low: 99, mean: 105 })
	rows[16] = row(16, { open: 104, high: 104, low: 99 })
	const trade = replayGgiTrade(rows, 14, { warmupBars: 14, stopFamily: 'atr', atrMultiplier: 2, addEnabled: false })
	assert.ok(trade)
	assert.equal(trade.partialIndex, 15)
	assert.equal(trade.outcome, 'Partial')
})

it('GGI gross replay uses deterministic stop-first ambiguity', () => {
	const rows = Array.from({ length: 20 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true })
	rows[15] = row(15, { open: 100, high: 111, low: 93, mean: 105, upperInner: 110 })
	const stopFirst = replayGgiTrade(rows, 14, { warmupBars: 14, stopFamily: 'atr', atrMultiplier: 2, addEnabled: false, intrabarOrder: 'stop-first' })
	const targetFirst = replayGgiTrade(rows, 14, { warmupBars: 14, stopFamily: 'atr', atrMultiplier: 2, addEnabled: false, intrabarOrder: 'target-first' })
	assert.equal(stopFirst?.outcome, 'Stop')
	assert.equal(targetFirst?.outcome, 'Full fix')
})

it('GGI gross replay skips startup-invalid signals', () => {
	const rows = Array.from({ length: 20 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true, upperOuter: 90 })
	assert.equal(collectGgiGrossTrades(rows, { warmupBars: 14 }).length, 0)
})

it('GGI Standard replay uses a fixed 1.14R target without a dynamic partial', () => {
	const rows = Array.from({ length: 20 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true })
	rows[15] = row(15, { open: 100, high: 105, low: 99, mean: 102, upperInner: 130, upperOuter: 140 })
	rows[16] = row(16, { high: 106, low: 99, mean: 101, upperInner: 130, upperOuter: 140 })
	const trade = replayGgiTrade(rows, 14, {
		warmupBars: 14,
		stopFamily: 'atr',
		atrMultiplier: 2,
		addEnabled: false,
		targetMode: 'standard-fixed',
		standardTargetR: 1.14,
	})
	assert.ok(trade)
	assert.equal(trade.partialIndex, null)
	assert.equal(trade.outcome, 'Full fix')
	assert.ok(Math.abs(trade.grossR! - 1.14) < 1e-9)
})

it('corrected GGI replay requires a close beyond Inner for Full fix', () => {
	const rows = Array.from({ length: 20 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true })
	rows[15] = row(15, { open: 100, high: 111, low: 99, close: 107, mean: 105, upperInner: 110 })
	rows[16] = row(16, { high: 109, low: 99, close: 100, mean: 105, upperInner: 110 })
	rows[17] = row(17, { high: 112, low: 100, close: 111, mean: 105, upperInner: 110 })
	const tr55 = Array<number | null>(rows.length).fill(2)
	const trade = replayCorrectedGgiTrade(rows, tr55, 14, {
		stopMultiplier: 4,
		addEnabled: false,
		beBound: 'optimistic-initial-stop',
	})
	assert.ok(trade)
	assert.equal(trade.partialIndex, 15)
	assert.equal(trade.fullIndex, 17)
	assert.equal(trade.outcome, 'Full fix')
})

it('corrected GGI replay keeps common Shapes without a second non-overlap filter', () => {
	const rows = Array.from({ length: 25 }, (_, index) => row(index))
	rows[14] = row(14, { buy: true })
	rows[16] = row(16, { sell: true })
	rows[20] = row(20, { buy: true })
	const tr55 = trueRangeSma(rows, 3)
	const trades = collectCorrectedGgiTrades(rows, tr55, {
		stopMultiplier: 10,
		addEnabled: false,
	}, 14)
	assert.equal(trades.length, 3)
})
