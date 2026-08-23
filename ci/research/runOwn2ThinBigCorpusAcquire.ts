/**
 * OWN2-thinned big-corpus — ACQUISITION (до любых исходов).
 *
 * Собирает вселенную по замороженному правилу (preregistration §2): Binance USD-M perps
 * PERPETUAL/USDT/TRADING, листинг >12 мес на cutoff, минус явно тронутые символы, топ-25
 * по trailing-30д обороту. Полная история 1h до cutoff из официальных архивов
 * data.binance.vision + фактический funding (fapi). QA-дропы механические (§3), подмены запрещены.
 * Артефакты: data/own2-thin-bigcorpus/{manifest.json,acquisition-freeze.md,<SYM>_1h.json,<SYM>-funding.json}.
 * Хеш манифеста печатается в консоль для пинования в калибровочном и reveal-раннерах.
 *
 * Preregistration SHA-256: fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886
 * Amendment №1 SHA-256: 6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40
 *   (walk-down до 25 QA-выживших вместо «топ-25 затем дропы»; funding через preferApi REST).
 * Запуск: npx tsx ci/research/runOwn2ThinBigCorpusAcquire.ts
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APEX_VERSION } from '../../src/core/signals/ApexEngine.js'
import { ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_TRADE_REPLAY_VERSION } from '../../src/core/signals/ArrowTradeReplay.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { SettledFunding } from './lib/own2FundingSignResearch.js'

const HOUR = 3_600_000
const DAY = 86_400_000
const YEAR = 365 * DAY
const CUTOFF = Date.parse('2026-08-22T00:00:00.000Z')
const UNIVERSE_SIZE = 25
const MIN_ROWS = 20_000
const PREREG_PATH = 'ci-results/own2-thin-bigcorpus-preregistration.md'
const PREREG_SHA256 = 'fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886'
const AMENDMENT_PATH = 'ci-results/own2-thin-bigcorpus-amendment-1.md'
const AMENDMENT_SHA256 = '6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40'
const DATA_DIR = 'data/own2-thin-bigcorpus'
const MANIFEST_PATH = `${DATA_DIR}/manifest.json`
const FREEZE_PATH = `${DATA_DIR}/acquisition-freeze.md`
const FAPI = 'https://fapi.binance.com'

/** Символы, тронутые прежними исследованиями (preregistration §2, полный явный список). */
const TOUCHED = new Set([
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
	'DOGEUSDT', 'AAVEUSDT', 'ARBUSDT', 'ENAUSDT', 'OPUSDT', 'SUIUSDT',
	'LDOUSDT', 'AVAXUSDT', 'ONDOUSDT', 'VIRTUALUSDT',
	'ADAUSDT', 'LINKUSDT', 'ZECUSDT', '1000PEPEUSDT', 'BOMEUSDT',
])

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))
const iso = (x: number): string => new Date(x).toISOString()
const skippedNoMarkNote = (e: SymbolEntry): string => e.fundingSkippedNoMark > 0 ? ` (без mark-цены пропущено ${e.fundingSkippedNoMark})` : ''

interface ExchangeInfoSymbol {
	symbol: string
	status: string
	contractType: string
	quoteAsset: string
	onboardDate: number
}

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url)
		if (res.ok) return await res.json() as T
		if (attempt < 4) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue }
		throw new Error(`GET ${url} -> HTTP ${res.status}`)
	}
}

/** Trailing-30д оборот: сумма quoteVolume дневных свечей [cutoff−30d, cutoff). */
async function trailing30dQuoteVolume(symbol: string): Promise<number> {
	const rows = await getJson<unknown[]>(`${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=30&endTime=${CUTOFF - 1}`)
	let total = 0
	for (const row of rows) {
		if (!Array.isArray(row)) continue
		const openTime = Number(row[0])
		const quoteVolume = Number(row[7])
		if (Number.isSafeInteger(openTime) && Number.isFinite(quoteVolume)) total += quoteVolume
	}
	return total
}

const MARK_INTERVAL_8H = 28_800_000

/**
 * Пагинация официального REST по RAW-строкам (без фильтрации — иначе «page<limit»
 * ложно означает конец данных). advance — timestamp последней raw-строки + 1.
 */
