import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { IndependentReversalG2EvaluatedTrade } from '../src/core/analysis/IndependentReversalG2Metrics.js'
import {
	deterministicMonthBlockBootstrap,
	simulateIndependentReversalG2Portfolio,
	summarizeIndependentReversalG2,
} from '../src/core/analysis/IndependentReversalG2Metrics.js'
import { independentReversalG2PromotionVerdict } from '../ci/research/runIndependentReversalG2.js'

function trade(index: number, netR: number, symbol = 'BTC'): IndependentReversalG2EvaluatedTrade {
	return { symbol, signalAt: Date.UTC(2025, index % 3, 1) + index, entryIndex: index * 10, exitIndex: index * 10 + 20, netR, turnover: 2, holdingBars: 20, outcome: netR < 0 ? 'Stop' : 'Full fix' }
}

it('G2 net summary separates expectancy, PF, exposure and drawdown', () => {
	const summary = summarizeIndependentReversalG2([trade(0, 1), trade(1, -0.5), trade(2, 0.25)])
	assert.equal(summary.trades, 3)
	assert.equal(summary.meanNetR, 0.25)
	assert.equal(summary.profitFactor, 2.5)
	assert.ok((summary.netRPerUnitExposure ?? 0) > 0)
	assert.equal(summary.maximumSequentialDrawdownR, 0.5)
})

it('G2 month-block bootstrap is deterministic', () => {
	const trades = Array.from({ length: 24 }, (_, index) => trade(index, index % 4 === 0 ? -0.5 : 0.2))
	assert.deepEqual(deterministicMonthBlockBootstrap(trades, 500, 17), deterministicMonthBlockBootstrap(trades, 500, 17))
})

it('G2 portfolio ledger enforces maximum simultaneous open risk', () => {
	const overlapping = [trade(0, 0.2), trade(0, 0.3, 'ETH'), trade(0, 0.4, 'SOL'), trade(0, 0.5, 'XRP')]
	const result = simulateIndependentReversalG2Portfolio(overlapping, 1, 3)
	assert.ok(result.rejectedOverlap > 0)
	assert.ok(result.accepted <= 3)
})

it('G2 cannot be promising when non-count promotion gates fail', () => {
	const summary = (trades: number, meanNetR: number, profitFactor: number) => ({
		trades,
		meanNetR,
		medianNetR: meanNetR,
		profitFactor,
		positiveNetRate: 0.6,
		bestOnePercentRemovedR: 0.03,
		turnover: trades * 2,
		timeInMarketBars: trades * 10,
		netRPerUnitExposure: 0.001,
		maximumSequentialDrawdownR: 2,
	})
	assert.equal(independentReversalG2PromotionVerdict({
		completeFrozenTransfer: true,
		candidate: summary(60, 0.056, 1.58),
		matchedNull: summary(801, -0.033, 0.8),
		stress: summary(60, 0.048, 1.48),
		positiveCells: 4,
		totalCells: 6,
		maximumSingleSymbolPositiveContribution: 0.31,
		maximumPortfolioDrawdownPct: 3.2,
	}), 'REJECT_G2')
})
