/**
 * D6-partial — PREPARE: фиксация данных 12 мажоров в data/d6-partial (до reveal).
 * Свечи 1h (полная история, кэш preheat) + funding (кэш census) → файлы + SHA-256 + манифест.
 * Аудит рядов (пропуски часов) записывается в манифест БЕЗ выбраковки — консистентно с census
 * (prereg §1). Запуск: npx tsx ci/research/runD6PartialPrepare.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const MAJORS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT',
	'ADAUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'DOTUSDT', 'TRXUSDT',
]
const FAPI = 'https://fapi.binance.com'
const HOUR = 3_600_000
const DATA_DIR = 'data/d6-partial'
const MANIFEST_PATH = `${DATA_DIR}/manifest.json`

const sha256 = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex')
const fileHash = (p: string): string => sha256(readFileSync(resolve(p)))
const iso = (x: number): string => new Date(x).toISOString()

interface SettledFunding { timestamp: number; rate: number; markPrice: number }

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response
		try { res = await fetch(url, { signal: AbortSignal.timeout(20_000) }) } catch (e) { if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue } throw e }
		if (res.ok) return await res.json() as T
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue }
		throw new Error(`HTTP ${res.status}`)
	}
}

function auditCandles(candles: readonly Candle[]): { rows: number; firstUtc: string; lastUtc: string; missingHourlyBars: number } {
	let missing = 0
	for (let i = 1; i < candles.length; i++) {
		const d = candles[i]!.timestamp - candles[i - 1]!.timestamp
		if (d > HOUR && d % HOUR === 0) missing += d / HOUR - 1
	}
	return { rows: candles.length, firstUtc: candles.length ? iso(candles[0]!.timestamp) : '', lastUtc: candles.length ? iso(candles[candles.length - 1]!.timestamp) : '', missingHourlyBars: missing }
}

async function main(): Promise<void> {
	mkdirSync(resolve(DATA_DIR), { recursive: true })
	const info = await getJson<{ symbols: Array<{ symbol: string; onboardDate: number }> }>(`${FAPI}/fapi/v1/exchangeInfo`)

	interface Entry { symbol: string; onboardUtc: string; candleFile: string; candleSha256: string; fundingFile: string; fundingSha256: string; fundingRows: number; audit: ReturnType<typeof auditCandles> }
	const entries: Entry[] = []
	for (const symbol of MAJORS) {
		const onboard = info.symbols.find((x) => x.symbol === symbol)?.onboardDate ?? Date.now() - 5 * 365 * 86_400_000
		const candles = await fetchArchiveKlines(symbol, '1h', 'futures', onboard, null)
		const candleFile = `${symbol}_1h.json`
		writeFileSync(resolve(DATA_DIR, candleFile), JSON.stringify(candles))
		const fundingCache = resolve(`tmp/d6-census-funding/${symbol}.json`)
		if (!existsSync(fundingCache)) throw new Error(`${symbol}: нет кэша funding (tmp/d6-census-funding) — сначала census`)
		const funding = JSON.parse(readFileSync(fundingCache, 'utf8')) as SettledFunding[]
		const fundingFile = `${symbol}-funding.json`
		writeFileSync(resolve(DATA_DIR, fundingFile), JSON.stringify(funding))
		const audit = auditCandles(candles)
		entries.push({ symbol, onboardUtc: iso(onboard), candleFile, candleSha256: fileHash(resolve(DATA_DIR, candleFile)), fundingFile, fundingSha256: fileHash(resolve(DATA_DIR, fundingFile)), fundingRows: funding.length, audit })
		console.log(`${symbol}: баров ${audit.rows} [${audit.firstUtc} .. ${audit.lastUtc}], пропусков часов ${audit.missingHourlyBars}, funding ${funding.length}`)
	}

	const manifest = {
		studyId: 'd6-partial',
		generatedAt: new Date().toISOString(),
		preregistrationPath: 'ci-results/d6-partial-preregistration.md',
		eventRule: { oiDrop: -0.15, priceDrop: -0.05, windowBars: 8, gapBars: 8, holdBars: 72, stop: 'flushLow-0.5*ATR200, стоп первым' },
		note: 'Ряды как в census (окна в барах ряда); пропуски часов зафиксированы в audit без выбраковки (prereg §1)',
		symbols: entries,
	}
	writeFileSync(resolve(MANIFEST_PATH), JSON.stringify(manifest, null, 2))
	console.log(`\nmanifest SHA-256: ${fileHash(MANIFEST_PATH)}`)
}

void main()
