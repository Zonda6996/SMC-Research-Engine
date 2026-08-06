import assert from 'node:assert/strict'
import test from 'node:test'
import {
	blockBootstrapExpectancy,
	contributionShares,
	removeBestOnePct,
	summarizeIndependentReversalTrades,
	utcCalendarWeekKey,
	type IndependentReversalResearchTrade,
} from '../src/core/analysis/reversalResearchMetrics.js'

const trade = (id: string, netR: number, entryAt: number, symbol = 'BTC/USDT'): IndependentReversalResearchTrade => ({
	version: 'test', tradeId: id, status: 'closed', direction: 'long', signalIndex: 0,
	entryIndex: 1, exitIndex: 2, entryAt, exitAt: entryAt + 1, entryReferencePrice: 100,
	entryPrice: 100, stopPrice: 99, targetPrice: 102, exitReferencePrice: 102,
	exitPrice: 102, exitReason: netR > 0 ? 'target' : 'stop', risk: 1, riskAtr: 1,
	holdingBars: 1, grossR: netR, entryFeeR: 0, exitFeeR: 0, feeR: 0,
	slippageR: 0, fundingR: 0, fundingPayments: 0, netR, symbol, timeframe: '15m', family: 'P',
})

test('Reversal metrics computes net expectancy, PF, drawdown and best-1% removal', () => {
	const rows = [trade('a', 2, 1), trade('b', -1, 2), trade('c', -1, 3), trade('d', 0.5, 4)]
	const metrics = summarizeIndependentReversalTrades(rows)
	assert.equal(metrics.trades, 4)
	assert.equal(metrics.winRate, 0.5)
	assert.equal(metrics.totalR, 0.5)
	assert.equal(metrics.expectancyR, 0.125)
	assert.equal(metrics.profitFactor, 1.25)
	assert.equal(metrics.maxDrawdownR, 2)
	assert.equal(metrics.bestOnePctRemovedTrades, 1)
	assert.ok(Math.abs(metrics.bestOnePctRemovedExpectancyR! - (-0.5)) < 1e-12)
})

test('best-1% removal is deterministic and removes at least one best trade', () => {
	const rows = Array.from({ length: 100 }, (_, index) => ({ netR: index }))
	const trimmed = removeBestOnePct(rows)
	assert.equal(trimmed.length, 99)
	assert.equal(Math.max(...trimmed.map((row) => row.netR)), 98)
})

test('UTC ISO calendar week key handles year boundary', () => {
	assert.equal(utcCalendarWeekKey(Date.UTC(2021, 0, 1)), '2020-W53')
	assert.equal(utcCalendarWeekKey(Date.UTC(2021, 0, 4)), '2021-W01')
})

test('calendar-week block bootstrap is deterministic and preserves positive constant expectancy', () => {
	const rows = [
		trade('a', 1, Date.UTC(2023, 0, 2)),
		trade('b', 1, Date.UTC(2023, 0, 9)),
		trade('c', 1, Date.UTC(2023, 0, 16), 'ETH/USDT'),
	]
	const first = blockBootstrapExpectancy(rows, 1_000, 77)
	const second = blockBootstrapExpectancy(rows, 1_000, 77)
	assert.deepEqual(first, second)
	assert.equal(first.lower95, 1)
	assert.equal(first.median, 1)
	assert.equal(first.upper95, 1)
	assert.equal(first.probabilityPositive, 1)
})

test('net-R contribution shares expose concentration by profitable symbol', () => {
	const rows = [trade('a', 3, 1), trade('b', 1, 2, 'ETH/USDT'), trade('c', -10, 3, 'ETH/USDT')]
	assert.deepEqual(contributionShares(rows), { 'BTC/USDT': 1, 'ETH/USDT': 0 })
})
