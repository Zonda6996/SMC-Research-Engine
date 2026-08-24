/**
 * D6 robustness — пессимистичное гэп-исполнение стопа (ответ на внешний ревью 2026-08-23).
 * Ревью: «стоп при гэпе исполняется слишком оптимистично» (заполнение ПО ЦЕНЕ СТОПА, когда бар
 * открылся НИЖЕ стопа). Здесь та же вселенная/правило/данные, что в d6-partial (мажоры −15/−5),
 * контроль C-H72, две конвенции на одинаковых событиях:
 *   A (как в reveal):  low ≤ stop → выход по stop;
 *   B (пессимистично): open ≤ stop → выход по OPEN этого бара; иначе low ≤ stop → по stop.
 * Плюс счётчик гэп-пробоев. Диагностика, не новый вердикт.
 * Запуск: npx tsx ci/research/runD6GapfillRobustness.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/d6-partial-preregistration.md'
const PREREG_SHA256 = '8e2afcd6deeae676051279653db1852678e04c1cc7d472850c4c7f5122089d5b'
const MANIFEST_PATH = 'data/d6-partial/manifest.json'
const MANIFEST_SHA256 = 'ffbc2f36fa25b0ae903a55c105ad6a46f0f13c3102b243ab179fc843c067403c'
const DATA_DIR = 'data/d6-partial'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const OI_DROP = -0.15
const PRICE_DROP = -0.05
const GAP_BARS = 8
const HOLD_BARS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026

const fileHash = (p: string): string => createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
const dayKey = (x: number): string => new Date(x).toISOString().slice(0, 10)
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

function rng(seed: number): () => number {
	let x = seed >>> 0
	return () => {
		x += 0x6d2b79f5
		let t = x
		t = Math.imul(t ^ t >>> 15, t | 1)
		t ^= t + Math.imul(t ^ t >>> 7, t | 61)
		return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
	}
}

function ci(rows: ReadonlyArray<{ day: string; v: number }>): { lower: number; upper: number } {
	const groups = new Map<string, number[]>()
	for (const r of rows) { const g = groups.get(r.day) ?? []; g.push(r.v); groups.set(r.day, g) }
	const days = [...groups.keys()].sort()
	if (!days.length) return { lower: NaN, upper: NaN }
	const random = rng(SEED)
	const means: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		let total = 0, count = 0
		for (let i = 0; i < days.length; i++) for (const v of groups.get(days[Math.floor(random() * days.length)]!)!) { total += v; count++ }
		if (count) means.push(total / count)
	}
	means.sort((a, b) => a - b)
	return { lower: means[Math.floor(0.025 * means.length)]!, upper: means[Math.floor(0.975 * means.length)]! }
}

async function main(): Promise<void> {
	for (const [p, e] of [[PREREG_PATH, PREREG_SHA256], [MANIFEST_PATH, MANIFEST_SHA256]] as const) if (fileHash(p) !== e) throw new Error(`hash mismatch ${p}`)
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; candleFile: string; candleSha256: string; fundingFile: string }> }
	const loaded: Array<{ symbol: string; candles: Candle[]; oi: Array<number | null>; atr200: number[] }> = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		loaded.push({ symbol: entry.symbol, candles, oi: alignArchiveMetrics(points, candles).oi, atr200: arrowAtr200(candles) })
	}

	interface Ev { symbol: string; index: number }
	const events: Ev[] = []
	for (const item of loaded) {
		const closes = item.candles.map((c) => c.close)
		let last = -Infinity
		for (let i = WINDOW_BARS; i + 1 < item.candles.length; i++) {
			const now = item.oi[i], past = item.oi[i - WINDOW_BARS]!
			if (now == null || past == null || past <= 0) continue
			if (!(now / past - 1 <= OI_DROP && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= PRICE_DROP)) continue
			if (i - last < GAP_BARS) continue
			last = i
			events.push({ symbol: item.symbol, index: i })
		}
	}

	const run = (pessimistic: boolean): { rows: Array<{ day: string; v: number }>; stops: number; gapThroughs: number; timeouts: number } => {
		const rows: Array<{ day: string; v: number }> = []
		let stops = 0, gapThroughs = 0, timeouts = 0
		for (const ev of events) {
			const item = loaded.find((l) => l.symbol === ev.symbol)!
			const i = ev.index
			const atr = item.atr200[i]
			if (!Number.isFinite(atr) || atr! <= 0) continue
			const entryIdx = i + 1
			if (entryIdx + HOLD_BARS - 1 > item.candles.length - 1) continue
			const entryBar = item.candles[entryIdx]!
			const entryOpen = entryBar.open
			const flushLow = Math.min(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
			const stop = flushLow - 0.5 * atr!
			let exitIdx = entryIdx + HOLD_BARS - 1
			let exitPrice = item.candles[exitIdx]!.close
			let hit: 'timeout' | 'stop' | 'gap' = 'timeout'
			for (let k = entryIdx; k <= exitIdx; k++) {
				const bar = item.candles[k]!
				if (pessimistic && bar.open <= stop) { exitIdx = k; exitPrice = bar.open; hit = 'gap'; break }
				if (bar.low <= stop) { exitIdx = k; exitPrice = stop; hit = 'stop'; break }
			}
			if (hit === 'stop') stops++
			if (hit === 'gap') { stops++; gapThroughs++ }
			if (hit === 'timeout') timeouts++
			rows.push({ day: dayKey(entryBar.timestamp), v: exitPrice / entryOpen - 1 - ROUND_TRIP_COST })
		}
		return { rows, stops, gapThroughs, timeouts }
	}

	const a = run(false)
	const b = run(true)
	const mean = (r: typeof a): number => sum(r.rows.map((x) => x.v)) / r.rows.length
	const out = {
		studyId: 'd6-gapfill-robustness',
		generatedAt: new Date().toISOString(),
		note: 'Робастность к конвенции гэп-исполнения стопа; контроль C-H72, мажоры −15/−5, те же события и данные, что d6-partial',
		events: events.length,
		asRevealed: { n: a.rows.length, stops: a.stops, gapThroughs: a.gapThroughs, timeouts: a.timeouts, meanNet: mean(a), ci: ci(a.rows) },
		pessimistic: { n: b.rows.length, stops: b.stops, gapThroughs: b.gapThroughs, timeouts: b.timeouts, meanNet: mean(b), ci: ci(b.rows) },
	}
	writeFileSync(resolve('ci-results/d6-gapfill-robustness.json'), JSON.stringify(out, null, 2))
	const f = (x: number): string => (x * 100).toFixed(3) + '%'
	const md = [
		'# D6 robustness — гэп-исполнение стопа (ответ на внешний ревью)',
		'',
		`Событий: ${events.length} (мажоры −15/−5, контроль C-H72, те же данные, что d6-partial).`,
		'',
		'| конвенция | стопов (из них гэп-пробоев) | таймаутов | средняя net | CI95 |',
		'|---|---|---:|---:|---|',
		`| A: как в reveal (по цене стопа) | ${a.stops} (${a.gapThroughs}) | ${a.timeouts} | ${f(mean(a))} | [${f(ci(a.rows).lower)}; ${f(ci(a.rows).upper)}] |`,
		`| B: пессимистично (гэп → по open бара) | ${b.stops} (${b.gapThroughs}) | ${b.timeouts} | ${f(mean(b))} | [${f(ci(b.rows).lower)}; ${f(ci(b.rows).upper)}] |`,
		'',
		'Вывод: разница между конвенциями = верхняя оценка завышения от гэп-допущения. Диагностика, не новый вердикт.',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve('ci-results/d6-gapfill-robustness.md'), md.join('\n'))
	console.log(md.join('\n'))
}

void main()
