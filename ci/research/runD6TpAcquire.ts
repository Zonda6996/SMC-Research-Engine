/**
 * D6-tp — ACQUISITION (следующие 12 symbol-fresh перпов, до любых исходов).
 *
 * Walk-down по data/d6-mgmt/universe-ranking.json, исключая touched + 25 корпуса + 12 из
 * d6-mgmt; candle-QA тот же. Свечи — архивы, funding — официальный REST.
 *
 * Preregistration SHA-256: 6b6f7465226d413dc4afd7377e410de9b14bb0ac648c4c50ebde83ce347b4862
 * Запуск: npx tsx ci/research/runD6TpAcquire.ts
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const PREREG_PATH = 'ci-results/d6-tp-preregistration.md'
const PREREG_SHA256 = '6b6f7465226d413dc4afd7377e410de9b14bb0ac648c4c50ebde83ce347b4862'
const RANKING_PATH = 'data/d6-mgmt/universe-ranking.json'
const RANKING_SHA256 = '77f9ee76e0d951b205934f33e99e7e77ddc9a1303b00e2d4c1a41a9a2841b650'
const MGMT_MANIFEST_PATH = 'data/d6-mgmt/manifest.json'
const MGMT_MANIFEST_SHA256 = '5ed29eb914d138349040de555ee7ef4560f3107dd2a9cded21eef243f9cb50d6'
const CORPUS_MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'
const DATA_DIR = 'data/d6-tp'
const MANIFEST_PATH = `${DATA_DIR}/manifest.json`
const FAPI = 'https://fapi.binance.com'
const HOUR = 3_600_000
const CUTOFF = Date.parse('2026-08-22T00:00:00.000Z')
const TARGET_SYMBOLS = 12
const MIN_ROWS = 20_000
const MARK_INTERVAL_8H = 28_800_000

/** Touched-список корпуса (prereg own2-thin §2). */
const TOUCHED = new Set([
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
	'DOGEUSDT', 'AAVEUSDT', 'ARBUSDT', 'ENAUSDT', 'OPUSDT', 'SUIUSDT',
	'LDOUSDT', 'AVAXUSDT', 'ONDOUSDT', 'VIRTUALUSDT',
	'ADAUSDT', 'LINKUSDT', 'ZECUSDT', '1000PEPEUSDT', 'BOMEUSDT',
])

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))
const iso = (x: number): string => new Date(x).toISOString()

interface RankingEntry { symbol: string; onboardDate: number; quoteVolume30d: number }

interface CandleAudit {
	rows: number; firstUtc: string; lastUtc: string; monotonic: boolean
	duplicateTimestamps: number; missingHourlyBars: number; irregularIntervals: number
	ohlcInvalid: number; volumeInvalid: number; exactHourAligned: boolean
}

function auditCandles(candles: readonly Candle[]): CandleAudit {
	let monotonic = true
	let duplicateTimestamps = 0
	let missingHourlyBars = 0
	let irregularIntervals = 0
	let ohlcInvalid = 0
	let volumeInvalid = 0
	let exactHourAligned = true
	for (let i = 0; i < candles.length; i++) {
		const c = candles[i]!
		if (c.timestamp % HOUR !== 0) exactHourAligned = false
		if (!(c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close) && c.low <= c.high)) ohlcInvalid++
		if (!(c.volume >= 0)) volumeInvalid++
		if (i > 0) {
			const delta = c.timestamp - candles[i - 1]!.timestamp
			if (delta <= 0) monotonic = false
			if (delta === 0) duplicateTimestamps++
			if (delta !== HOUR) {
				irregularIntervals++
				if (delta > HOUR && delta % HOUR === 0) missingHourlyBars += delta / HOUR - 1
			}
		}
	}
	return {
		rows: candles.length,
		firstUtc: candles.length ? iso(candles[0]!.timestamp) : '',
		lastUtc: candles.length ? iso(candles[candles.length - 1]!.timestamp) : '',
		monotonic,
		duplicateTimestamps,
		missingHourlyBars,
		irregularIntervals,
		ohlcInvalid,
		volumeInvalid,
		exactHourAligned,
	}
}

