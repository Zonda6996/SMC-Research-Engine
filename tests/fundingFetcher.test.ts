import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	fetchFundingHistory, parseBinanceFundingRows, parseFundingArchiveCsv, parseMarkPriceArchiveCsv,
} from '../tools/shared/fundingFetcher.js'

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
