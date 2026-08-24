/**
 * D6-multitf — PREPARE: фиксация рядов всех ТФ в data/d6-multitf (до reveal).
 * 1h — копия из data/d6-partial (уже пинована), 2h/4h — точная агрегация 1h по UTC-вёдрам,
 * 5m/15m/30m — архивы (кэш preheat/multitf). Funding — копия из data/d6-partial.
 * Манифест с SHA-256 на каждый файл. Запуск: npx tsx ci/research/runD6MultiTfPrepare.ts
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const MAJORS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT',
	'ADAUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'DOTUSDT', 'TRXUSDT',
]
const TFS = ['1h', '2h', '4h', '5m', '15m', '30m'] as const
const HOUR = 3_600_000
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000 }
const PARTIAL_DIR = 'data/d6-partial'
const OUT_DIR = 'data/d6-multitf'
const MANIFEST_PATH = `${OUT_DIR}/manifest.json`

const sha256File = (p: string): string => createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
const iso = (x: number): string => new Date(x).toISOString()

function aggregate(candles: readonly Candle[], tfMs: number): Candle[] {
	const out: Candle[] = []
	let cur: Candle | null = null
	let curBucket = -1
	for (const c of candles) {
		const bucket = Math.floor(c.timestamp / tfMs) * tfMs
		if (bucket !== curBucket) {
			if (cur != null && curBucket >= 0 && curBucket + tfMs <= c.timestamp) out.push(cur)
			cur = { timestamp: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
			curBucket = bucket
		} else if (cur != null) {
			cur.high = Math.max(cur.high, c.high)
			cur.low = Math.min(cur.low, c.low)
			cur.close = c.close
			cur.volume += c.volume
		}
	}
	return out
}

async function main(): Promise<void> {
	mkdirSync(resolve(OUT_DIR), { recursive: true })
	const entries: Array<{ symbol: string; fundingFile: string; fundingSha256: string; tf: Record<string, { file: string; sha256: string; rows: number; firstUtc: string; lastUtc: string }> }> = []
	for (const symbol of MAJORS) {
		const tfMap: Record<string, { file: string; sha256: string; rows: number; firstUtc: string; lastUtc: string }> = {}
		const base1h: Candle[] = JSON.parse(readFileSync(resolve(PARTIAL_DIR, `${symbol}_1h.json`), 'utf8')) as Candle[]
		for (const tf of TFS) {
			const file = `${symbol}_${tf}.json`
			const target = resolve(OUT_DIR, file)
			if (tf === '1h') copyFileSync(resolve(PARTIAL_DIR, file), target)
			else if (tf === '2h' || tf === '4h') writeFileSync(target, JSON.stringify(aggregate(base1h, TF_MS[tf]!)))
			else {
				const rows = await fetchArchiveKlines(symbol, tf, 'futures', base1h[0]!.timestamp, null)
				writeFileSync(target, JSON.stringify(rows))
			}
			const rows: Candle[] = JSON.parse(readFileSync(target, 'utf8')) as Candle[]
			tfMap[tf] = { file, sha256: sha256File(target), rows: rows.length, firstUtc: rows.length ? iso(rows[0]!.timestamp) : '', lastUtc: rows.length ? iso(rows[rows.length - 1]!.timestamp) : '' }
			console.log(`${symbol} ${tf}: ${rows.length} баров`)
		}
		const fundingFile = `${symbol}-funding.json`
		copyFileSync(resolve(PARTIAL_DIR, fundingFile), resolve(OUT_DIR, fundingFile))
		entries.push({ symbol, fundingFile, fundingSha256: sha256File(resolve(OUT_DIR, fundingFile)), tf: tfMap })
	}

	const manifest = {
		studyId: 'd6-multitf',
		generatedAt: new Date().toISOString(),
		preregistrationPath: 'ci-results/d6-multitf-preregistration.md',
		eventRule: { oiDrop: -0.15, priceDrop: -0.05, windowHours: 8, gapHours: 8, holdHours: 72, stop: 'flushLow(8h)-0.5*ATR200(TF), стоп первым', exit: 'reclaim close>=close(8h назад) или таймаут 72ч' },
		symbols: entries,
	}
	writeFileSync(resolve(MANIFEST_PATH), JSON.stringify(manifest, null, 2))
	console.log(`\nmanifest SHA-256: ${sha256File(MANIFEST_PATH)}`)
}

void main()
