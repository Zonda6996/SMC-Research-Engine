import assert from 'node:assert/strict'
import test from 'node:test'
import { runPortfolioBacktest, type PortfolioTrade } from '../src/core/analysis/portfolioBacktest.js'

const trade = (id: string, entryAt: number, exitAt: number, netR: number, symbol = 'ALT/USDT'): PortfolioTrade => ({
	id, symbol, timeframe: '30m', scenario: 'deep', direction: 'long', entryAt, exitAt, netR,
})

test('capacity limit rejects fourth overlapping 1% trade at 3%', () => {
	const result = runPortfolioBacktest([
		trade('a', 1, 10, 1), trade('b', 2, 10, 1), trade('c', 3, 10, 1), trade('d', 4, 10, 10),
	], { initialEquity: 10_000, riskPct: 1, maxRiskPct: 3, mcRuns: 0 })
	assert.equal(result.summary.accepted, 3)
	assert.equal(result.summary.capacityRejected, 1)
	assert.equal(result.ledger.at(-1)?.status, 'capacity-rejected')
	assert.equal(result.summary.maxConcurrent, 3)
})

test('exit on same timestamp frees risk before entry', () => {
	const result = runPortfolioBacktest([
		trade('a', 1, 5, -1), trade('b', 2, 6, -1), trade('c', 3, 7, -1), trade('d', 5, 8, 1),
	], { mcRuns: 0 })
	assert.equal(result.summary.accepted, 4)
	assert.equal(result.summary.capacityRejected, 0)
})

test('compounds equity and computes drawdown and losing streak', () => {
	const result = runPortfolioBacktest([
		trade('a', 1, 2, 1), trade('b', 3, 4, -1), trade('c', 5, 6, -1),
	], { initialEquity: 10_000, riskPct: 1, maxRiskPct: 3, mcRuns: 0 })
	assert.equal(result.summary.finalEquity.toFixed(2), '9899.01')
	assert.equal(result.summary.maxLosingStreak, 2)
	assert.ok(result.summary.maxDrawdownPct > 1.98 && result.summary.maxDrawdownPct < 2.01)
})

test('tie breaks are deterministic by symbol', () => {
	const result = runPortfolioBacktest([
		trade('z', 1, 5, 1, 'Z/USDT'), trade('b', 1, 5, 1, 'B/USDT'), trade('a', 1, 5, 1, 'A/USDT'), trade('c', 1, 5, 1, 'C/USDT'),
	], { mcRuns: 0 })
	assert.deepEqual(result.ledger.map((r) => [r.symbol, r.status]), [
		['A/USDT', 'accepted'], ['B/USDT', 'accepted'], ['C/USDT', 'accepted'], ['Z/USDT', 'capacity-rejected'],
	])
})

test('duplicate trade ids cannot change equity twice or hold two slots', () => {
	const result = runPortfolioBacktest([
		trade('dup', 1, 10, 2), trade('dup', 1, 10, 2), trade('b', 2, 10, 1),
	], { initialEquity: 10_000, riskPct: 1, maxRiskPct: 3, mcRuns: 0 })
	assert.equal(result.ledger.length, 2) // дубль исчез целиком, не стал reject
	assert.equal(result.summary.accepted, 2)
	assert.equal(result.summary.totalR, 3)
	assert.equal(result.summary.maxConcurrent, 2)
	assert.equal(result.summary.finalEquity.toFixed(2), '10300.00')
})

test('duplicates do not steal capacity from real trades', () => {
	const result = runPortfolioBacktest([
		trade('a', 1, 10, 1), trade('a', 1, 10, 1), trade('a', 1, 10, 1),
		trade('b', 2, 10, 1), trade('c', 3, 10, 1), trade('d', 4, 10, 1),
	], { initialEquity: 10_000, riskPct: 1, maxRiskPct: 3, mcRuns: 0 })
	// без дедупа: 3 копии `a` заняли бы весь лимит и вытеснили b/c/d
	assert.equal(result.summary.accepted, 3)
	assert.equal(result.summary.capacityRejected, 1)
	assert.deepEqual(result.ledger.map((r) => [r.id, r.status]), [
		['a', 'accepted'], ['b', 'accepted'], ['c', 'accepted'], ['d', 'capacity-rejected'],
	])
})

test('seeded Monte Carlo is reproducible', () => {
	const trades = [trade('a', 1, 2, 1), trade('b', 3, 4, -1), trade('c', 5, 6, 2)]
	const a = runPortfolioBacktest(trades, { mcRuns: 100, seed: 77 }).monteCarlo
	const b = runPortfolioBacktest(trades, { mcRuns: 100, seed: 77 }).monteCarlo
	assert.deepEqual(a, b)
})
