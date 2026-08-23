/**
 * D6 leverage-flow — PHASE 1: acquisition метрик + описательный census каскадных событий.
 *
 * Information set: Binance USD-M metrics archives (data.binance.vision, 5m гранула):
 * sumOpenInterest(Value) + taker buy/sell vol ratio — НЕ производные цены (плечевой поток).
 * Вселенная и свечи — из замороженного корпуса own2-thin-bigcorpus (25 символов, хеши пинуются).
 *
 * Правило-нейтральность (§2.1): census ничего не выбирает и не торгует. Сетка W×X×Y — КАРТА
 * частот событий; форвард-движения цены считаются ТОЛЬКО на development-срезе (календарные 65%
 * пула баров); OOS-хвост остаётся запечатанным до отдельной preregistration руки автором.
 *
 * Preregistration для самой руки будет отдельным документом (Фаза 2, ⚠ автор).
 * Запуск: npx tsx ci/research/runD6LeverageFlowCensus.ts   (кэш дней — .cache/binance, докачиваемый)
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'

const MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'
const MANIFEST_SHA256 = '5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50'
const DATA_DIR = 'data/own2-thin-bigcorpus'
const OUT_JSON = 'ci-results/d6-leverage-flow-census.json'
const OUT_MD = 'ci-results/d6-leverage-flow-census.md'
const HOUR = 3_600_000
const DEV_FRACTION = 0.65

/** Окно накопления ΔOI, часы. */
const WINDOWS_H = [4, 8, 12, 24]
/** Порог падения OI за окно. */
const DROPS = [0.05, 0.1, 0.15, 0.2]
/** Опциональное условие ценового флаша за то же окно. */
const PRICE_FLUSHES: Array<{ id: string; pct: number | null }> = [
	{ id: 'any', pct: null },
	{ id: 'p<=-3%', pct: -0.03 },
]
/** Горизонты форварда, бары 1h (только dev). */
const FORWARD_BARS = [1, 4, 12, 24]

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))

interface ManifestSymbol { symbol: string; candleFile: string; candleSha256: string; dropped: boolean }

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	if (!sorted.length) return NaN
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

