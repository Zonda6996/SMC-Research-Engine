import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarSplitCutoff, clusterBootstrap, replayFundingOnly, type FundingSettlement, type MarkObservation } from '../ci/research/lib/fundingOnlyResearch.js'

const settlements: FundingSettlement[] = [
	{ timestamp: 100, rate: 0.01, markPrice: 100 },
	{ timestamp: 200, rate: -0.02, markPrice: 101 },
	{ timestamp: 350, rate: 0.03, markPrice: 102 },
]
const marks: MarkObservation[] = [
	{ timestamp: 100, markPrice: 999 }, { timestamp: 101, markPrice: 100 },
	{ timestamp: 200, markPrice: 999 }, { timestamp: 201, markPrice: 110 },
	{ timestamp: 350, markPrice: 999 }, { timestamp: 351, markPrice: 99 },
]

test('funding-only signs, strict fills, cashflow and fees are direction-aware', () => {
	const contra = replayFundingOnly('X', settlements, marks, 'CONTRARIAN', 5)
	assert.equal(contra[0]?.direction, -1)
	assert.equal(contra[0]?.entryAt, 101)
	assert.equal(contra[0]?.exitAt, 201)
	assert.equal(contra[0]?.fundingReturn, -0.02)
	assert.ok(Math.abs(contra[0]!.priceReturn + 0.1) < 1e-12)
	assert.ok(Math.abs(contra[0]!.netReturn + 0.121) < 1e-12)
	const continuation = replayFundingOnly('X', settlements, marks, 'CONTINUATION', 0)
	assert.equal(continuation[0]?.direction, 1)
	assert.equal(continuation[0]?.fundingReturn, 0.02)
})

test('variable cadence is preserved and zero creates no trade', () => {
	const rows = [{ timestamp: 0, rate: 0, markPrice: 1 }, ...settlements]
	const result = replayFundingOnly('X', rows, marks, 'CONTRARIAN', 0)
	assert.equal(result.length, 2)
	assert.equal(result[1]!.exitSettlementAt - result[1]!.decisionAt, 150)
})

test('no forward-fill: an event is dropped when its first strict entry is not before the next settlement', () => {
	const sparseMarks = marks.filter((x) => x.timestamp !== 201 && x.timestamp !== 350)
	const result = replayFundingOnly('X', settlements, sparseMarks, 'CONTRARIAN', 0)
	assert.equal(result.length, 1)
	assert.equal(result[0]?.decisionAt, 100)
	assert.equal(result[0]?.exitAt, 351)
})

test('calendar cutoff is common and deterministic', () => {
	assert.equal(calendarSplitCutoff({ A: [1, 2, 3], B: [1, 2, 4] }, 0.65), 2)
})

test('cluster bootstrap is deterministic', () => {
	const trades = replayFundingOnly('X', settlements, marks, 'CONTRARIAN', 5)
	assert.deepEqual(clusterBootstrap(trades, ['X'], 100, 42), clusterBootstrap(trades, ['X'], 100, 42))
})