function qaDropReasons(audit: CandleAudit): string[] {
	const reasons: string[] = []
	if (audit.rows < MIN_ROWS) reasons.push(`rows<${MIN_ROWS}`)
	if (!audit.monotonic) reasons.push('non-monotonic')
	if (audit.duplicateTimestamps > 0) reasons.push('duplicate-timestamps')
	if (audit.missingHourlyBars > 0) reasons.push(`missing-hourly-bars=${audit.missingHourlyBars}`)
	if (audit.irregularIntervals > 0) reasons.push(`irregular-intervals=${audit.irregularIntervals}`)
	if (audit.ohlcInvalid > 0) reasons.push(`ohlc-invalid=${audit.ohlcInvalid}`)
	if (audit.volumeInvalid > 0) reasons.push(`volume-invalid=${audit.volumeInvalid}`)
	if (!audit.exactHourAligned) reasons.push('not-hour-aligned')
	return reasons
}

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response
		try { res = await fetch(url) } catch (e) { if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue } throw e }
		if (res.ok) return await res.json() as T
		if (attempt < 3 && (res.status >= 500 || res.status === 429)) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue }
		throw new Error(`GET ${url} -> HTTP ${res.status}`)
	}
}

/** Транзиентные сетевые отказы (обрывы соединения) не должны ронять длинный walk-down. */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try { return await fn() } catch (e) {
			if (attempt >= 3) throw e
			const cause = (e as { cause?: unknown }).cause
			console.log(`${label}: сеть, повтор ${attempt + 1}/3 (${cause instanceof Error ? cause.message : (e as Error).message})`)
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
		}
	}
}

async function fetchRawPages<T>(firstStartMs: number, untilMs: number, buildUrl: (startMs: number) => string, rowTimestamp: (row: T) => number): Promise<T[]> {
	const out: T[] = []
	let cursor = firstStartMs
	for (let guard = 0; cursor < untilMs && guard < 20_000; guard++) {
		const raw = await getJson<unknown[]>(buildUrl(cursor))
		out.push(...raw as T[])
		if (raw.length < 1000) break
		const lastTs = rowTimestamp(raw[raw.length - 1] as T)
		if (!Number.isSafeInteger(lastTs) || lastTs + 1 <= cursor) throw new Error('Pagination stuck')
		cursor = lastTs + 1
	}
	return out
}

interface RawFundingRow { fundingTime: number | string; fundingRate: number | string }
interface SettledFunding { timestamp: number; rate: number; markPrice: number }

async function fetchFundingSettled(symbol: string, fromMs: number, untilMs: number): Promise<{ rows: SettledFunding[]; skippedNoMark: number }> {
	const fundRaw = await fetchRawPages<RawFundingRow>(
		fromMs,
		untilMs,
		(start) => `${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${untilMs - 1}&limit=1000`,
		(row) => Math.floor(Number(row.fundingTime)),
	)
	const markRaw = await fetchRawPages<unknown[]>(
		fromMs,
		untilMs,
		(start) => `${FAPI}/fapi/v1/markPriceKlines?symbol=${symbol}&interval=8h&startTime=${start}&endTime=${untilMs - 1}&limit=1000`,
		(row) => Number(Array.isArray(row) ? row[0] : NaN),
	)
	const markByInterval = new Map<number, number>()
	for (const row of markRaw) {
		if (!Array.isArray(row)) continue
		const openTime = Number(row[0])
		const open = Number(row[1])
		if (Number.isSafeInteger(openTime) && Number.isFinite(open) && open > 0) markByInterval.set(Math.floor(openTime / MARK_INTERVAL_8H) * MARK_INTERVAL_8H, open)
	}
	const rows: SettledFunding[] = []
	let skippedNoMark = 0
	for (const raw of fundRaw) {
		const timestamp = Math.floor(Number(raw.fundingTime))
		const rate = Number(raw.fundingRate)
		if (!Number.isSafeInteger(timestamp) || !Number.isFinite(rate)) continue
		if (timestamp < fromMs || timestamp >= untilMs) continue
		const markPrice = markByInterval.get(Math.floor(timestamp / MARK_INTERVAL_8H) * MARK_INTERVAL_8H)
		if (markPrice == null) { skippedNoMark++; continue }
		rows.push({ timestamp, rate, markPrice })
	}
	rows.sort((a, b) => a.timestamp - b.timestamp)
	return { rows, skippedNoMark }
}

