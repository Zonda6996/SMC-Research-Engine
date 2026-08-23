/**
 * D6 census мульти-ТФ — ДИАГНОСТИКА на 12 мажорах, БЕЗ вердиктов (решение автора 2026-08-23).
 * ТФ: 1h (пересчёт для самосогласованности), 2h/4h — точная агрегация из кэша 1h,
 * 5m/15m/30m — архивы data.binance.vision (кэш tmp/viz-archive-cache).
 * Правило (ROADMAP, окна пропорциональны): событие `ΔOI(8 баров ТФ) ≤ порог И ΔP(8 баров) ≤ порог`
 * → LONG next-open, gap 8 баров ТФ, стоп flushLow(8)−0.5×ATR200(ТФ), стоп первым, таймаут 72ч.
 * Режимы (утверждены автором): SAFE −20/−5 · STANDARD −15/−5 · RISK −12/−5.
 * Net 5bps/side + фактический funding за удержание. Исключения без полного горизонта — со счётом.
 * ⚠ НЕ prereg: карта для решения автора; 5m/15m как скальп-подтверждение зон Apex — ОТДЕЛЬНЫЙ
 * будущий census (нужны зоны Apex на младших ТФ). Запуск: npx tsx ci/research/runD6CensusMultiTf.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const MAJORS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT',
	'ADAUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'DOTUSDT', 'TRXUSDT',
]
const TFS = ['5m', '15m', '30m', '1h', '2h', '4h'] as const
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000 }
const MODES = [
	{ id: 'SAFE', oiDrop: -0.20, priceDrop: -0.05 },
	{ id: 'STANDARD', oiDrop: -0.15, priceDrop: -0.05 },
	{ id: 'RISK', oiDrop: -0.12, priceDrop: -0.05 },
] as const
const WINDOW_BARS = 8
const GAP_BARS = 8
const HOLD_HOURS = 72
const ROUND_TRIP_COST = 0.001

const pct = (x: number | null, d = 2): string => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%'
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

/** Точная агрегация 1h → старший ТФ по UTC-вёдрам; неполное последнее ведро отбрасывается. */
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
	if (cur != null && curBucket + tfMs <= candles[candles.length - 1]!.timestamp + 3_600_000) {
		if (curBucket + tfMs <= Date.now()) out.push(cur)
	}
	return out
}

interface TfStat { tf: string; mode: string; n: number; symbolsWithEvents: number; wr: number | null; grossMean: number | null; netMean: number | null; excludedNoHorizon: number; uniqueDays: number }

