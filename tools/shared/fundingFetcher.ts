import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IndependentReversalFundingPayment } from '../../src/core/analysis/reversalTradeReplay.js'
import { archiveSymbol, unzipCsv } from './archiveKlines.js'

const FUNDING_URL = 'https://fapi.binance.com/fapi/v1/fundingRate'
const ARCHIVE_BASE_URL = 'https://data.binance.vision/data/futures/um/monthly'
const DEFAULT_CACHE_DIR = join(process.cwd(), 'tmp', 'funding-cache')
const MAX_PAGE_SIZE = 1_000
const CACHE_SCHEMA_VERSION = 2

export interface FundingFetchOptions {
	fetchImpl?: typeof fetch
	cacheDir?: string
	useCache?: boolean
	/** Skip monthly ZIP archives and use the paginated REST endpoint. */
	preferApi?: boolean
}

interface BinanceFundingRow {
	symbol?: string
	fundingTime?: number | string
	fundingRate?: number | string
	timestamp?: number | string
	rate?: number | string
	markPrice?: number | string
}

export function parseBinanceFundingRows(rows: unknown): IndependentReversalFundingPayment[] {
	if (!Array.isArray(rows)) throw new Error('Funding history response is not an array')
	const byTimestamp = new Map<number, IndependentReversalFundingPayment>()
	for (const raw of rows as BinanceFundingRow[]) {
		const timestamp = Number(raw.fundingTime ?? raw.timestamp)
		const rate = Number(raw.fundingRate ?? raw.rate)
		const markPrice = Number(raw.markPrice)
		if (!Number.isSafeInteger(timestamp) || timestamp < 0) continue
		if (!Number.isFinite(rate) || !Number.isFinite(markPrice) || markPrice <= 0) continue
		byTimestamp.set(timestamp, { timestamp, rate, markPrice })
	}
	return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function cacheFile(symbol: string, fromMs: number, untilMs: number, cacheDir: string): string {
	return join(cacheDir, `${archiveSymbol(symbol)}-${fromMs}-${untilMs}.json`)
}

function monthIds(fromMs: number, untilMs: number): string[] {
	const out: string[] = []
	const from = new Date(fromMs)
	let year = from.getUTCFullYear()
	let month = from.getUTCMonth()
	while (Date.UTC(year, month, 1) < untilMs) {
		out.push(`${year}-${String(month + 1).padStart(2, '0')}`)
		month++
		if (month === 12) { month = 0; year++ }
	}
	return out
}

export function parseFundingArchiveCsv(text: string): Array<{ timestamp: number; rate: number }> {
	const out: Array<{ timestamp: number; rate: number }> = []
	for (const line of text.split('\n')) {
		const columns = line.trim().split(',')
		if (!columns[0] || !/^\d+$/.test(columns[0])) continue
		const timestamp = Number(columns[0])
		const rate = Number(columns[2])
		if (Number.isSafeInteger(timestamp) && Number.isFinite(rate)) out.push({ timestamp, rate })
	}
	return out
}

export function parseMarkPriceArchiveCsv(text: string): Array<{ timestamp: number; markPrice: number }> {
	const out: Array<{ timestamp: number; markPrice: number }> = []
	for (const line of text.split('\n')) {
		const columns = line.trim().split(',')
		if (!columns[0] || !/^\d+$/.test(columns[0])) continue
		const timestamp = Number(columns[0])
		const markPrice = Number(columns[1])
		if (Number.isSafeInteger(timestamp) && Number.isFinite(markPrice) && markPrice > 0) out.push({ timestamp, markPrice })
	}
	return out
}

async function fetchArchiveZip(fetchImpl: typeof fetch, url: string): Promise<string | null> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await fetchImpl(url)
		if (response.status === 404) return null
		if (response.ok) return unzipCsv(Buffer.from(await response.arrayBuffer()))
		if (attempt === 2 || (response.status < 500 && response.status !== 429)) {
			throw new Error(`Funding archive request failed: HTTP ${response.status}`)
		}
		await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
	}
	return null
}