async function main(): Promise<void> {
	for (const [path, expected] of [[PREREG_PATH, PREREG_SHA256], [RANKING_PATH, RANKING_SHA256], [MGMT_MANIFEST_PATH, MGMT_MANIFEST_SHA256]] as const) {
		if (fileHash(path) !== expected) throw new Error(`Immutable hash mismatch: ${path}`)
	}
	mkdirSync(resolve(DATA_DIR), { recursive: true })

	const ranking = JSON.parse(readFileSync(resolve(RANKING_PATH), 'utf8')) as { top: RankingEntry[] }
	const mgmtManifest = JSON.parse(readFileSync(resolve(MGMT_MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string }> }
	const corpusManifest = JSON.parse(readFileSync(resolve(CORPUS_MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string }> }
	const excluded = new Set<string>([
		...TOUCHED,
		...corpusManifest.symbols.map((s) => s.symbol),
		...mgmtManifest.symbols.map((s) => s.symbol),
	])

	interface SymbolEntry extends RankingEntry { candleFile: string; candleSha256: string; audit: CandleAudit; fundingFile: string; fundingSha256: string; fundingRows: number; fundingSkippedNoMark: number }
	const entries: SymbolEntry[] = []
	const skipped: Array<{ symbol: string; reasons: string[] }> = []

	for (const pick of ranking.top) {
		if (entries.length >= TARGET_SYMBOLS) break
		if (excluded.has(pick.symbol)) continue
		console.log(`${pick.symbol}: качаю свечи …`)
		const raw = await withRetry(pick.symbol, () => fetchArchiveKlines(pick.symbol, '1h', 'futures', pick.onboardDate, CUTOFF))
		const candles = raw.filter((c) => c.timestamp + HOUR <= CUTOFF)
		const audit = auditCandles(candles)
		const reasons = qaDropReasons(audit)
		if (reasons.length > 0) {
			skipped.push({ symbol: pick.symbol, reasons })
			console.log(`skip ${pick.symbol}: баров ${audit.rows} → ${reasons.join(', ')}`)
			continue
		}
		const candleFile = `${pick.symbol}_1h.json`
		writeFileSync(resolve(DATA_DIR, candleFile), JSON.stringify(candles))
		console.log(`${pick.symbol}: качаю funding …`)
		const { rows: fundingRows, skippedNoMark } = await fetchFundingSettled(pick.symbol, candles[0]!.timestamp, CUTOFF)
		const fundingFile = `${pick.symbol}-funding.json`
		writeFileSync(resolve(DATA_DIR, fundingFile), JSON.stringify(fundingRows))
		entries.push({ ...pick, candleFile, candleSha256: fileHash(resolve(DATA_DIR, candleFile)), audit, fundingFile, fundingSha256: fileHash(resolve(DATA_DIR, fundingFile)), fundingRows: fundingRows.length, fundingSkippedNoMark: skippedNoMark })
		console.log(`+ ${pick.symbol}: баров ${audit.rows} [${audit.firstUtc} .. ${audit.lastUtc}], funding ${fundingRows.length}${skippedNoMark ? ` (без mark: ${skippedNoMark})` : ''}`)
	}

	if (entries.length < TARGET_SYMBOLS) throw new Error(`Walk-down дал только ${entries.length} символов → расширять ранг`)

	const manifest = {
		studyId: 'd6-tp',
		generatedAt: new Date().toISOString(),
		preregistrationPath: PREREG_PATH,
		preregistrationSha256: PREREG_SHA256,
		rankingPath: RANKING_PATH,
		rankingSha256: RANKING_SHA256,
		excludedSources: ['touched list', 'own2-thin-bigcorpus (25)', 'd6-mgmt (12)'],
		cutoffUtc: iso(CUTOFF),
		targetSymbols: TARGET_SYMBOLS,
		minRowsPerSymbol: MIN_ROWS,
		symbols: entries,
		skippedCandidates: skipped,
	}
	writeFileSync(resolve(MANIFEST_PATH), JSON.stringify(manifest, null, 2))
	console.log(`\nmanifest SHA-256: ${fileHash(MANIFEST_PATH)}`)
	console.log(`Вселенная (${entries.length}): ${entries.map((e) => e.symbol).join(', ')}`)
}

void main()