async function fetchRawPages<T>(
	firstStartMs: number,
	untilMs: number,
	buildUrl: (startMs: number) => string,
	rowTimestamp: (row: T) => number,
): Promise<T[]> {
	const out: T[] = []
	let cursor = firstStartMs
	for (let guard = 0; cursor < untilMs && guard < 20_000; guard++) {
		let page: unknown
		for (let attempt = 0; ; attempt++) {
			const res = await fetch(buildUrl(cursor))
			if (res.ok) { page = await res.json(); break }
			if (attempt < 3 && (res.status >= 500 || res.status === 429)) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue }
			throw new Error(`HTTP ${res.status} for ${buildUrl(cursor)}`)
		}
		if (!Array.isArray(page)) throw new Error('Unexpected non-array response')
		out.push(...page as T[])
		if (page.length < 1000) break
		const lastTs = rowTimestamp(page.at(-1) as T)
		if (!Number.isSafeInteger(lastTs) || lastTs + 1 <= cursor) throw new Error('Pagination stuck')
		cursor = lastTs + 1
	}
	return out
}

interface RawFundingRow { fundingTime: number | string; fundingRate: number | string }

/**
 * Funding через официальный REST: settlements из fapi/v1/fundingRate; markPrice берётся из
 * fapi/v1/markPriceKlines(8h) склейкой по началу сеттлмент-интервала — та же семантика, что у
 * архивного пути tools/shared/fundingFetcher.ts (у REST fundingRate исторически markPrice пуст).
 */
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