async function fetchArchivedFundingHistory(
	fetchImpl: typeof fetch,
	symbol: string,
	fromMs: number,
	untilMs: number,
): Promise<IndependentReversalFundingPayment[] | null> {
	const rows: IndependentReversalFundingPayment[] = []
	for (const month of monthIds(fromMs, untilMs)) {
		const fundingUrl = `${ARCHIVE_BASE_URL}/fundingRate/${symbol}/${symbol}-fundingRate-${month}.zip`
		const markUrl = `${ARCHIVE_BASE_URL}/markPriceKlines/${symbol}/8h/${symbol}-8h-${month}.zip`
		const [fundingCsv, markCsv] = await Promise.all([
			fetchArchiveZip(fetchImpl, fundingUrl),
			fetchArchiveZip(fetchImpl, markUrl),
		])
		if (fundingCsv == null || markCsv == null) return null
		const markByInterval = new Map(parseMarkPriceArchiveCsv(markCsv).map((row) => [row.timestamp, row.markPrice]))
		for (const payment of parseFundingArchiveCsv(fundingCsv)) {
			const intervalStart = Math.floor(payment.timestamp / 28_800_000) * 28_800_000
			const markPrice = markByInterval.get(intervalStart)
			if (payment.timestamp >= fromMs && payment.timestamp < untilMs && markPrice != null) {
				rows.push({ timestamp: payment.timestamp, rate: payment.rate, markPrice })
			}
		}
	}
	return parseBinanceFundingRows(rows)
}

async function fetchPage(
	fetchImpl: typeof fetch,
	symbol: string,
	startTime: number,
	endTime: number,
): Promise<IndependentReversalFundingPayment[]> {
	const url = new URL(FUNDING_URL)
	url.searchParams.set('symbol', symbol)
	url.searchParams.set('startTime', String(startTime))
	url.searchParams.set('endTime', String(endTime))
	url.searchParams.set('limit', String(MAX_PAGE_SIZE))
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await fetchImpl(url)
		if (response.ok) return parseBinanceFundingRows(await response.json())
		if (attempt === 2 || (response.status < 500 && response.status !== 429)) {
			throw new Error(`Funding history request failed: HTTP ${response.status}`)
		}
		await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
	}
	return []
}

/**
 * Fetches Binance USD-M funding settlements in the half-open UTC interval
 * [fromMs, untilMs). Pagination is chronological and advances by the final
 * returned funding timestamp, so no assumed 8-hour cadence is baked in.
 */
export async function fetchFundingHistory(
	symbol: string,
	fromMs: number,
	untilMs: number,
	options: FundingFetchOptions = {},
): Promise<IndependentReversalFundingPayment[]> {
	if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(untilMs) || fromMs < 0 || fromMs >= untilMs) {
		throw new Error('Funding history requires a valid [fromMs, untilMs) interval')
	}
	const normalizedSymbol = archiveSymbol(symbol)
	const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR
	const file = cacheFile(normalizedSymbol, fromMs, untilMs, cacheDir)
	if (options.useCache !== false && existsSync(file)) {
		try {
			const payload = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion?: number; rows?: unknown }
			if (payload.schemaVersion === CACHE_SCHEMA_VERSION) {
				const cached = parseBinanceFundingRows(payload.rows)
				return cached.filter((row) => row.timestamp >= fromMs && row.timestamp < untilMs)
			}
		} catch {
			// Corrupt/incompatible cache is replaced from the source.
		}
	}

	const fetchImpl = options.fetchImpl ?? fetch
	const preferApi = options.preferApi === true
	const archived = !preferApi && untilMs - fromMs >= 31 * 86_400_000
		? await fetchArchivedFundingHistory(fetchImpl, normalizedSymbol, fromMs, untilMs)
		: null
	if (archived != null) {
		if (options.useCache !== false) {
			mkdirSync(cacheDir, { recursive: true })
			writeFileSync(file, JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, symbol: normalizedSymbol, fromMs, untilMs, rows: archived }))
		}
		return archived
	}
	if (!preferApi && untilMs - fromMs >= 31 * 86_400_000) {
		throw new Error(`Complete archived funding history is unavailable for ${normalizedSymbol}`)
	}

	const byTimestamp = new Map<number, IndependentReversalFundingPayment>()
	let cursor = fromMs
	for (let guard = 0; cursor < untilMs && guard < 10_000; guard++) {
		const page = await fetchPage(fetchImpl, normalizedSymbol, cursor, untilMs - 1)
		for (const payment of page) {
			if (payment.timestamp >= fromMs && payment.timestamp < untilMs) byTimestamp.set(payment.timestamp, payment)
		}
		if (page.length < MAX_PAGE_SIZE) break
		const lastTimestamp = page.at(-1)?.timestamp
		if (lastTimestamp == null || lastTimestamp < cursor) throw new Error('Funding history pagination did not advance')
		cursor = lastTimestamp + 1
	}
	const rows = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp)
	if (options.useCache !== false) {
		mkdirSync(cacheDir, { recursive: true })
		writeFileSync(file, JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, symbol: normalizedSymbol, fromMs, untilMs, rows }))
	}
	return rows
}
