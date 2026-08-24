/**
 * D6 scaled-timeout census — ДИАГНОСТИКА (одобрено автором 2026-08-24): «ритм» удержания по ТФ.
 * Окно события ФИКСИРОВАНО 8 часов на всех ТФ (5м:96, 15м:32, 30м:16 баров). Тестируем таймаут:
 * 12ч / 24ч / 72ч на 5м/15м/30м (1h+ уже имеет 72ч в картах). Режим STANDARD (−15/−5) + SAFE.
 * Форма: стоп flushLow(окно)−0.5×ATR200 (стоп первым), net 5bps. Мажоры, in-sample.
 * Запуск: npx tsx ci/research/runD6ScaledTimeout.ts
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
const HOLDS = [12, 24, 72] as const
const MODES = [
	{ id: 'STANDARD', oiDrop: -0.15, priceDrop: -0.05 },
	{ id: 'SAFE', oiDrop: -0.2, priceDrop: -0.05 },
] as const
const GAP_HOURS = 8
const ROUND_TRIP_COST = 0.001

const pct = (x: number | null, d = 2): string => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%'
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

async function main(): Promise<void> {
	const results: Array<{ tf: string; mode: string; holdH: number; n: number; wr: number | null; meanNet: number | null; uniqueDays: number }> = []
	for (const tf of TFS) {
		const tfMs = TF_MS[tf]!
		const windowBars = Math.floor(WINDOW_HOURS * 3_600_000 / tfMs)
		const gapBars = Math.floor(GAP_HOURS * 3_600_000 / tfMs)
		const perMode = new Map<string, Map<number, { nets: number[]; days: Set<number> }>>()
		for (const m of MODES) {
			const inner = new Map<number, { nets: number[]; days: Set<number> }>()
			for (const h of HOLDS) inner.set(h, { nets: [], days: new Set() })
			perMode.set(m.id, inner)
		}
		for (const symbol of MAJORS) {
			const candles = await fetchArchiveKlines(symbol, tf, 'futures', Date.now() - 6 * 365 * 86_400_000, null)
			if (candles.length < windowBars + 210) continue
			const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + tfMs)
			const oi = alignArchiveMetrics(points, candles).oi
			const atr200 = arrowAtr200(candles)
			const closes = candles.map((c) => c.close)
			for (const mode of MODES) {
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
					const entryOpen = candles[entryIdx]!.open
					const flushLow = Math.min(...candles.slice(i - windowBars + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					for (const hold of HOLDS) {
						const holdBars = Math.floor(hold * 3_600_000 / tfMs)
						if (entryIdx + holdBars - 1 > candles.length - 1) continue
						const b = perMode.get(mode.id)!.get(hold)!
						let exitIdx = entryIdx + holdBars - 1
						let exitPrice = candles[exitIdx]!.close
						for (let k = entryIdx; k <= exitIdx; k++) {
							if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; break }
						}
						b.nets.push(exitPrice / entryOpen - 1 - ROUND_TRIP_COST)
						b.days.add(Math.floor(candles[entryIdx]!.timestamp / 86_400_000))
					}
				}
			}
			console.log(`${tf} ${symbol}: ${candles.length} баров`)
		}
		for (const mode of MODES) for (const hold of HOLDS) {
			const b = perMode.get(mode.id)!.get(hold)!
			results.push({ tf, mode: mode.id, holdH: hold, n: b.nets.length, wr: b.nets.length ? b.nets.filter((x) => x > 0).length / b.nets.length : null, meanNet: b.nets.length ? sum(b.nets) / b.nets.length : null, uniqueDays: b.days.size })
			console.log(`${tf} ${mode.id} hold ${hold}ч: N=${b.nets.length} WR=${pct(results[results.length - 1]!.wr, 1)} net=${pct(results[results.length - 1]!.meanNet)} дней=${b.days.size}`)
		}
	}

	writeFileSync(resolve('ci-results/d6-scaled-timeout.json'), JSON.stringify({ studyId: 'd6-scaled-timeout', generatedAt: new Date().toISOString(), note: 'ДИАГНОСТИКА таймаутов при фиксированном окне 8ч; in-sample', universe: MAJORS, results }, null, 2))
	const md = [
		'# D6 scaled-timeout — ритм удержания по ТФ при окне 8ч (ДИАГНОСТИКА)',
		'',
		'| ТФ | режим | таймаут | N | WR | net | дней |',
		'|---|---|---|---:|---:|---:|---:|',
		...results.map((r) => `| ${r.tf} | ${r.mode} | ${r.holdH}ч | ${r.n} | ${pct(r.wr, 1)} | ${pct(r.meanNet)} | ${r.uniqueDays} |`),
		'',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve('ci-results/d6-scaled-timeout.md'), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-scaled-timeout.{json,md}')
}

void main()
