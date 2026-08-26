/**
 * D6 × TIDAL portfolio feasibility — первая численная проверка зонтика (решение автора 2026-08-24).
 * Нога A: carry SELECT (Tidal-Research, reports/artifacts/altcoin-carry-final-001/select-daily-returns.csv,
 *          2021-01-01…2026-06-30, дневные доли возврата, net их издержек).
 * Нога B: Doppler (мажоры, STANDARD −15/−5, окно 8ч на 1h, контроль: структурный стоп-первым + 72ч,
 *          net 5bps + funding) — дневные суммы по сделкам, фиксированный номинал.
 * Склейка: 50/50 daily (0.5·carry + 0.5·doppler в каждый день), без ребаланс-тонкостей.
 * Метрики: total (compounded), Sharpe (×√365), maxDD, корреляция, поведение carry в активные дни Doppler.
 * ⚠ Оценка осуществимости, не prereg: нога B in-sample; допущение 50/50; у carry своя вселенная (10 перпов).
 * Запуск: npx tsx ci/research/runD6TidalPortfolio.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const CARRY_CSV = 'D:/FrontEnd/2025/Projects/Tidal-Research/reports/artifacts/altcoin-carry-final-001/select-daily-returns.csv'
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
const OUT_JSON = 'ci-results/d6-tidal-portfolio.json'
const OUT_MD = 'ci-results/d6-tidal-portfolio.md'

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
const mean = (xs: readonly number[]): number => sum(xs) / xs.length

function stats(daily: Map<string, number>): { total: number; sharpe: number; maxDd: number; days: number; activeDays: number } {
	const dates = [...daily.keys()].sort()
	let equity = 1
	let peak = 1
	let maxDd = 0
	const rets: number[] = []
	for (const d of dates) {
		const r = daily.get(d)!
		equity *= 1 + r
		peak = Math.max(peak, equity)
		maxDd = Math.max(maxDd, 1 - equity / peak)
		rets.push(r)
	}
	const active = rets.filter((r) => r !== 0)
	const sd = active.length > 1 ? Math.sqrt(mean(active.map((r) => (r - mean(active)) ** 2))) : NaN
	return { total: equity - 1, sharpe: Number.isFinite(sd) && sd > 0 ? (mean(active) / sd) * Math.sqrt(365) : NaN, maxDd, days: dates.length, activeDays: active.length }
}

async function main(): Promise<void> {
	// Нога A: carry
	const carry = new Map<string, number>()
	for (const line of readFileSync(resolve(CARRY_CSV), 'utf8').split('\n').slice(1).filter(Boolean)) {
		const [date, ret] = line.split(',')
		carry.set(date!, Number(ret))
	}

	// Нога B: Doppler (мажоры, STANDARD, окно 8ч на 1h, контроль)
	if (createHash('sha256').update(readFileSync(resolve(MANIFEST_PATH))).digest('hex') !== MANIFEST_SHA256) throw new Error('manifest hash')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; candleFile: string; candleSha256: string; fundingFile: string }> }
	interface Trade { date: string; v: number }
	const trades: Trade[] = []
	for (const entry of manifest.symbols) {
		if (createHash('sha256').update(readFileSync(resolve(DATA_DIR, entry.candleFile))).digest('hex') !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const oi = alignArchiveMetrics(points, candles).oi
		const atr200 = arrowAtr200(candles)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as Array<{ timestamp: number; rate: number; markPrice: number }>
		const closes = candles.map((c) => c.close)
		let last = -Infinity
		for (let i = WINDOW_BARS; i + 1 < candles.length; i++) {
			const now = oi[i], past = oi[i - WINDOW_BARS]!
			if (now == null || past == null || past <= 0) continue
			if (!(now / past - 1 <= OI_DROP && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= PRICE_DROP)) continue
			if (i - last < GAP_BARS) continue
			last = i
			const atr = atr200[i]
			if (!Number.isFinite(atr) || atr! <= 0) continue
			const entryIdx = i + 1
			if (entryIdx + HOLD_BARS - 1 > candles.length - 1) continue
			const entryBar = candles[entryIdx]!
			const entryOpen = entryBar.open
			const flushLow = Math.min(...candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
			const stop = flushLow - 0.5 * atr!
			let exitIdx = entryIdx + HOLD_BARS - 1
			let exitPrice = candles[exitIdx]!.close
			for (let k = entryIdx; k <= exitIdx; k++) {
				if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; break }
			}
			let fundingQuote = 0
			for (const f of funding) {
				if (f.timestamp < entryBar.timestamp || f.timestamp >= candles[exitIdx]!.timestamp) continue
				fundingQuote += -f.rate * f.markPrice
			}
			trades.push({ date: new Date(entryBar.timestamp).toISOString().slice(0, 10), v: exitPrice / entryOpen - 1 + fundingQuote / entryOpen - ROUND_TRIP_COST })
		}
		console.log(`${entry.symbol}: сделок всего ${trades.length}`)
	}

	const doppler = new Map<string, number>()
	for (const t of trades) doppler.set(t.date, (doppler.get(t.date) ?? 0) + t.v)

	// Пересечение календарей
	const dates = [...carry.keys()].filter((d) => d >= '2021-01-01' && d <= '2026-06-30').sort()
	const carryS = new Map<string, number>()
	const dopplerS = new Map<string, number>()
	const combo = new Map<string, number>()
	for (const d of dates) {
		const c = carry.get(d) ?? 0
		const dp = doppler.get(d) ?? 0
		carryS.set(d, c)
		dopplerS.set(d, dp)
		combo.set(d, 0.5 * c + 0.5 * dp)
	}

	const sc = stats(carryS)
	const sd = stats(dopplerS)
	const sm = stats(combo)
	const xs = dates.map((d) => dopplerS.get(d)!).filter((x) => x !== 0)
	const corrDays = dates.filter((d) => (dopplerS.get(d) ?? 0) !== 0)
	const corr = (() => {
		if (corrDays.length < 3) return NaN
		const cs = corrDays.map((d) => carryS.get(d)!)
		const ds = corrDays.map((d) => dopplerS.get(d)!)
		const mc = mean(cs), md = mean(ds)
		const num = sum(cs.map((c, i) => (c - mc) * (ds[i]! - md)))
		const den = Math.sqrt(sum(cs.map((c) => (c - mc) ** 2)) * sum(ds.map((d) => (d - md) ** 2)))
		return num / den
	})()

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-tidal-portfolio',
		generatedAt: new Date().toISOString(),
		note: 'Оценка осуществимости зонтика; нога B in-sample; допущение 50/50 daily; carry net их издержек',
		window: { from: dates[0], to: dates[dates.length - 1], days: dates.length },
		dopplerTrades: trades.length,
		dopplerActiveDays: sd.activeDays,
		correlationDopplerVsCarryOnActiveDays: corr,
		legs: { carry: sc, doppler: sd, combo5050: sm },
	}, null, 2))

	const f = (x: number): string => (x * 100).toFixed(1) + '%'
	const md = [
		'# D6 × TIDAL — первая численная проверка зонтика (feasibility)',
		'',
		`Окно: ${dates[0]} … ${dates[dates.length - 1]} (${dates.length} дней). Сделок Doppler: ${trades.length} (активных дней ${sd.activeDays}).`,
		'',
		'| серия | total | Sharpe (ann.) | maxDD | активных дней |',
		'|---|---:|---:|---:|---:|',
		`| Carry SELECT (TIDAL) | ${f(sc.total)} | ${sc.sharpe.toFixed(2)} | ${f(sc.maxDd)} | ${sc.activeDays}/${sc.days} |`,
		`| Doppler (мажоры −15/−5, контроль) | ${f(sd.total)} | ${sd.sharpe.toFixed(2)} | ${f(sd.maxDd)} | ${sd.activeDays}/${sd.days} |`,
		`| **Комбо 50/50 daily** | **${f(sm.total)}** | **${sm.sharpe.toFixed(2)}** | **${f(sm.maxDd)}** | ${sm.activeDays}/${sm.days} |`,
		'',
		`Корреляция carry↔Doppler в активные дни Doppler: **${corr.toFixed(3)}**.`,
		'',
		'⚠ Допущения: нога B in-sample (правило из census); 50/50 daily без тонкостей ребаланса;',
		'у carry своя вселенная (10 перпов) и свои издержки; Doppler — фикс. номинал на сделку.',
		`Сгенерировано ${new Date().toISOString()}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(md.join('\n'))
}

import { createHash } from 'node:crypto'

void main()
