/**
 * D6 fixed-window census — ДИАГНОСТИКА (вопрос автора 2026-08-24: «на младших ТФ событий должно
 * быть БОЛЬШЕ, а не меньше»). Причина расхождения: в мульти-ТФ карте окно = 8 БАРОВ ТФ
 * (на 5м это 40 минут — флэш-краш, редкость). Здесь окно ФИКСИРОВАНО = 8 ЧАСОВ на всех ТФ
 * (5м: 96 баров, 15м: 32, 30м: 16) — тот же экономический сигнал, тоньший вход.
 * Гипотеза: число событий выравнивается со старшими ТФ, качество входа сопоставимо.
 * Мажоры 1h-кэш агрегацией не нужен: 5м/15м/30м из архива (кэш). Режимы SAFE/STANDARD/RISK.
 * Форма сделки: стоп flushLow(окно)−0.5×ATR200, стоп первым, таймаут 72ч, net 5bps.
 * ⚠ Диагностика, in-sample. Запуск: npx tsx ci/research/runD6FixedWindow.ts
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
const TFS = ['5m', '15m', '30m'] as const
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000 }
const WINDOW_HOURS = 8
const MODES = [
	{ id: 'SAFE', oiDrop: -0.2, priceDrop: -0.05 },
	{ id: 'STANDARD', oiDrop: -0.15, priceDrop: -0.05 },
	{ id: 'RISK', oiDrop: -0.12, priceDrop: -0.05 },
] as const
const GAP_HOURS = 8
const HOLD_HOURS = 72
const ROUND_TRIP_COST = 0.001

const pct = (x: number | null, d = 2): string => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%'
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

async function main(): Promise<void> {
	const results: Array<{ tf: string; mode: string; windowBars: number; n: number; symbolsWithEvents: number; wr: number | null; meanNet: number | null; uniqueDays: number }> = []
	for (const tf of TFS) {
		const tfMs = TF_MS[tf]!
		const windowBars = Math.floor(WINDOW_HOURS * 3_600_000 / tfMs)
		const gapBars = Math.floor(GAP_HOURS * 3_600_000 / tfMs)
		const holdBars = Math.floor(HOLD_HOURS * 3_600_000 / tfMs)
		const perMode = new Map<string, { nets: number[]; days: Set<number>; symbols: Set<string> }>()
		for (const m of MODES) perMode.set(m.id, { nets: [], days: new Set(), symbols: new Set() })
		for (const symbol of MAJORS) {
			const candles = await fetchArchiveKlines(symbol, tf, 'futures', Date.now() - 6 * 365 * 86_400_000, null)
			if (candles.length < windowBars + 210) continue
			const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + tfMs)
			const oi = alignArchiveMetrics(points, candles).oi
			const atr200 = arrowAtr200(candles)
			const closes = candles.map((c) => c.close)
			for (const mode of MODES) {
				const b = perMode.get(mode.id)!
				let last = -Infinity
				for (let i = windowBars; i + 1 < candles.length; i++) {
					const now = oi[i], past = oi[i - windowBars]!
					if (now == null || past == null || past <= 0) continue
					if (!(now / past - 1 <= mode.oiDrop && closes[i]! / closes[i - windowBars]! - 1 <= mode.priceDrop)) continue
					if (i - last < gapBars) continue
					last = i
					const atr = atr200[i]
					if (!Number.isFinite(atr) || atr! <= 0) continue
					const entryIdx = i + 1
					if (entryIdx + holdBars - 1 > candles.length - 1) continue
					const entryOpen = candles[entryIdx]!.open
					const flushLow = Math.min(...candles.slice(i - windowBars + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					let exitIdx = entryIdx + holdBars - 1
					let exitPrice = candles[exitIdx]!.close
					for (let k = entryIdx; k <= exitIdx; k++) {
						if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; break }
					}
					b.nets.push(exitPrice / entryOpen - 1 - ROUND_TRIP_COST)
					b.days.add(Math.floor(candles[entryIdx]!.timestamp / 86_400_000))
					b.symbols.add(symbol)
				}
			}
			console.log(`${tf} ${symbol}: ${candles.length} баров`)
		}
		for (const mode of MODES) {
			const b = perMode.get(mode.id)!
			results.push({ tf, mode: mode.id, windowBars, n: b.nets.length, symbolsWithEvents: b.symbols.size, wr: b.nets.length ? b.nets.filter((x) => x > 0).length / b.nets.length : null, meanNet: b.nets.length ? sum(b.nets) / b.nets.length : null, uniqueDays: b.days.size })
			console.log(`${tf} ${mode.id} (окно ${windowBars} баров = ${WINDOW_HOURS}ч): N=${results[results.length - 1]!.n} WR=${pct(results[results.length - 1]!.wr, 1)} net=${pct(results[results.length - 1]!.meanNet)} симв=${b.symbols.size}/12`)
		}
	}

	writeFileSync(resolve('ci-results/d6-fixed-window.json'), JSON.stringify({ studyId: 'd6-fixed-window', generatedAt: new Date().toISOString(), note: 'ДИАГНОСТИКА: окно фиксировано 8 часов на всех ТФ (не 8 баров ТФ); in-sample', universe: MAJORS, results }, null, 2))
	const md = [
		'# D6 fixed-window — одно окно 8 ЧАСОВ на всех ТФ (ДИАГНОСТИКА, без вердиктов)',
		'',
		'Ответ на вопрос автора: в пропорциональной карте окно = 8 баров ТФ (на 5м это 40 минут →',
		'флэш-краш → мало событий). Здесь окно жёстко 8 часов везде: тот же сигнал, тоньший вход.',
		'',
		'| ТФ | окно (баров) | режим | N | WR | net | символов | дней |',
		'|---|---|---|---:|---:|---:|---:|---:|',
		...results.map((r) => `| ${r.tf} | ${r.windowBars} | ${r.mode} | ${r.n} | ${pct(r.wr, 1)} | ${pct(r.meanNet)} | ${r.symbolsWithEvents}/12 | ${r.uniqueDays} |`),
		'',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve('ci-results/d6-fixed-window.md'), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-fixed-window.{json,md}')
}

void main()
