/**
 * D6-mgmt — ранжирование СВЕЖЕЙ вселенной для будущей preregistration управления (стопы/выходы).
 * Правило то же, что в own2-thin-bigcorpus (prereg §2 + amendment №1), НОВОЕ: исключаем также
 * все 25 символов корпуса (сожжены для D6-класса гипотез). Никаких исходов — только ранги оборота.
 * Запуск: npx tsx ci/research/runD6MgmtUniverseRank.ts
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CUTOFF = Date.parse('2026-08-22T00:00:00.000Z')
const YEAR = 365 * 86_400_000
const TOP_N = 80
const OUT_DIR = 'data/d6-mgmt'
const MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'

const TOUCHED = new Set([
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
	'DOGEUSDT', 'AAVEUSDT', 'ARBUSDT', 'ENAUSDT', 'OPUSDT', 'SUIUSDT',
	'LDOUSDT', 'AVAXUSDT', 'ONDOUSDT', 'VIRTUALUSDT',
	'ADAUSDT', 'LINKUSDT', 'ZECUSDT', '1000PEPEUSDT', 'BOMEUSDT',
])

interface ExchangeInfoSymbol { symbol: string; status: string; contractType: string; quoteAsset: string; onboardDate: number }

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url)
		if (res.ok) return await res.json() as T
		if (attempt < 4) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue }
		throw new Error(`GET ${url} -> HTTP ${res.status}`)
	}
}

async function main(): Promise<void> {
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string }> }
	const corpusBurned = new Set(manifest.symbols.map((s) => s.symbol))
	const excluded = new Set([...TOUCHED, ...corpusBurned])

	const info = await getJson<{ symbols: ExchangeInfoSymbol[] }>('https://fapi.binance.com/fapi/v1/exchangeInfo')
	const eligible = info.symbols.filter((s) =>
		s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING'
		&& !excluded.has(s.symbol) && Number.isSafeInteger(s.onboardDate) && s.onboardDate <= CUTOFF - YEAR)

	const ranked: Array<{ symbol: string; onboardDate: number; quoteVolume30d: number }> = []
	for (const s of eligible) {
		try {
			const rows = await getJson<unknown[]>(`https://fapi.binance.com/fapi/v1/klines?symbol=${s.symbol}&interval=1d&limit=30&endTime=${CUTOFF - 1}`)
			let total = 0
			for (const row of rows) {
				if (!Array.isArray(row)) continue
				const qv = Number(row[7])
				if (Number.isFinite(qv)) total += qv
			}
			ranked.push({ symbol: s.symbol, onboardDate: s.onboardDate, quoteVolume30d: total })
		} catch (e) {
			console.log(`skip ${s.symbol}: ${(e as Error).message}`)
		}
	}
	ranked.sort((a, b) => b.quoteVolume30d - a.quoteVolume30d || a.symbol.localeCompare(b.symbol))
	const top = ranked.slice(0, TOP_N)

	mkdirSync(resolve(OUT_DIR), { recursive: true })
	const payload = {
		generatedAt: new Date().toISOString(),
		cutoffUtc: new Date(CUTOFF).toISOString(),
		note: 'ranking only, no outcomes; excludes touched list + all 25 big-corpus symbols (burned)',
		excludedCount: excluded.size,
		candidatesConsidered: eligible.length,
		top,
		rankingSha256Note: createHash('sha256').update(JSON.stringify(top)).digest('hex'),
	}
	writeFileSync(resolve(OUT_DIR, 'universe-ranking.json'), JSON.stringify(payload, null, 2))
	console.log(`Кандидатов: ${eligible.length}; исключено (touched+корпус): ${excluded.size}`)
	console.log('Топ-20 свежих по обороту:')
	for (const [i, r] of top.entries()) console.log(`${String(i + 1).padStart(2)}. ${r.symbol.padEnd(16)} vol30d=${(r.quoteVolume30d / 1e6).toFixed(1)}M`)
}

void main()