async function main(): Promise<void> {
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('Immutable acquisition manifest hash mismatch')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: ManifestSymbol[] }
	const survivorsAll = manifest.symbols.filter((s) => !s.dropped)
	// Сокращение вселенной по решению автора (сетевые ограничения): только символы с уже
	// закэшированными метриками; выбор НЕ связан с исходами (кэш — единственный критерий).
	const requestedSymbols = process.env.D6_SYMBOLS?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
	const survivors = requestedSymbols?.length ? survivorsAll.filter((s) => requestedSymbols.includes(s.symbol)) : survivorsAll
	if (requestedSymbols?.length && survivors.length !== requestedSymbols.length) {
		throw new Error(`Неизвестные символы в D6_SYMBOLS: ${requestedSymbols.filter((r) => !survivors.some((s) => s.symbol === r)).join(', ')}`)
	}

	interface Loaded { symbol: string; candles: Candle[]; oi: Array<number | null>; takerBuy: Array<number | null>; covered: number; devLastIndex: number }
	const loaded: Loaded[] = []
	for (const entry of survivors) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash mismatch`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const from = candles[0]!.timestamp
		const until = candles[candles.length - 1]!.timestamp + HOUR
		const points = await fetchArchiveMetrics(entry.symbol, from, until)
		const aligned = alignArchiveMetrics(points, candles)
		loaded.push({ symbol: entry.symbol, candles, oi: aligned.oi, takerBuy: aligned.takerBuyRatio, covered: aligned.covered, devLastIndex: 0 })
		console.log(`${entry.symbol}: баров ${candles.length}, метрик ${points.length}, покрытие OI ${(aligned.covered / candles.length * 100).toFixed(1)}%`)
	}

	// Календарный dev/oos сплит: 65% квантиль всех таймстампов пулa (детерминированно).
	const allTs: number[] = []
	for (const item of loaded) for (const c of item.candles) allTs.push(c.timestamp)
	allTs.sort((a, b) => a - b)
	const cutoffTs = allTs[Math.floor(allTs.length * DEV_FRACTION)]!
	for (const item of loaded) {
		let last = -1
		for (let i = 0; i < item.candles.length; i++) if (item.candles[i]!.timestamp < cutoffTs) last = i
		item.devLastIndex = last
	}
	console.log(`\nDev/OOS календарный cutoff: ${new Date(cutoffTs).toISOString()} (65% пула баров)`)

	interface CellStat { nBarsEligible: number; nEvents: number; nEventsSpaced: number; per1000Bars: number; fwdMedianPct: Record<string, number>; fwdPositiveShare: Record<string, number>; takerBuyMedianAtEvent: number | null }

	const cellKey = (w: number, x: number, yId: string, side: 'oiDropLong' | 'oiDropShort'): string => `${side}|W${w}h|X${(x * 100).toFixed(0)}%|${yId}`
	const cells = new Map<string, CellStat>()
	const ensure = (key: string, eligible: number): CellStat => {
		let c = cells.get(key)
		if (!c) { c = { nBarsEligible: eligible, nEvents: 0, nEventsSpaced: 0, per1000Bars: 0, fwdMedianPct: {}, fwdPositiveShare: {}, takerBuyMedianAtEvent: null }; cells.set(key, c) }
		return c
	}

	const baseFwd: Record<string, number[]> = {}
	for (const h of FORWARD_BARS) baseFwd[`H${h}`] = []

	for (const item of loaded) {
		const closes = item.candles.map((c) => c.close)
		const devLast = item.devLastIndex
		const eligibleBars = Math.max(0, devLast + 1)

		// Базовые форвард-медианы dev-среза (референс для чтения карты).
		for (const h of FORWARD_BARS) {
			for (let i = 0; i + h <= devLast; i++) baseFwd[`H${h}`]!.push((closes[i + h]! / closes[i]! - 1) * 100)
		}

		for (const w of WINDOWS_H) {
			const wBars = w
			// Предвычисляем ΔOI и Δprice за окно (причинно: оба значения известны на баре i).
			const dOi: Array<number | null> = new Array(closes.length).fill(null)
			const dPrice: Array<number | null> = new Array(closes.length).fill(null)
			for (let i = wBars; i <= devLast; i++) {
				const oiNow = item.oi[i]
				const oiPast = item.oi[i - wBars]!
				dOi[i] = oiNow != null && oiPast != null && oiPast > 0 ? oiNow / oiPast - 1 : null
				dPrice[i] = closes[i]! / closes[i - wBars]! - 1
			}
			for (const x of DROPS) {
				for (const flush of PRICE_FLUSHES) {
					for (const side of ['oiDropLong', 'oiDropShort'] as const) {
						// oiDropLong: OI упал ≥X (делевериджинг) — потенциальный LONG после флаша вниз;
						// ценовое условие стороны: long требует флаша ВНИЗ, short — ВВЕРХ (зеркало).
						const stat = ensure(cellKey(w, x, flush.id, side), eligibleBars)
						const fwdByH: Record<string, number[]> = {}
						for (const h of FORWARD_BARS) fwdByH[`H${h}`] = []
						const takerAtEvent: number[] = []
						let lastAdmitted = -Infinity
						for (let i = wBars; i <= devLast; i++) {
							const d = dOi[i]!
							if (d == null || d > -x) continue
							const p = dPrice[i]!
							if (flush.pct != null && !(p <= flush.pct)) continue
							if (side === 'oiDropShort') continue // короткая сторона в этой ячейке считается зеркальной сеткой ниже
							stat.nEvents++
							if (i - lastAdmitted >= wBars) { stat.nEventsSpaced++; lastAdmitted = i }
							for (const h of FORWARD_BARS) {
								if (i + h <= devLast) fwdByH[`H${h}`]!.push((closes[i + h]! / closes[i]! - 1) * 100)
							}
							const tb = item.takerBuy[i]
							if (tb != null) takerAtEvent.push(tb)
						}
						for (const h of FORWARD_BARS) {
							const arr = fwdByH[`H${h}`]!
							if (arr.length) {
								stat.fwdMedianPct[`H${h}`] = median(arr)
								stat.fwdPositiveShare[`H${h}`] = arr.filter((v) => v > 0).length / arr.length
							}
						}
						if (takerAtEvent.length) stat.takerBuyMedianAtEvent = median(takerAtEvent)
					}
					// Зеркальная (short) сетка: рост OI ≥X за окно (перегрев) как кандидат SHORT.
					{
						const keyUp = cellKey(w, x, flush.id, 'oiDropShort')
						const statUp = ensure(keyUp, eligibleBars)
						const fwdByH: Record<string, number[]> = {}
						for (const h of FORWARD_BARS) fwdByH[`H${h}`] = []
						const takerAtEvent: number[] = []
						let lastAdmitted = -Infinity
						for (let i = wBars; i <= devLast; i++) {
							const d = dOi[i]!
							if (d == null || d < x) continue
							const p = dPrice[i]!
							if (flush.pct != null && !(p >= -flush.pct)) continue
							statUp.nEvents++
							if (i - lastAdmitted >= wBars) { statUp.nEventsSpaced++; lastAdmitted = i }
							for (const h of FORWARD_BARS) {
								if (i + h <= devLast) fwdByH[`H${h}`]!.push((closes[i + h]! / closes[i]! - 1) * 100)
							}
							const tb = item.takerBuy[i]
							if (tb != null) takerAtEvent.push(tb)
						}
						for (const h of FORWARD_BARS) {
							const arr = fwdByH[`H${h}`]!
							if (arr.length) {
								statUp.fwdMedianPct[`H${h}`] = median(arr)
								statUp.fwdPositiveShare[`H${h}`] = arr.filter((v) => v > 0).length / arr.length
							}
						}
						if (takerAtEvent.length) statUp.takerBuyMedianAtEvent = median(takerAtEvent)
					}
				}
			}
		}
		console.log(`census ${item.symbol}: готово`)
	}

	for (const [, c] of cells) c.per1000Bars = c.nBarsEligible ? c.nEvents / c.nBarsEligible * 1000 : 0

	const baseMedians: Record<string, number> = {}
	const basePositive: Record<string, number> = {}
	for (const h of FORWARD_BARS) {
		baseMedians[`H${h}`] = median(baseFwd[`H${h}`]!)
		basePositive[`H${h}`] = baseFwd[`H${h}`]!.filter((v) => v > 0).length / baseFwd[`H${h}`]!.length
	}

	const payload = {
		studyId: 'd6-leverage-flow',
		generatedAt: new Date().toISOString(),
		note: 'PHASE 1 census — правило-нейтральная карта. Исходы только на dev-срезе (65% календаря); OOS запечатан до preregistration руки.',
		provenance: {
			acquisitionManifestSha256: MANIFEST_SHA256,
			universeFull: survivorsAll.map((s) => s.symbol),
			universeUsed: survivors.map((s) => s.symbol),
			universeReducedByAuthor: requestedSymbols?.length ? 'сетевые ограничения; критерий = уже закэшированные метрики, не исходы' : null,
		},
		split: { devFraction: DEV_FRACTION, cutoffUtc: new Date(cutoffTs).toISOString() },
		grid: { windowsHours: WINDOWS_H, oiDropThresholds: DROPS, priceFlush: PRICE_FLUSHES, forwardBars: FORWARD_BARS },
		baselineDevForward: { medianPct: baseMedians, positiveShare: basePositive },
		cells: Object.fromEntries([...cells.entries()].sort(([a], [b]) => a.localeCompare(b))),
	}
	writeFileSync(resolve(OUT_JSON), JSON.stringify(payload, null, 2))

	const md: string[] = [
		'# D6 leverage-flow — census (Phase 1, dev-only)',
		'',
		`> Карта частот каскадных событий (ΔOI за окно) и дев-форвардов. OOS (после ${new Date(cutoffTs).toISOString()}) запечатан. Ничего не выбрано и не затюновано.`,
		'',
		`Базовые медианы dev-форварда (все бары): ${FORWARD_BARS.map((h) => `H${h}: ${baseMedians[`H${h}`]!.toFixed(3)}% (${(basePositive[`H${h}`]! * 100).toFixed(1)}% вверх)`).join('; ')}`,
		'',
		'## OI-DROP (делевериджинг вниз) — кандидат LONG после флаша',
		'| окно | порог | флаш | событий | на 1000 баров | fwd H1 | H4 | H12 | H24 | taker-buy@событии |',
		'|---|---|---|---:|---:|---:|---:|---:|---:|---:|',
	]
	const fmtCell = (key: string): string => {
		const c = cells.get(key)
		if (!c || !c.nEvents) return '| — '.repeat(0) + ''
		const f = (h: number): string => c.fwdMedianPct[`H${h}`] != null ? `${c.fwdMedianPct[`H${h}`]!.toFixed(2)}%/${((c.fwdPositiveShare[`H${h}`] ?? 0) * 100).toFixed(0)}%` : '—'
		return `${f(1)} | ${f(4)} | ${f(12)} | ${f(24)} | ${c.takerBuyMedianAtEvent != null ? c.takerBuyMedianAtEvent.toFixed(3) : '—'}`
	}
	for (const w of WINDOWS_H) for (const x of DROPS) for (const fl of PRICE_FLUSHES) {
		const key = cellKey(w, x, fl.id, 'oiDropLong')
		const c = cells.get(key)!
		md.push(`| ${w}h | −${(x * 100).toFixed(0)}% | ${fl.id} | ${c.nEvents} | ${c.per1000Bars.toFixed(2)} | ${fmtCell(key)} |`)
	}
	md.push('')
	md.push('## OI-SPIKE (перегрев вверх) — кандидат SHORT')
	md.push('| окно | порог | флаш | событий | на 1000 баров | fwd H1 | H4 | H12 | H24 | taker-buy@событии |')
	md.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|')
	for (const w of WINDOWS_H) for (const x of DROPS) for (const fl of PRICE_FLUSHES) {
		const key = cellKey(w, x, fl.id, 'oiDropShort')
		const c = cells.get(key)!
		md.push(`| ${w}h | +${(x * 100).toFixed(0)}% | ${fl.id} | ${c.nEvents} | ${c.per1000Bars.toFixed(2)} | ${fmtCell(key)} |`)
	}
	md.push('', '_Формат fwd: медиана/% положительных. Читайте карту: где событий достаточно (≥~300 spaced) и форвард заметно отличается от базовой строки сверху._')

	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nЗаписано: ${OUT_JSON}, ${OUT_MD}`)
	console.log(`Ячеек: ${cells.size}; базовые dev-медианы: ${JSON.stringify(baseMedians)}`)
}

void main()
