/**
 * D6 census-карта — ДИАГНОСТИКА на 12 мажорах, БЕЗ вердиктов (решение автора 2026-08-23).
 * Сетка: провал OI −5/−8/−12/−15/−20% × провал цены −3/−5% (окно 8ч, gap 8, LONG next-open).
 * Грубая форма сделки для статистики: структурный стоп flushLow−0.5×ATR200 (стоп первым),
 * таймаут close[entry+71]; сделки без полного горизонта исключаются со счётом.
 * Net = 5bps/side + фактический funding; gross дескриптивно.
 * ⚠ НЕ prereg: выбор правила по этой карте = in-sample; подтверждение — временной OOS-сплит
 * или свежая вселенная Б. События кластеризуются по UTC-дням (каскады бьют по многим активам разом).
 * Данные: кэш preheat (свечи tmp/viz-archive-cache, OI .cache/binance) + funding REST.
 * Запуск: npx tsx ci/research/runD6CensusMajors.ts
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
const OI_THRS = [-0.05, -0.08, -0.12, -0.15, -0.2]
const PX_THRS = [-0.03, -0.05]
const HOUR = 3_600_000
const WINDOW_BARS = 8
const GAP_BARS = 8
const HOLD_BARS = 72
const ROUND_TRIP_COST = 0.001
const FAPI = 'https://fapi.binance.com'
const MARK_INTERVAL_8H = 28_800_000
const OUT_JSON = 'ci-results/d6-census-majors.json'
const OUT_MD = 'ci-results/d6-census-majors.md'

const dayKey = (x: number): string => new Date(x).toISOString().slice(0, 10)
const pct = (x: number | null, d = 2): string => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%'
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response
		try { res = await fetch(url, { signal: AbortSignal.timeout(20_000) }) } catch (e) { if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue } throw e }
		if (res.ok) return await res.json() as T
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue }
		throw new Error(`HTTP ${res.status}`)
	}
}

async function fetchRawPages<T>(firstStartMs: number, untilMs: number, buildUrl: (startMs: number) => string, rowTimestamp: (row: T) => number): Promise<T[]> {
	const out: T[] = []
	let cursor = firstStartMs
	for (let guard = 0; cursor < untilMs && guard < 20_000; guard++) {
		const raw = await getJson<unknown[]>(buildUrl(cursor))
		out.push(...raw as T[])
		if (raw.length < 1000) break
		const lastTs = rowTimestamp(raw[raw.length - 1] as T)
		if (!Number.isSafeInteger(lastTs) || lastTs + 1 <= cursor) throw new Error('Pagination stuck')
		cursor = lastTs + 1
	}
	return out
}

interface RawFundingRow { fundingTime: number | string; fundingRate: number | string }
interface SettledFunding { timestamp: number; rate: number; markPrice: number }

async function fetchFundingSettled(symbol: string, fromMs: number, untilMs: number): Promise<SettledFunding[]> {
	const fundRaw = await fetchRawPages<RawFundingRow>(fromMs, untilMs, (s) => `${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${s}&endTime=${untilMs - 1}&limit=1000`, (r) => Math.floor(Number(r.fundingTime)))
	const markRaw = await fetchRawPages<unknown[]>(fromMs, untilMs, (s) => `${FAPI}/fapi/v1/markPriceKlines?symbol=${symbol}&interval=8h&startTime=${s}&endTime=${untilMs - 1}&limit=1000`, (r) => Number(Array.isArray(r) ? r[0] : NaN))
	const markByInterval = new Map<number, number>()
	for (const row of markRaw) {
		if (!Array.isArray(row)) continue
		const openTime = Number(row[0])
		const open = Number(row[1])
		if (Number.isSafeInteger(openTime) && Number.isFinite(open) && open > 0) markByInterval.set(Math.floor(openTime / MARK_INTERVAL_8H) * MARK_INTERVAL_8H, open)
	}
	const rows: SettledFunding[] = []
	for (const raw of fundRaw) {
		const timestamp = Math.floor(Number(raw.fundingTime))
		const rate = Number(raw.fundingRate)
		if (!Number.isSafeInteger(timestamp) || !Number.isFinite(rate) || timestamp < fromMs || timestamp >= untilMs) continue
		const markPrice = markByInterval.get(Math.floor(timestamp / MARK_INTERVAL_8H) * MARK_INTERVAL_8H)
		if (markPrice != null) rows.push({ timestamp, rate, markPrice })
	}
	return rows.sort((a, b) => a.timestamp - b.timestamp)
}

interface Loaded { symbol: string; candles: Candle[]; oi: Array<number | null>; atr200: number[]; funding: SettledFunding[] }

interface CellStat {
	oiThr: number; pxThr: number
	n: number; symbolsWithEvents: number
	wr: number | null; grossMean: number | null; netMean: number | null
	outcomes: Record<string, number>; excludedNoHorizon: number
	perSymbol: Record<string, number>
	uniqueDays: number
}

async function main(): Promise<void> {
	const info = await getJson<{ symbols: Array<{ symbol: string; onboardDate: number }> }>(`${FAPI}/fapi/v1/exchangeInfo`)
	const loaded: Loaded[] = []
	for (const symbol of MAJORS) {
		const t = Date.now()
		const onboard = info.symbols.find((x) => x.symbol === symbol)?.onboardDate ?? Date.now() - 5 * 365 * 86_400_000
		const candles = await fetchArchiveKlines(symbol, '1h', 'futures', onboard, null)
		const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const oi = alignArchiveMetrics(points, candles).oi
		const fundingFile = resolve(`tmp/d6-census-funding/${symbol}.json`)
		let funding: SettledFunding[]
		try {
			funding = JSON.parse(await import('node:fs').then((m) => m.readFileSync(fundingFile, 'utf8'))) as SettledFunding[]
		} catch {
			funding = await fetchFundingSettled(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
			const { mkdirSync, writeFileSync } = await import('node:fs')
			mkdirSync(resolve('tmp/d6-census-funding'), { recursive: true })
			writeFileSync(fundingFile, JSON.stringify(funding))
		}
		loaded.push({ symbol, candles, oi, atr200: arrowAtr200(candles), funding })
		console.log(`${symbol}: баров ${candles.length}, метрик ${points.length}, funding ${funding.length} (${Math.round((Date.now() - t) / 1000)}с)`)
	}

	const cells: CellStat[] = []
	for (const oiThr of OI_THRS) {
		for (const pxThr of PX_THRS) {
			const stat: CellStat = { oiThr, pxThr, n: 0, symbolsWithEvents: 0, wr: null, grossMean: null, netMean: null, outcomes: {}, excludedNoHorizon: 0, perSymbol: {}, uniqueDays: 0 }
			const nets: number[] = []
			const grosses: number[] = []
			const days = new Set<string>()
			for (const item of loaded) {
				const closes = item.candles.map((c) => c.close)
				let lastAdmitted = -Infinity
				let symbolEvents = 0
				for (let i = WINDOW_BARS; i + 1 < item.candles.length; i++) {
					const oiNow = item.oi[i]
					const oiPast = item.oi[i - WINDOW_BARS]!
					if (oiNow == null || oiPast == null || oiPast <= 0) continue
					if (!(oiNow / oiPast - 1 <= oiThr && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= pxThr)) continue
					if (i - lastAdmitted < GAP_BARS) continue
					lastAdmitted = i
					const atr = item.atr200[i]
					if (!Number.isFinite(atr) || atr! <= 0) continue
					const entryIdx = i + 1
					if (entryIdx + HOLD_BARS - 1 > item.candles.length - 1) { stat.excludedNoHorizon++; continue }
					const entryBar = item.candles[entryIdx]!
					const entryOpen = entryBar.open
					const flushLow = Math.min(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
					const stopLevel = flushLow - 0.5 * atr!
					let exitIdx = entryIdx + HOLD_BARS - 1
					let exitPrice = item.candles[exitIdx]!.close
					let outcome = 'timeout72'
					for (let k = entryIdx; k <= exitIdx; k++) {
						const bar = item.candles[k]!
						if (bar.low <= stopLevel) { exitIdx = k; exitPrice = stopLevel; outcome = 'stop'; break }
					}
					let fundingQuote = 0
					for (const f of item.funding) {
						if (f.timestamp < entryBar.timestamp || f.timestamp >= item.candles[exitIdx]!.timestamp) continue
						fundingQuote += -f.rate * f.markPrice
					}
					const priceRet = exitPrice / entryOpen - 1
					nets.push(priceRet + fundingQuote / entryOpen - ROUND_TRIP_COST)
					grosses.push(priceRet + fundingQuote / entryOpen)
					stat.outcomes[outcome] = (stat.outcomes[outcome] ?? 0) + 1
					days.add(dayKey(entryBar.timestamp))
					symbolEvents++
				}
				if (symbolEvents > 0) { stat.perSymbol[item.symbol] = symbolEvents; stat.symbolsWithEvents++ }
			}
			stat.n = nets.length
			stat.wr = nets.length ? nets.filter((x) => x > 0).length / nets.length : null
			stat.grossMean = nets.length ? sum(grosses) / nets.length : null
			stat.netMean = nets.length ? sum(nets) / nets.length : null
			stat.uniqueDays = days.size
			cells.push(stat)
			console.log(`cell OI${(oiThr * 100).toFixed(0)}% PX${(pxThr * 100).toFixed(0)}%: N=${stat.n} WR=${pct(stat.wr, 1)} net=${pct(stat.netMean)} дней=${stat.uniqueDays}`)
		}
	}

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-census-majors',
		generatedAt: new Date().toISOString(),
		note: 'ДИАГНОСТИКА без вердиктов; выбор правила по карте = in-sample; подтверждение — временной OOS или вселенная Б',
		grid: { oiThr: OI_THRS, pxThr: PX_THRS, windowBars: WINDOW_BARS, gapBars: GAP_BARS, holdBars: HOLD_BARS, stop: 'flushLow-0.5*ATR200, стоп первым', costs: '5bps/side + фактический funding' },
		universe: MAJORS,
		cells,
	}, null, 2))

	const cellText = (s: CellStat): string => s.n === 0 ? '—' : `**${s.n}** · WR ${pct(s.wr, 0)} · net ${pct(s.netMean, 2)}`
	const md = [
		'# D6 census-карта — мажоры (ДИАГНОСТИКА, без вердиктов)',
		'',
		'Ячейка = `N событий · WR · средняя net` (5bps/side + funding; стоп структурный, стоп-первым, таймаут 72ч).',
		'Событие: `ΔOI_8h ≤ порог И ΔP_8h ≤ порог` → LONG next-open, gap 8 баров. Окно 8ч везде.',
		'',
		'| провал OI \\ провал цены | −3% | −5% |',
		'|---|---|---|',
		...OI_THRS.map((o) => {
			const row = PX_THRS.map((p) => {
				const s = cells.find((c) => c.oiThr === o && c.pxThr === p)!
				return s.n === 0 ? '—' : cellText(s)
			})
			return `| ${(o * 100).toFixed(0)}% | ${row.join(' | ')} |`
		}),
		'',
		'Справочно, ячейка −15%/−3% (замороженное правило): события по символам — ' +
			(cells.find((c) => c.oiThr === -0.15 && c.pxThr === -0.03) !
				? Object.entries(cells.find((c) => c.oiThr === -0.15 && c.pxThr === -0.03)!.perSymbol).map(([s, n]) => `${s.replace('USDT', '')}:${n}`).join(', ')
				: 'нет событий'),
		'',
		'⚠ Оговорки: (1) выбор правила по этой карте = in-sample — подтверждение только временным OOS-сплитом',
		'или свежей вселенной Б; (2) события кластеризуются по UTC-дням (каскады общие) — WR/средняя по пулу',
		'оптимистичнее независимых сделок; (3) сделки без полного горизонта исключены: ' +
			cells.map((c) => `${(c.oiThr * 100).toFixed(0)}/${(c.pxThr * 100).toFixed(0)}:${c.excludedNoHorizon}`).filter((x) => !x.endsWith(':0')).join(', '),
		'',
		`Сгенерировано ${new Date().toISOString()}; данные — кэш preheat + funding REST.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-census-majors.{json,md}')
}

void main()
