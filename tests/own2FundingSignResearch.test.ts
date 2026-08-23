import assert from 'node:assert/strict'
import test from 'node:test'
import type { ArrowSignal } from '../src/core/signals/ArrowSignalEngine.js'
import type { ArrowTrade } from '../src/core/signals/ArrowTradeReplay.js'
import {
	decideFundingSign,
	directionAwareFundingCashflow,
	filterFundingSignSignals,
	fundingContributionR,
	latestSettledFundingStrictlyBefore,
	meanPerBaselineOpportunity,
	pairedDeltaPerBaselineOpportunity,
	pairedUtcDayClusterBootstrap,
	type PairedOpportunity,
	type SettledFunding,
} from '../ci/research/lib/own2FundingSignResearch.js'

const funding: SettledFunding[] = [
	{ timestamp: 100, rate: -0.001, markPrice: 100 },
	{ timestamp: 200, rate: 0, markPrice: 101 },
	{ timestamp: 300, rate: 0.002, markPrice: 102 },
]
const signal = (side: 'long' | 'short', at: number): ArrowSignal => ({
	version: 'test', signalIndex: at, signalAt: at, side, close: 1, mean: 1, inner: 1, outer: 1, atr200: 1,
	trigger: { family: 'own2-extension', penetrationInner: 0, distanceMeanPct: 1, relativeVolume: 2 },
})

test('sign filter handles long, short, zero and missing without changing baseline candidates', () => {
	assert.equal(decideFundingSign('long', 150, funding).decision, 'retain')
	assert.equal(decideFundingSign('short', 150, funding).decision, 'veto-sign')
	assert.equal(decideFundingSign('long', 250, funding).decision, 'veto-zero')
	assert.equal(decideFundingSign('short', 350, funding).decision, 'retain')
	assert.equal(decideFundingSign('long', 50, funding).decision, 'veto-missing')
	const baseline = [signal('long', 150), signal('short', 150), signal('short', 350)]
	const result = filterFundingSignSignals(baseline, funding)
	assert.equal(baseline.length, 3)
	assert.deepEqual(result.retained, [baseline[0], baseline[2]])
	assert.ok(result.retained.every((x) => baseline.includes(x)))
})

test('causal as-of is strict: exact timestamp is unavailable and no future settlement leaks', () => {
	assert.equal(latestSettledFundingStrictlyBefore(funding, 100), null)
	assert.equal(latestSettledFundingStrictlyBefore(funding, 200)?.timestamp, 100)
	assert.equal(latestSettledFundingStrictlyBefore(funding, 299)?.timestamp, 200)
	assert.equal(latestSettledFundingStrictlyBefore(funding, 300)?.timestamp, 200)
	assert.equal(latestSettledFundingStrictlyBefore(funding, 301)?.timestamp, 300)
	assert.equal(decideFundingSign('long', 300, funding).decision, 'veto-zero')
})

test('funding cashflow is direction-aware', () => {
	assert.equal(directionAwareFundingCashflow('long', 0.01, 100, 1), -1)
	assert.equal(directionAwareFundingCashflow('short', 0.01, 100, 1), 1)
	assert.equal(directionAwareFundingCashflow('long', -0.01, 100, 2), 2)
})

test('trade funding uses only crossed settlements and actual add/partial position state', () => {
	const trade = {
		entryAt: 100, exitAt: 400, entry: 100, add: 90, stop: 80, side: 'long',
		events: [
			{ type: 'entry', at: 100, index: 1, price: 100 },
			{ type: 'add', at: 180, index: 2, price: 90 },
			{ type: 'partial', at: 280, index: 3, price: 110 },
		],
	} as ArrowTrade
	const rows = [
		{ timestamp: 90, rate: 0.01, markPrice: 100 },
		{ timestamp: 150, rate: 0.01, markPrice: 100 },
		{ timestamp: 220, rate: 0.01, markPrice: 100 },
		{ timestamp: 320, rate: 0.01, markPrice: 100 },
		{ timestamp: 400, rate: 0.01, markPrice: 100 },
	]
	// oneR=30: cashflows -1 -2 -1.5 = -4.5 => -0.15R
	assert.ok(Math.abs(fundingContributionR(trade, rows) + 0.15) < 1e-12)
})

test('paired opportunity metric treats veto as zero exposure', () => {
	const rows: PairedOpportunity[] = [
		{ symbol: 'A', timeframe: '1h', decisionAt: 1, baselineNetR: -1, filteredNetR: -1, retained: true },
		{ symbol: 'A', timeframe: '1h', decisionAt: 2, baselineNetR: -2, filteredNetR: 0, retained: false },
	]
	assert.equal(meanPerBaselineOpportunity(rows, 'baseline'), -1.5)
	assert.equal(meanPerBaselineOpportunity(rows, 'filtered'), -0.5)
	assert.equal(pairedDeltaPerBaselineOpportunity(rows), 1)
})

test('UTC-day paired cluster bootstrap is deterministic', () => {
	const rows: PairedOpportunity[] = Array.from({ length: 12 }, (_, i) => ({
		symbol: i % 2 ? 'A' : 'B', timeframe: '1h', decisionAt: Date.UTC(2026, 0, 1 + Math.floor(i / 2)),
		baselineNetR: i % 3 - 1, filteredNetR: i % 2 ? 0 : 0.5, retained: i % 2 === 0,
	}))
	assert.deepEqual(pairedUtcDayClusterBootstrap(rows, 500, 25082026), pairedUtcDayClusterBootstrap(rows, 500, 25082026))
})
