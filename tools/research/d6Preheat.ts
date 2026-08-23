/**
 * D6 preheat — фоновая закачка данных для census-карты (без аналитики).
 * Качает в стандартные кэши: 1h-свечи → tmp/viz-archive-cache, OI-метрики (5m, по дням) → .cache/binance.
 * Режимы (env D6_PREHEAT): 'majors' — вселенная А; 'extended' — ранг по обороту 24ч (фьючерсы USDT),
 * исключая А и сожжённых для D6-класса, порог D6_VOL_MIN (USD), верх D6_TOP_N.
 * Возобновляемо: существующие файлы кэшей пропускаются. Funding не качается (быстрый REST на месте).
 * Запуск: D6_PREHEAT=majors npx tsx tools/research/d6Preheat.ts
 */
import { readFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../shared/archiveKlines.js'
import { fetchArchiveMetrics } from '../shared/archiveMetrics.js'

const HOUR = 3_600_000
const DAY = 86_400_000
const MODE = (process.env.D6_PREHEAT ?? 'majors').toLowerCase()
const VOL_MIN = Number(process.env.D6_VOL_MIN ?? 20e6)
const TOP_N = Number(process.env.D6_TOP_N ?? 150)
const TF = process.env.D6_TF ?? '1h'

const MAJORS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT',
	'ADAUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'DOTUSDT', 'TRXUSDT',
]

interface ManifestLike { symbols: Array<{ symbol: string }> }

function burnedD6(): Set<string> {
	const out = new Set<string>(MAJORS)
	for (const p of ['data/own2-thin-bigcorpus/manifest.json', 'data/d6-mgmt/manifest.json', 'data/d6-tp/manifest.json']) {
		try {
			const m = JSON.parse(readFileSync(p, 'utf8')) as ManifestLike
			for (const s of m.symbols) out.add(s.symbol)
		} catch { /* манифест мог не существовать — не блокируем закачку */ }
	}
	return out
}

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response
		try { res = await fetch(url, { signal: AbortSignal.timeout(20_000) }) } catch (e) { if (attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue } throw e }
		if (res.ok) return await res.json() as T
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue }
		throw new Error(`HTTP ${res.status} ${url}`)
	}
}

async function extendedUniverse(): Promise<string[]> {
	interface Ticker { symbol: string; quoteVolume: string; onboardDate?: number }
	const tickers = await getJson<Ticker[]>('https://fapi.binance.com/fapi/v1/ticker/24hr')
	const excluded = burnedD6()
	const rows = tickers
		.filter((t) => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
		.map((t) => ({ symbol: t.symbol, vol: Number(t.quoteVolume) }))
		.filter((t) => Number.isFinite(t.vol) && t.vol >= VOL_MIN && !excluded.has(t.symbol))
		.sort((a, b) => b.vol - a.vol)
		.slice(0, TOP_N)
	return rows.map((r) => r.symbol)
}

async function main(): Promise<void> {
	const symbols = MODE === 'extended' ? await extendedUniverse() : MAJORS
	console.log(`[preheat:${MODE}] символов ${symbols.length}; TF ${TF}; старт ${new Date().toISOString()}`)
	const t0 = Date.now()
	for (let i = 0; i < symbols.length; i++) {
		const sym = symbols[i]!
		const ts = Date.now()
		try {
			const info = await getJson<{ symbols: Array<{ symbol: string; onboardDate: number }> }>('https://fapi.binance.com/fapi/v1/exchangeInfo')
			const onboard = info.symbols.find((x) => x.symbol === sym)?.onboardDate ?? Date.now() - 4 * 365 * DAY
			const candles = await fetchArchiveKlines(sym, TF, 'futures', onboard, null)
			const first = candles.length ? candles[0]!.timestamp : onboard
			const last = candles.length ? candles[candles.length - 1]!.timestamp + HOUR : Date.now()
			const points = await fetchArchiveMetrics(sym, first, last)
			console.log(`[preheat:${MODE}] (${i + 1}/${symbols.length}) ${sym}: свечей ${candles.length}, метрик ${points.length}, ${Math.round((Date.now() - ts) / 1000)}с`)
		} catch (e) {
			console.log(`[preheat:${MODE}] (${i + 1}/${symbols.length}) ${sym}: ОШИБКА ${(e as Error).message}; продолжаю со следующим`)
		}
	}
	console.log(`[preheat:${MODE}] готово за ${Math.round((Date.now() - t0) / 60000)} мин`)
}

void main()