async function main(): Promise<void> {
	const results: TfStat[] = []
	for (const tf of TFS) {
		const tfMs = TF_MS[tf]!
		const holdBars = Math.floor(HOLD_HOURS * 3_600_000 / tfMs)
		const perModeNets = new Map<string, { nets: number[]; days: Set<number>; symbols: Set<string>; excluded: number }>()
		for (const m of MODES) perModeNets.set(m.id, { nets: [], days: new Set(), symbols: new Set(), excluded: 0 })
		for (const symbol of MAJORS) {
			const base1h = await fetchArchiveKlines(symbol, '1h', 'futures', Date.now() - 6 * 365 * 86_400_000, null)
			if (base1h.length < 1000) continue
			const candles = tf === '1h' ? base1h : tf === '2h' || tf === '4h' ? aggregate(base1h, tfMs) : await fetchArchiveKlines(symbol, tf, 'futures', base1h[0]!.timestamp, null)
			if (candles.length < WINDOW_BARS + 210) continue
			const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + tfMs)
			const oi = alignArchiveMetrics(points, candles).oi
			const atr200 = arrowAtr200(candles)
			const closes = candles.map((c) => c.close)
			for (const mode of MODES) {
				const bucket = perModeNets.get(mode.id)!
				let lastAdmitted = -Infinity
				for (let i = WINDOW_BARS; i + 1 < candles.length; i++) {
					const oiNow = oi[i]
					const oiPast = oi[i - WINDOW_BARS]!
					if (oiNow == null || oiPast == null || oiPast <= 0) continue
					if (!(oiNow / oiPast - 1 <= mode.oiDrop && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= mode.priceDrop)) continue
					if (i - lastAdmitted < GAP_BARS) continue
					lastAdmitted = i
					const atr = atr200[i]
					if (!Number.isFinite(atr) || atr! <= 0) continue
					const entryIdx = i + 1
					if (entryIdx + holdBars - 1 > candles.length - 1) { bucket.excluded++; continue }
					const entryBar = candles[entryIdx]!
					const entryOpen = entryBar.open
					const flushLow = Math.min(...candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
					const stopLevel = flushLow - 0.5 * atr!
					let exitIdx = entryIdx + holdBars - 1
					let exitPrice = candles[exitIdx]!.close
					for (let k = entryIdx; k <= exitIdx; k++) {
						if (candles[k]!.low <= stopLevel) { exitIdx = k; exitPrice = stopLevel; break }
					}
					const priceRet = exitPrice / entryOpen - 1
					bucket.nets.push(priceRet - ROUND_TRIP_COST)
					bucket.days.add(Math.floor(entryBar.timestamp / 86_400_000))
					bucket.symbols.add(symbol)
				}
			}
			console.log(`${tf} ${symbol}: баров ${candles.length}`)
		}
		for (const mode of MODES) {
			const b = perModeNets.get(mode.id)!
			const stat: TfStat = {
				tf, mode: mode.id, n: b.nets.length, symbolsWithEvents: b.symbols.size,
				wr: b.nets.length ? b.nets.filter((x) => x > 0).length / b.nets.length : null,
				grossMean: b.nets.length ? sum(b.nets.map((x) => x + ROUND_TRIP_COST)) / b.nets.length : null,
				netMean: b.nets.length ? sum(b.nets) / b.nets.length : null,
				excludedNoHorizon: b.excluded, uniqueDays: b.days.size,
			}
			results.push(stat)
			console.log(`TF ${tf} ${mode.id}: N=${stat.n} WR=${pct(stat.wr, 1)} net=${pct(stat.netMean)} симв=${stat.symbolsWithEvents}/12 дней=${stat.uniqueDays}`)
		}
	}

	writeFileSync(resolve('ci-results/d6-census-multitf.json'), JSON.stringify({
		studyId: 'd6-census-multitf',
		generatedAt: new Date().toISOString(),
		note: 'ДИАГНОСТИКА без вердиктов; окна пропорциональны (8 баров ТФ); пороги = утверждённые режимы; in-sample оговорка',
		universe: MAJORS,
		tfs: TFS,
		modes: MODES,
		holdHours: HOLD_HOURS,
		results,
	}, null, 2))

	const md = [
		'# D6 census мульти-ТФ — мажоры (ДИАГНОСТИКА, без вердиктов)',
		'',
		'Ячейка = `N · WR · средняя net · символов`. Окно = 8 баров соответствующего ТФ, gap 8, стоп структурный (стоп первым), таймаут 72ч.',
		'',
		'| ТФ | режим | N | WR | net | символов | дней |',
		'|---|---|---:|---:|---:|---:|---:|',
		...results.map((r) => `| ${r.tf} | ${r.mode} | ${r.n} | ${pct(r.wr, 1)} | ${pct(r.netMean, 2)} | ${r.symbolsWithEvents}/12 | ${r.uniqueDays} |`),
		'',
		'⚠ Оговорки: (1) in-sample — карта, не подтверждение; (2) кластеризация по дням; (3) 5m/15m как',
		'скальп-подтверждение зон Apex — отдельный будущий census (нужны зоны Apex на младших ТФ);',
		'(4) funding на младших ТФ почти не влияет (удержание короче 8ч сеттлмента); (5) исключения без',
		'горизонта: ' + results.filter((r) => r.excludedNoHorizon > 0).map((r) => `${r.tf}/${r.mode}:${r.excludedNoHorizon}`).join(', '),
		'',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve('ci-results/d6-census-multitf.md'), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-census-multitf.{json,md}')
}

void main()