interface CandleAudit {
	rows: number
	firstUtc: string
	lastUtc: string
	monotonic: boolean
	duplicateTimestamps: number
	missingHourlyBars: number
	irregularIntervals: number
	ohlcInvalid: number
	volumeInvalid: number
	exactHourAligned: boolean
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

interface RankedCandidate {
	symbol: string
	onboardDate: number
	quoteVolume30d: number
}

interface SymbolEntry extends RankedCandidate {
	candleFile: string
	candleSha256: string
	audit: CandleAudit
	dropped: boolean
	dropReasons: string[]
	fundingFile: string | null
	fundingSha256: string | null
	fundingRows: number
	fundingSkippedNoMark: number
	fundingError: string | null
}

async function main(): Promise<void> {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('Immutable preregistration hash mismatch')
	if (fileHash(AMENDMENT_PATH) !== AMENDMENT_SHA256) throw new Error('Immutable amendment hash mismatch')
	mkdirSync(resolve(DATA_DIR), { recursive: true })

	const info = await getJson<{ symbols: ExchangeInfoSymbol[] }>(`${FAPI}/fapi/v1/exchangeInfo`)
	const eligible = info.symbols.filter((s) =>
		s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING'
		&& !TOUCHED.has(s.symbol) && Number.isSafeInteger(s.onboardDate) && s.onboardDate <= CUTOFF - YEAR)
	console.log(`Кандидатов после фильтров и исключений: ${eligible.length}`)

	const ranked: RankedCandidate[] = []
	for (const s of eligible) {
		try {
			ranked.push({ symbol: s.symbol, onboardDate: s.onboardDate, quoteVolume30d: await trailing30dQuoteVolume(s.symbol) })
		} catch (e) {
			console.log(`skip ${s.symbol}: ${(e as Error).message}`)
		}
	}
	ranked.sort((a, b) => b.quoteVolume30d - a.quoteVolume30d || a.symbol.localeCompare(b.symbol))
	console.log(`Топ-5 по обороту: ${ranked.slice(0, 5).map((x) => x.symbol).join(', ')} … (кандидатов ${ranked.length})`)

	// Amendment №1: walk-down по ранжиру до 25 QA-выживших.
	const entries: SymbolEntry[] = []
	const skipped: Array<{ symbol: string; quoteVolume30d: number; reasons: string[] }> = []
	for (const pick of ranked) {
		if (entries.length >= UNIVERSE_SIZE) break
		const raw = await fetchArchiveKlines(pick.symbol, '1h', 'futures', pick.onboardDate, CUTOFF)
		// Только ПОЛНОСТЬЮ ЗАКРЫТЫЕ бары строго до cutoff.
		const candles = raw.filter((c) => c.timestamp + HOUR <= CUTOFF)
		const audit = auditCandles(candles)
		const dropReasons = qaDropReasons(audit)
		if (dropReasons.length > 0) {
			skipped.push({ symbol: pick.symbol, quoteVolume30d: pick.quoteVolume30d, reasons: dropReasons })
			console.log(`skip ${pick.symbol}: баров ${audit.rows} → ${dropReasons.join(', ')}`)
			continue
		}
		const candleFile = `${pick.symbol}_1h.json`
		writeFileSync(resolve(DATA_DIR, candleFile), JSON.stringify(candles))
		const entry: SymbolEntry = {
			...pick,
			candleFile,
			candleSha256: fileHash(resolve(DATA_DIR, candleFile)),
			audit,
			dropped: false,
			dropReasons: [],
			fundingFile: null,
			fundingSha256: null,
			fundingRows: 0,
			fundingSkippedNoMark: 0,
			fundingError: null,
		}
		try {
			const from = candles[0]!.timestamp
			const { rows, skippedNoMark } = await fetchFundingSettled(pick.symbol, from, CUTOFF)
			const fundingFile = `${pick.symbol}-funding.json`
			writeFileSync(resolve(DATA_DIR, fundingFile), JSON.stringify(rows))
			entry.fundingFile = fundingFile
			entry.fundingSha256 = fileHash(resolve(DATA_DIR, fundingFile))
			entry.fundingRows = rows.length
			entry.fundingSkippedNoMark = skippedNoMark
		} catch (e) {
			entry.fundingError = (e as Error).message
		}
		entries.push(entry)
		console.log(`+ ${pick.symbol}: баров ${audit.rows} [${audit.firstUtc} .. ${audit.lastUtc}]${entry.fundingError ? ` funding-ошибка: ${entry.fundingError}` : ` funding ${entry.fundingRows}${skippedNoMarkNote(entry)}`}`)
	}

	if (entries.length < UNIVERSE_SIZE) throw new Error(`Walk-down дал только ${entries.length} QA-выживших из всех кандидатов → BLOCKED DATA`)
	const survivors = entries

	const manifest = {
		studyId: 'own2-thin-bigcorpus',
		generatedAt: new Date().toISOString(),
		preregistrationPath: PREREG_PATH,
		preregistrationSha256: PREREG_SHA256,
		amendment1Path: AMENDMENT_PATH,
		amendment1Sha256: AMENDMENT_SHA256,
		engineVersions: { apex: APEX_VERSION, arrowSignal: ARROW_SIGNAL_VERSION, arrowTradeReplay: ARROW_TRADE_REPLAY_VERSION },
		cutoffUtc: iso(CUTOFF),
		universeRule: 'walk-down trailing-30d quote-volume ranking until 25 QA-survivors; PERPETUAL+USDT+TRADING, onboardDate<=cutoff-365d, minus touched list (amendment 1)',
		touchedExclusions: [...TOUCHED].sort(),
		candidatesConsidered: eligible.length,
		survivorCount: survivors.length,
		minRowsPerSymbol: MIN_ROWS,
		fundingTransport: 'REST fapi/v1/fundingRate + mark из fapi/v1/markPriceKlines(8h), join по началу сеттлмент-интервала (amendment 1; архивный путь неполон по свежим месяцам)',
		skippedCandidates: skipped,
		symbols: entries,
	}
	writeFileSync(resolve(MANIFEST_PATH), JSON.stringify(manifest, null, 2))

	const manifestHash = fileHash(MANIFEST_PATH)
	const freezeLines = [
		'# OWN2-thinned big-corpus — acquisition freeze (до любых исходов)',
		'',
		`- Cutoff данных: ${iso(CUTOFF)} (только полностью закрытые 1h-бары строго до cutoff).`,
		`- Кандидатов рассмотрено: ${eligible.length}; walk-down отобрал ${survivors.length} QA-выживших.`,
		`- Пропущено по QA до набора ${UNIVERSE_SIZE}: ${skipped.length} (${skipped.slice(0, 10).map((s) => s.symbol).join(', ')}${skipped.length > 10 ? ', …' : ''}).`,
		`- Тронутые исключения (${TOUCHED.size}): ${[...TOUCHED].sort().join(', ')}.`,
		`- Вселенная: ${survivors.map((e) => e.symbol).join(', ')}.`,
		`- Funding: у ${entries.filter((e) => e.fundingError == null).length}/${entries.length} символов загружен без ошибки; всего settlements ${entries.reduce((s, e) => s + e.fundingRows, 0)}, без mark-цены пропущено ${entries.reduce((s, e) => s + e.fundingSkippedNoMark, 0)}.`,
		`- Preregistration SHA-256: ${PREREG_SHA256}`,
		`- Amendment №1 SHA-256: ${AMENDMENT_SHA256}`,
		`- **manifest.json SHA-256: \`${manifestHash}\`** (пинуется в calibration/reveal раннерах).`,
	]
	writeFileSync(resolve(FREEZE_PATH), freezeLines.join('\n'))
	console.log(`\nmanifest SHA-256: ${manifestHash}`)
	console.log('Записано: manifest.json, acquisition-freeze.md, данные символов.')
}

main().catch((e) => { console.error(e); process.exit(1) })
