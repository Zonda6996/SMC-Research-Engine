/**
 * D6 Apex-scalp census — ДИАГНОСТИКА на мажорах 5m/15m, БЕЗ вердиктов (идея автора, ROADMAP).
 * Вопрос: улучшают ли каскадные события 5м/15м совпадение входа с зоной Apex (нижняя полоса)?
 * Зоны — канонический движок computeApexBands (каузальные, дефолтные параметры).
 * Классы позиции входа (entryOpen против полос сигнального бара):
 *   in-zone-deep   — внутри зоны, глубже половины пути inner→outer
 *   in-zone-shallow— внутри зоны, верхняя половина
 *   above-zone     — между inner-полосой и mean
 *   above-mean     — выше mean
 * События: режимы SAFE/STANDARD/RISK (окно 8 баров ТФ, gap 8). Форма сделки: стоп структурный
 * flushLow(8)−0.5×ATR200 (стоп первым), таймаут 72ч. Net 5bps/side (funding на 5м/15м ≈ 0).
 * ⚠ Диагностика, in-sample. Запуск: npx tsx ci/research/runD6ApexScalp.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'

const MAJORS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT',
	'ADAUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'DOTUSDT', 'TRXUSDT',
]
const TFS = ['5m', '15m'] as const
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000 }
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

interface ClassStat { n: number; wr: number | null; meanNet: number | null; uniqueDays: number }

async function main(): Promise<void> {
	const results: Array<{ tf: string; mode: string; zone: string } & ClassStat> = []
	for (const tf of TFS) {
		const tfMs = TF_MS[tf]!
		const holdBars = Math.floor(HOLD_HOURS * 3_600_000 / tfMs)
		const buckets = new Map<string, { nets: number[]; days: Set<number> }>()
		const zoneOf = (entryOpen: number, band: { mean: number; greenHi: number; greenLo: number }): string => {
			if (entryOpen > band.mean) return 'above-mean'
			if (entryOpen > band.greenHi) return 'above-zone'
			const depth = (band.greenHi - entryOpen) / Math.max(band.greenHi - band.greenLo, 1e-12)
			return depth >= 0.5 ? 'in-zone-deep' : 'in-zone-shallow'
		}
		for (const symbol of MAJORS) {
			const t = Date.now()
			const candles = await fetchArchiveKlines(symbol, tf, 'futures', Date.now() - 6 * 365 * 86_400_000, null)
			if (candles.length < WINDOW_BARS + 210) continue
			const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + tfMs)
			const oi = alignArchiveMetrics(points, candles).oi
			const atr200 = arrowAtr200(candles)
			const bands = computeApexBands(candles)
			const closes = candles.map((c) => c.close)
			for (const mode of MODES) {
				let last = -Infinity
				for (let i = WINDOW_BARS; i + 1 < candles.length; i++) {
					const now = oi[i], past = oi[i - WINDOW_BARS]!
					if (now == null || past == null || past <= 0) continue
					if (!(now / past - 1 <= mode.oiDrop && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= mode.priceDrop)) continue
					if (i - last < GAP_BARS) continue
					last = i
					const atr = atr200[i]
					if (!Number.isFinite(atr) || atr! <= 0) continue
					const entryIdx = i + 1
					if (entryIdx + holdBars - 1 > candles.length - 1) continue
					const entryBar = candles[entryIdx]!
					const entryOpen = entryBar.open
					const flushLow = Math.min(...candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					let exitIdx = entryIdx + holdBars - 1
					let exitPrice = candles[exitIdx]!.close
					for (let k = entryIdx; k <= exitIdx; k++) {
						if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; break }
					}
					const zone = zoneOf(entryOpen, bands[i]!)
					const key = `${tf}|${mode.id}|${zone}`
					if (!buckets.has(key)) buckets.set(key, { nets: [], days: new Set() })
					const b = buckets.get(key)!
					b.nets.push(exitPrice / entryOpen - 1 - ROUND_TRIP_COST)
					b.days.add(Math.floor(entryBar.timestamp / 86_400_000))
				}
			}
			console.log(`${tf} ${symbol}: ${candles.length} баров, ${Math.round((Date.now() - t) / 1000)}с`)
		}
		for (const mode of MODES) {
			for (const zone of ['in-zone-deep', 'in-zone-shallow', 'above-zone', 'above-mean']) {
				const b = buckets.get(`${tf}|${mode.id}|${zone}`)
				if (!b || !b.nets.length) continue
				results.push({ tf, mode: mode.id, zone, n: b.nets.length, wr: b.nets.filter((x) => x > 0).length / b.nets.length, meanNet: sum(b.nets) / b.nets.length, uniqueDays: b.days.size })
			}
		}
		console.log(`TF ${tf} обработан`)
	}

	writeFileSync(resolve('ci-results/d6-apex-scalp.json'), JSON.stringify({
		studyId: 'd6-apex-scalp',
		generatedAt: new Date().toISOString(),
		note: 'ДИАГНОСТИКА: каскадные события 5м/15м × позиция входа относительно зоны Apex; in-sample',
		universe: MAJORS, tfs: TFS, modes: MODES, holdHours: HOLD_HOURS,
		results,
	}, null, 2))

	const md = [
		'# D6 Apex-scalp census — каскад 5м/15м × зона Apex (ДИАГНОСТИКА, без вердиктов)',
		'',
		'Классы: где находился вход (open следующего бара) относительно каузальной зоны Apex сигнального бара.',
		'',
		'| ТФ | режим | зона входа | N | WR | средняя net | дней |',
		'|---|---|---|---:|---:|---:|---:|',
		...results.map((r) => `| ${r.tf} | ${r.mode} | ${r.zone} | ${r.n} | ${pct(r.wr, 1)} | ${pct(r.meanNet)} | ${r.uniqueDays} |`),
		'',
		'⚠ Диагностика, in-sample; N в глубоких классах мал — смотреть направление, не цифры.',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve('ci-results/d6-apex-scalp.md'), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-apex-scalp.{json,md}')
}

void main()
