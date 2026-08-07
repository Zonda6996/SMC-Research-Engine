import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	fetchFundingHistory, parseBinanceFundingRows, parseFundingArchiveCsv, parseMarkPriceArchiveCsv,
} from '../tools/shared/fundingFetcher.js'
import { deterministicNullB, fundingReturnR, replayFrozenStatic2, type FrozenTrade } from '../ci/research/runZondaQuickProfitabilityScan.js'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'

test('funding parser normalizes, sorts and deduplicates valid rows', () => {
	const rows = parseBinanceFundingRows([
		{ fundingTime: '20', fundingRate: '0.002', markPrice: '102' },
		{ fundingTime: 10, fundingRate: '-0.001', markPrice: 100 },
		{ fundingTime: 20, fundingRate: '0.003', markPrice: 103 },
		{ fundingTime: 'bad', fundingRate: 1, markPrice: 1 },
	])
	assert.deepEqual(rows, [
		{ timestamp: 10, rate: -0.001, markPrice: 100 },
		{ timestamp: 20, rate: 0.003, markPrice: 103 },
	])
})

test('funding archive parsers read rates and interval-open mark prices', () => {
	assert.deepEqual(parseFundingArchiveCsv('calc_time,funding_interval_hours,last_funding_rate\n1609459200002,8,0.00022753\n'), [
		{ timestamp: 1609459200002, rate: 0.00022753 },
	])
	assert.deepEqual(parseMarkPriceArchiveCsv('1609459200000,28948.25,1,1,1,0\n'), [
		{ timestamp: 1609459200000, markPrice: 28948.25 },
	])
})

test('FROZEN-1 funding uses correct sign and strict entry/exit bounds', () => {
	const payments = [
		{ timestamp: 100, rate: 0.001, markPrice: 100 },
		{ timestamp: 200, rate: 0.001, markPrice: 100 },
		{ timestamp: 300, rate: 0.001, markPrice: 100 },
	]
	assert.equal(fundingReturnR(1, 100, 300, 1, payments), -0.1)
	assert.equal(fundingReturnR(-1, 100, 300, 1, payments), 0.1)
})

test('FROZEN-1 STATIC2 uses step=5.5*ATR/1.17, stop-first and timeout close', () => {
	const row = (timestamp: number, open: number, high: number, low: number, close: number): ExactIndicatorRow => ({
		timestamp, open, high, low, close, volume: 1, mean: 100, upperOuter: 110, upperInner: 105,
		lowerInner: 95, lowerOuter: 90, buy: false, sell: false,
	})
	const rows = [row(0, 100, 101, 99, 100), row(3_600_000, 100, 120, 80, 100)]
	const trade = replayFrozenStatic2(rows, [1, 1], 0, 1, 3_600_000, [])
	assert.equal(trade?.outcome, 'stop')
	assert.ok(Math.abs((trade?.grossR ?? 0) + 1) < 1e-12)
})

test('Null B matches without replacement by side, month and timeframe', () => {
	const trade = (signalAt: number, side: 1 | -1, timeframe: '1h' | '2h', netR: number): FrozenTrade => ({
		symbol: 'TESTUSDT', timeframe, side, signalAt, entryAt: signalAt + 1, exitAt: signalAt + 2,
		holdingBars: 1, grossR: netR, costR: 0, fundingR: 0, netR, outcome: 'tp', seq: false, cluster: String(signalAt),
	})
	const jan = Date.UTC(2026, 0, 10)
	const template = [trade(jan, 1, '1h', 1), trade(jan + 10, 1, '1h', 1)]
	const controls = [
		trade(jan + 5, 1, '1h', 0.1),
		trade(jan + 20, 1, '1h', 0.2),
		trade(jan + 1, -1, '1h', 9),
		trade(jan + 1, 1, '2h', 9),
		trade(Date.UTC(2026, 1, 1), 1, '1h', 9),
	]
	assert.deepEqual(deterministicNullB(template, controls).map((row) => row.netR), [0.1, 0.2])
})

test('funding fetcher refuses silent API fallback when long archives are incomplete', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'funding-archive-test-'))
	const fetchImpl = (async (input: string | URL | Request) => {
		const url = new URL(String(input))
		assert.notEqual(url.hostname, 'fapi.binance.com')
		return new Response('', { status: 404 })
	}) as typeof fetch
	try {
		await assert.rejects(
			fetchFundingHistory('TESTUSDT', Date.UTC(2024, 0, 1), Date.UTC(2024, 2, 1), { fetchImpl, cacheDir: dir }),
			/Complete archived funding history is unavailable/,
		)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('funding fetcher can prefer paginated API for long windows', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'funding-api-test-'))
	let calls = 0
	const fetchImpl = (async (input: string | URL | Request) => {
		calls++
		const url = new URL(String(input))
		assert.equal(url.hostname, 'fapi.binance.com')
		return new Response(JSON.stringify([
			{ fundingTime: Date.UTC(2024, 0, 1), fundingRate: '0.0001', markPrice: '42000' },
		]), { status: 200, headers: { 'content-type': 'application/json' } })
	}) as typeof fetch
	try {
		const rows = await fetchFundingHistory('BTCUSDT', Date.UTC(2024, 0, 1), Date.UTC(2024, 2, 1), {
			fetchImpl,
			cacheDir: dir,
			preferApi: true,
		})
		assert.equal(rows.length, 1)
		assert.equal(calls, 1)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('funding fetcher uses half-open bounds, caches and normalizes symbol', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'funding-test-'))
	let calls = 0
	const fetchImpl = (async (input: string | URL | Request) => {
		calls++
		const url = new URL(String(input))
		assert.equal(url.searchParams.get('symbol'), 'BTCUSDT')
		assert.equal(url.searchParams.get('startTime'), '100')
		assert.equal(url.searchParams.get('endTime'), '299')
		return new Response(JSON.stringify([
			{ fundingTime: 99, fundingRate: '0.1', markPrice: '100' },
			{ fundingTime: 100, fundingRate: '0.01', markPrice: '100' },
			{ fundingTime: 200, fundingRate: '-0.02', markPrice: '101' },
			{ fundingTime: 300, fundingRate: '0.03', markPrice: '102' },
		]), { status: 200, headers: { 'content-type': 'application/json' } })
	}) as typeof fetch
	try {
		const first = await fetchFundingHistory('BTC/USDT:USDT', 100, 300, { fetchImpl, cacheDir: dir })
		assert.deepEqual(first.map((row) => row.timestamp), [100, 200])
		const second = await fetchFundingHistory('BTC/USDT:USDT', 100, 300, {
			fetchImpl: (() => { throw new Error('network must not be called') }) as typeof fetch,
			cacheDir: dir,
		})
		assert.deepEqual(second, first)
		assert.equal(calls, 1)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})
