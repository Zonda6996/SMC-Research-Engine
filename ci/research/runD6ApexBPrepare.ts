/**
 * D6-apex-B — PREPARE: фиксация 1h-рядов и funding 16 мид-капов Б в data/d6-apex-b (до reveal).
 * Символы — вселенная Б из census (≥20k баров). Источники — кэши census (свечи tmp/viz-archive-cache,
 * funding tmp/d6-census-funding). Манифест с SHA-256. Запуск: npx tsx ci/research/runD6ApexBPrepare.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const SYMBOLS = [
	'1000PEPEUSDT', 'AAVEUSDT', 'ARBUSDT', 'AVAXUSDT', 'BOMEUSDT', 'ENAUSDT',
	'ENSUSDT', 'ICPUSDT', 'LDOUSDT', 'ONDOUSDT', 'OPUSDT', 'STXUSDT',
	'SUIUSDT', 'TRBUSDT', 'ZECUSDT', 'ZENUSDT',
]
const FAPI = 'https://fapi.binance.com'
const HOUR = 3_600_000
const MIN_ROWS = 20_000
const OUT_DIR = 'data/d6-apex-b'
const MANIFEST_PATH = `${OUT_DIR}/manifest.json`

const sha256File = (p: string): string => createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
const iso = (x: number): string => new Date(x).toISOString()

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response
		try { res = await fetch(url, { signal: AbortSignal.timeout(20_000) }) } catch (e) { if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue } throw e }
		if (res.ok) return await res.json() as T
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue }
		throw new Error(`HTTP ${res.status}`)
	}
}

async function main(): Promise<void> {
	mkdirSync(resolve(OUT_DIR), { recursive: true })
	const info = await getJson<{ symbols: Array<{ symbol: string; onboardDate: number }> }>(`${FAPI}/fapi/v1/exchangeInfo`)
	const entries: Array<{ symbol: string; candleFile: string; candleSha256: string; fundingFile: string; fundingSha256: string; rows: number; firstUtc: string; lastUtc: string }> = []
	for (const symbol of SYMBOLS) {
		const onboard = info.symbols.find((x) => x.symbol === symbol)?.onboardDate ?? Date.now() - 5 * 365 * 86_400_000
		const candles = await fetchArchiveKlines(symbol, '1h', 'futures', onboard, null)
		if (candles.length < MIN_ROWS) throw new Error(`${symbol}: баров ${candles.length} < ${MIN_ROWS} — вселенная Б сломалась`)
		const candleFile = `${symbol}_1h.json`
		writeFileSync(resolve(OUT_DIR, candleFile), JSON.stringify(candles))
		const fundingCache = resolve(`tmp/d6-census-funding/${symbol}.json`)
		if (!existsSync(fundingCache)) throw new Error(`${symbol}: нет кэша funding`)
		const fundingFile = `${symbol}-funding.json`
		copyFileSync(fundingCache, resolve(OUT_DIR, fundingFile))
		entries.push({ symbol, candleFile, candleSha256: sha256File(resolve(OUT_DIR, candleFile)), fundingFile, fundingSha256: sha256File(resolve(OUT_DIR, fundingFile)), rows: candles.length, firstUtc: iso(candles[0]!.timestamp), lastUtc: iso(candles[candles.length - 1]!.timestamp) })
		console.log(`${symbol}: ${candles.length} баров`)
	}
	const manifest = {
		studyId: 'd6-apex-b',
		generatedAt: new Date().toISOString(),
		preregistrationPath: 'ci-results/d6-apex-b-preregistration.md',
		eventRule: { oiDropStandard: -0.15, oiDropSafe: -0.2, priceDrop: -0.05, windowHours: 8, gapHours: 8, holdHours: 72, stop: 'flushLow(8h)-0.5*ATR200, стоп первым', exit: 'таймаут 72ч (без reclaim)' },
		note: 'Вселенная Б (мид-капы census); apex-классы на этих символах ранее не считались',
		symbols: entries,
	}
	writeFileSync(resolve(MANIFEST_PATH), JSON.stringify(manifest, null, 2))
	console.log(`\nmanifest SHA-256: ${sha256File(MANIFEST_PATH)}`)
}

void main()
