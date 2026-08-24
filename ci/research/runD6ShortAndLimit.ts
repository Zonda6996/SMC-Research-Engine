/**
 * D6 short-side + limit-entry — ДИАГНОСТИКА на мажорах 1h, БЕЗ вердиктов (решение автора 2026-08-24).
 *
 * Часть 1 — SHORT-сторона (зеркало, никогда не тестировалась): событие `ΔOI_8h ≥ +порог И
 * ΔP_8h ≥ +порог` → SHORT next-open; стоп = flushHIGH(8) + 0.5×ATR200 (стоп первым), таймаут 72ч.
 * Режимы-зеркала: SAFE +20/+5, STANDARD +15/+5, RISK +12/+5. Funding: шорт ПОЛУЧАЕТ +rate.
 *
 * Часть 2 — LIMIT-вход вместо next-open (maker-идея, прецедент RE11): событие STANDARD (−15/−5),
 * лимитка BUY на уровнях {close[i], entryOpen−0.25R, entryOpen−0.5R}, валидность 24ч/72ч;
 * заполнение: open < лимита → по open (гэп в нашу сторону), иначе low ≤ лимита → по лимиту.
 * Дальше тот же контроль: структурный стоп (стоп первым), таймаут close[fill+71].
 * Издержки консервативно 5bps/side у всех (мейкер-ребейт только улучшил бы).
 *
 * ⚠ Диагностика, in-sample; не prereg. Запуск: npx tsx ci/research/runD6ShortAndLimit.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const MANIFEST_PATH = 'data/d6-partial/manifest.json'
const MANIFEST_SHA256 = 'ffbc2f36fa25b0ae903a55c105ad6a46f0f13c3102b243ab179fc843c067403c'
const DATA_DIR = 'data/d6-partial'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const GAP_BARS = 8
const HOLD_BARS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026

const fileHash = (p: string): string => createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
const dayKey = (x: number): string => new Date(x).toISOString().slice(0, 10)
const pct = (x: number | null, d = 2): string => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%'
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

interface SettledFunding { timestamp: number; rate: number; markPrice: number }
interface Loaded { symbol: string; candles: Candle[]; oi: Array<number | null>; atr200: number[]; funding: SettledFunding[] }

interface Stat { n: number; wr: number | null; meanNet: number | null; grossMean: number | null; stops: number; timeouts: number; extra: string }

function summarize(rows: Array<{ day: string; v: number; gross: number; outcome: string }>): Stat {
	const vals = rows.map((r) => r.v)
	return {
		n: vals.length,
		wr: vals.length ? vals.filter((x) => x > 0).length / vals.length : null,
		meanNet: vals.length ? sum(vals) / vals.length : null,
		grossMean: vals.length ? sum(rows.map((r) => r.gross)) / vals.length : null,
		stops: rows.filter((r) => r.outcome === 'stop').length,
		timeouts: rows.filter((r) => r.outcome === 'timeout').length,
		extra: '',
	}
}

async function main(): Promise<void> {
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('manifest hash mismatch')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; candleFile: string; candleSha256: string; fundingFile: string }> }
	const loaded: Loaded[] = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as SettledFunding[]
		loaded.push({ symbol: entry.symbol, candles, oi: alignArchiveMetrics(points, candles).oi, atr200: arrowAtr200(candles), funding })
		console.log(`${entry.symbol}: готово`)
	}

	// ─── Часть 1: SHORT-зеркало ───
	const SHORT_MODES = [
		{ id: 'SAFE', oiPump: 0.20, pxPump: 0.05 },
		{ id: 'STANDARD', oiPump: 0.15, pxPump: 0.05 },
		{ id: 'RISK', oiPump: 0.12, pxPump: 0.05 },
	]
	const shortStats: Array<{ mode: string } & Stat> = []
	for (const mode of SHORT_MODES) {
		const rows: Array<{ day: string; v: number; gross: number; outcome: string }> = []
		for (const item of loaded) {
			const closes = item.candles.map((c) => c.close)
			let last = -Infinity
			for (let i = WINDOW_BARS; i + 1 < item.candles.length; i++) {
				const now = item.oi[i], past = item.oi[i - WINDOW_BARS]!
				if (now == null || past == null || past <= 0) continue
				if (!(now / past - 1 >= mode.oiPump && closes[i]! / closes[i - WINDOW_BARS]! - 1 >= mode.pxPump)) continue
				if (i - last < GAP_BARS) continue
				last = i
				const atr = item.atr200[i]
				if (!Number.isFinite(atr) || atr! <= 0) continue
				const entryIdx = i + 1
				if (entryIdx + HOLD_BARS - 1 > item.candles.length - 1) continue
				const entryBar = item.candles[entryIdx]!
				const entryOpen = entryBar.open
				const flushHigh = Math.max(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.high))
				const stop = flushHigh + 0.5 * atr!
				let exitIdx = entryIdx + HOLD_BARS - 1
				let exitPrice = item.candles[exitIdx]!.close
				let outcome = 'timeout'
				for (let k = entryIdx; k <= exitIdx; k++) {
					if (item.candles[k]!.high >= stop) { exitIdx = k; exitPrice = stop; outcome = 'stop'; break }
				}
				let fundingQuote = 0
				for (const f of item.funding) {
					if (f.timestamp < entryBar.timestamp || f.timestamp >= item.candles[exitIdx]!.timestamp) continue
					fundingQuote += f.rate * f.markPrice
				}
				const priceRet = 1 - exitPrice / entryOpen
				rows.push({ day: dayKey(entryBar.timestamp), v: priceRet + fundingQuote / entryOpen - ROUND_TRIP_COST, gross: priceRet + fundingQuote / entryOpen, outcome })
			}
		}
		const s = summarize(rows)
		shortStats.push({ mode: mode.id, ...s })
		console.log(`SHORT ${mode.id}: N=${s.n} WR=${pct(s.wr, 1)} net=${pct(s.meanNet)}`)
	}

	// ─── Часть 2: LIMIT-вход ───
	const levels = [
		{ id: 'market', offsetR: null as number | null },
		{ id: 'limit@close[i]', offsetR: 'close' as const },
		{ id: 'limit@-0.25R', offsetR: -0.25 },
		{ id: 'limit@-0.5R', offsetR: -0.5 },
	]
	const validities = [24, 72]
	const limitStats: Array<{ variant: string; validityH: number; fills: number; unfilled: number; fillRate: number | null; wr: number | null; meanNet: number | null; stops: number; timeouts: number }> = []
	for (const level of levels) {
		for (const validityH of level.offsetR == null ? [72] : validities) {
			const validityBars = Math.floor(validityH * 60 / 60)
			const rows: Array<{ day: string; v: number; outcome: string }> = []
			let unfilled = 0
			for (const item of loaded) {
				const closes = item.candles.map((c) => c.close)
				let last = -Infinity
				for (let i = WINDOW_BARS; i + 1 < item.candles.length; i++) {
					const now = item.oi[i], past = item.oi[i - WINDOW_BARS]!
					if (now == null || past == null || past <= 0) continue
					if (!(now / past - 1 <= -0.15 && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= -0.05)) continue
					if (i - last < GAP_BARS) continue
					last = i
					const atr = item.atr200[i]
					if (!Number.isFinite(atr) || atr! <= 0) continue
					const entryIdx = i + 1
					if (entryIdx + HOLD_BARS - 1 > item.candles.length - 1) continue
					const signalClose = closes[i]!
					const nextOpen = item.candles[entryIdx]!.open
					const flushLow = Math.min(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					const riskDist = nextOpen - stop
					const limitPrice = level.offsetR == null ? nextOpen : level.offsetR === 'close' ? signalClose : nextOpen - level.offsetR * riskDist
					let fillIdx = -1
					let fillPrice = 0
					if (level.offsetR == null) { fillIdx = entryIdx; fillPrice = nextOpen } else {
						for (let k = entryIdx; k <= entryIdx + validityBars - 1 && k <= item.candles.length - 1; k++) {
							const bar = item.candles[k]!
							if (bar.open <= limitPrice) { fillIdx = k; fillPrice = bar.open; break }
							if (bar.low <= limitPrice) { fillIdx = k; fillPrice = limitPrice; break }
						}
						if (fillIdx < 0) { unfilled++; continue }
					}
					const exitCap = Math.min(fillIdx + HOLD_BARS - 1, item.candles.length - 1)
					let exitIdx = exitCap
					let exitPrice = item.candles[exitIdx]!.close
					let outcome = 'timeout'
					for (let k = fillIdx; k <= exitIdx; k++) {
						if (item.candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; outcome = 'stop'; break }
					}
					rows.push({ day: dayKey(item.candles[fillIdx]!.timestamp), v: exitPrice / fillPrice - 1 - ROUND_TRIP_COST, outcome })
				}
			}
			const s = summarize(rows)
			limitStats.push({ variant: level.id, validityH, fills: s.n, unfilled, fillRate: s.n + unfilled ? s.n / (s.n + unfilled) : null, wr: s.wr, meanNet: s.meanNet, stops: s.stops, timeouts: s.timeouts })
			console.log(`LIMIT ${level.id} ${validityH}ч: fills=${s.n} unfilled=${unfilled} WR=${pct(s.wr, 1)} net=${pct(s.meanNet)}`)
		}
	}

	writeFileSync(resolve('ci-results/d6-census-short.json'), JSON.stringify({ studyId: 'd6-census-short', generatedAt: new Date().toISOString(), note: 'ДИАГНОСТИКА зеркала SHORT; funding: шорт получает +rate; in-sample', modes: SHORT_MODES, results: shortStats }, null, 2))
	writeFileSync(resolve('ci-results/d6-limit-entry.json'), JSON.stringify({ studyId: 'd6-limit-entry', generatedAt: new Date().toISOString(), note: 'ДИАГНОСТИКА лимитного входа; STANDARD −15/−5; издержки консервативно 5bps/side у всех', results: limitStats }, null, 2))

	const md = [
		'# D6 short-сторона + limit-вход — ДИАГНОСТИКА (мажоры 1h, без вердиктов)',
		'',
		'## SHORT-зеркало (OI-памп + памп цены → SHORT, стоп над флашем, таймаут 72ч)',
		'',
		'| режим | N | WR | средняя net | gross | стопов | таймаутов |',
		'|---|---:|---:|---:|---:|---:|---:|',
		...shortStats.map((s) => `| ${s.mode} (+${(SHORT_MODES.find((m) => m.id === s.mode)!.oiPump * 100).toFixed(0)}/${(SHORT_MODES.find((m) => m.id === s.mode)!.pxPump * 100).toFixed(0)}%) | ${s.n} | ${pct(s.wr, 1)} | ${pct(s.meanNet)} | ${pct(s.grossMean)} | ${s.stops} | ${s.timeouts} |`),
		'',
		'## LIMIT-вход (STANDARD −15/−5; база — market next-open)',
		'',
		'| вариант | валидность | заполнено | не дошло | fill-rate | WR | средняя net |',
		'|---|---|---:|---:|---:|---:|---:|',
		...limitStats.map((s) => `| ${s.variant} | ${s.validityH}ч | ${s.fills} | ${s.unfilled} | ${pct(s.fillRate, 1)} | ${pct(s.wr, 1)} | ${pct(s.meanNet)} |`),
		'',
		'⚠ Диагностика, in-sample. SHORT: шорт получает funding (+rate). LIMIT: издержки 5bps у всех —',
		'мейкер-ребейт только улучшил бы; заполнение по open при гэпе вниз (реалистично).',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve('ci-results/d6-short-and-limit.md'), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-census-short.{json}, d6-limit-entry.{json}, d6-short-and-limit.md')
}

void main()
