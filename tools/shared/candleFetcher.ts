// candleFetcher.ts
//
// Постраничная загрузка свечей с Binance (spot/futures) для инструментов
// (визуализатор, batch-раннер). НЕ часть пайплайна — пайплайн работает
// со своим BinanceService.

import type { Candle } from '../../src/models/price/Candle.js'

/** Максимум свечей за один запрос к Binance (лимит их API). */
export const BINANCE_PAGE_LIMIT = 1000
/** Потолок инструментов — защита от случайной загрузки мегаистории. */
export const MAX_CANDLES = 20_000
/**
 * Расширенный потолок для младшего ТФ мульти-ТФ прогонов: свечей LTF нужно
 * в 12–16 раз больше, чем HTF (60k страниц API — осознанная цена).
 */
export const MAX_CANDLES_LTF = 60_000

export const TF_MS: Record<string, number> = {
	'1m': 60_000,
	'5m': 300_000,
	'15m': 900_000,
	'30m': 1_800_000,
	'45m': 2_700_000,
	'1h': 3_600_000,
	'2h': 7_200_000,
	'3h': 10_800_000,
	'4h': 14_400_000,
	'1d': 86_400_000,
	'1w': 604_800_000,
}

export type MarketKind = 'spot' | 'futures'

/**
 * Постраничная загрузка: Binance отдаёт максимум 1000 свечей за запрос,
 * для больших лимитов идём страницами от рассчитанного `since` вперёд.
 * binanceusdm = USDT-M perpetual futures: у низколиквидных альтов
 * фьючерсные свечи чище спотовых — меньше рваных фитилей.
 *
 * `untilMs` — правая граница окна (walk-forward): «limit свечей, ЗАКАНЧИВАЯ
 * этим моментом». По умолчанию — текущий момент. Свечи с timestamp >= untilMs
 * отбрасываются, чтобы граница периодов была жёсткой.
 */
export async function fetchCandlesPaginated(
	symbol: string,
	timeframe: string,
	limit: number,
	market: MarketKind = 'spot',
	untilMs: number | null = null,
	/** Потолок свечей: MAX_CANDLES по умолчанию, MAX_CANDLES_LTF для мульти-ТФ. */
	maxCap: number = MAX_CANDLES,
): Promise<Candle[]> {
	const capped = Math.min(limit, maxCap)

	const tfMs = TF_MS[timeframe]
	if (!tfMs) throw new Error(`Unknown timeframe: ${timeframe}`)

	const { default: ccxt } = await import('ccxt')
	const exchange = market === 'futures' ? new ccxt.binanceusdm() : new ccxt.binance()
	const end = untilMs ?? Date.now()
	const since = Math.max(0, end - capped * tfMs)

	// Страницы известны заранее (окно since..end фиксировано), поэтому качаем
	// их параллельными пачками и дедуплицируем по timestamp: у коротких
	// историй ранние страницы возвращают один и тот же левый край данных.
	const pageStarts: number[] = []
	for (let cursor = since; cursor < end; cursor += BINANCE_PAGE_LIMIT * tfMs) pageStarts.push(cursor)
	const byTs = new Map<number, number[]>()
	const PARALLEL_PAGES = 6
	for (let i = 0; i < pageStarts.length; i += PARALLEL_PAGES) {
		const pages = await Promise.all(pageStarts.slice(i, i + PARALLEL_PAGES).map((start) =>
			exchange.fetchOHLCV(symbol, timeframe, start, BINANCE_PAGE_LIMIT)))
		for (const page of pages) for (const row of page as number[][]) byTs.set(Number(row[0]), row as number[])
	}
	const all = [...byTs.values()].sort((a, b) => Number(a[0]!) - Number(b[0]!))

	const bounded = all.filter((row) => Number(row[0]) < end)
	return bounded.slice(-capped).map(([timestamp, open, high, low, close, volume]) => ({
		timestamp: Number(timestamp),
		open: Number(open),
		high: Number(high),
		low: Number(low),
		close: Number(close),
		volume: Number(volume),
	}))
}

/**
 * Агрегация LTF-свечей в HTF (напр. 5m → 1h). Для мульти-ТФ прогонов старший
 * ряд СТРОИТСЯ из младшего, а не качается отдельно: окна двух ТФ гарантированно
 * покрывают один календарный диапазон, и одна загрузка вместо двух.
 *
 * Границы групп — epoch-aligned (floor(ts / htfMs) × htfMs), как у Binance.
 * Неполные КРАЙНИЕ группы отбрасываются: ведущая (первая LTF-свеча не на
 * границе HTF-бара) и замыкающая (последняя LTF-свеча не закрывает HTF-бар) —
 * недостроенный HTF-бар в пайплайне был бы look-ahead-искажением.
 * Пропуски внутри середины ряда (редкие дыры биржи) группу не отменяют.
 */
export function aggregateCandles(ltf: Candle[], ltfTf: string, htfTf: string): Candle[] {
	const ltfMs = TF_MS[ltfTf]
	const htfMs = TF_MS[htfTf]
	if (!ltfMs || !htfMs) throw new Error(`Unknown timeframe: ${ltfTf} / ${htfTf}`)
	if (htfMs % ltfMs !== 0 || htfMs <= ltfMs) {
		throw new Error(`HTF ${htfTf} must be a whole multiple of LTF ${ltfTf}`)
	}

	const groups = new Map<number, Candle[]>()
	for (const candle of ltf) {
		const bucket = Math.floor(candle.timestamp / htfMs) * htfMs
		const list = groups.get(bucket)
		if (list) list.push(candle)
		else groups.set(bucket, [candle])
	}

	const buckets = [...groups.keys()].sort((a, b) => a - b)
	const result: Candle[] = []
	for (const bucket of buckets) {
		const list = groups.get(bucket)!
		list.sort((a, b) => a.timestamp - b.timestamp)
		const first = list[0]!
		const last = list[list.length - 1]!
		// Крайние неполные группы: ведущая не начинается на границе бара,
		// замыкающая не дотягивает до закрытия бара.
		if (bucket === buckets[0] && first.timestamp !== bucket) continue
		if (bucket === buckets[buckets.length - 1] && last.timestamp + ltfMs !== bucket + htfMs) continue
		result.push({
			timestamp: bucket,
			open: first.open,
			high: Math.max(...list.map((c) => c.high)),
			low: Math.min(...list.map((c) => c.low)),
			close: last.close,
			volume: list.reduce((sum, c) => sum + c.volume, 0),
		})
	}
	return result
}

/** Выравнивание внешнего ряда к свечам: carry-forward после первой точки, null до неё. */
export function alignSeriesToCandles(
	points: Array<{ timestamp: number; value: number }>,
	candles: Candle[],
): Array<number | null> {
	const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp)
	const out: Array<number | null> = []
	let j = 0
	let last: number | null = null
	for (const candle of candles) {
		while (j < sorted.length && sorted[j]!.timestamp <= candle.timestamp) { last = sorted[j]!.value; j++ }
		out.push(last)
	}
	return out
}

export interface HeatmapAuxSeries {
	oi: Array<number | null>
	takerBuyRatio: Array<number | null>
	oiBars: number
	takerBars: number
}

const OI_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'])

function oiPeriodFor(timeframe: string): string {
	if (OI_PERIODS.has(timeframe)) return timeframe
	const tfMs = TF_MS[timeframe] ?? 0
	return tfMs >= TF_MS['1d']! ? '1d' : '1h'
}

/**
 * v2.0: ряды точности для heatmap (OI + taker buy/sell). Полностью fail-soft:
 * любая ошибка сети/биржи даёт null-ряды и движок падает на объём-прокси и 50/50.
 * OI: Binance хранит ~30 дней истории — старый хвост остаётся объёмным прокси (гибрид).
 * Taker split: сырые klines (поле 9 = taker buy base volume) на всю историю окна.
 */
export async function fetchHeatmapAux(
	symbol: string,
	timeframe: string,
	candles: Candle[],
	market: MarketKind = 'futures',
): Promise<HeatmapAuxSeries> {
	const nulls = (): Array<number | null> => candles.map(() => null)
	let oi = nulls()
	let taker = nulls()
	const tfMs = TF_MS[timeframe]
	if (!candles.length || !tfMs) return { oi, takerBuyRatio: taker, oiBars: 0, takerBars: 0 }
	const start = candles[0]!.timestamp
	const end = candles[candles.length - 1]!.timestamp + tfMs
	const { default: ccxt } = await import('ccxt')
	try {
		const raw = market === 'futures' ? new ccxt.binanceusdm() : new ccxt.binance()
		const id = symbol.replace('/', '').replace(':USDT', '')
		const call = (params: Record<string, unknown>): Promise<unknown> =>
			market === 'futures'
				? (raw as unknown as { fapiPublicGetKlines: (p: unknown) => Promise<unknown> }).fapiPublicGetKlines(params)
				: (raw as unknown as { publicGetKlines: (p: unknown) => Promise<unknown> }).publicGetKlines(params)
		const pageStarts: number[] = []
		for (let cursor = start; cursor < end; cursor += BINANCE_PAGE_LIMIT * tfMs) pageStarts.push(cursor)
		const byTs = new Map<number, number>()
		const PARALLEL_PAGES = 6
		for (let i = 0; i < pageStarts.length; i += PARALLEL_PAGES) {
			const pages = await Promise.all(pageStarts.slice(i, i + PARALLEL_PAGES).map((s) =>
				call({ symbol: id, interval: timeframe, startTime: s, limit: BINANCE_PAGE_LIMIT })))
			for (const page of pages) for (const row of page as Array<Array<string | number>>) {
				const vol = Number(row[5])
				const tb = Number(row[9])
				if (vol > 0 && Number.isFinite(tb)) byTs.set(Number(row[0]), Math.min(1, Math.max(0, tb / vol)))
			}
		}
		taker = candles.map((cd) => byTs.get(cd.timestamp) ?? null)
	} catch { taker = nulls() }
	try {
		const fut = new ccxt.binanceusdm() as unknown as {
			fetchOpenInterestHistory: (s: string, tf: string, since: number, limit: number) => Promise<Array<{ timestamp?: number; openInterestAmount?: number; openInterestValue?: number }>>
		}
		const period = oiPeriodFor(timeframe)
		const periodMs = TF_MS[period]!
		const points: Array<{ timestamp: number; value: number }> = []
		let cursor = Math.max(start, Date.now() - 29 * 86_400_000)
		for (let guard = 0; cursor < end && guard < 80; guard++) {
			const page = await fut.fetchOpenInterestHistory(symbol, period, cursor, 500)
			if (!page.length) break
			for (const p of page) if (p.timestamp != null) points.push({ timestamp: p.timestamp, value: Number(p.openInterestAmount ?? p.openInterestValue ?? 0) })
			const lastTs = page[page.length - 1]!.timestamp ?? cursor
			if (lastTs + periodMs <= cursor) break
			cursor = lastTs + periodMs
		}
		if (points.length) oi = alignSeriesToCandles(points, candles)
	} catch { oi = nulls() }
	return { oi, takerBuyRatio: taker, oiBars: oi.filter((x) => x != null).length, takerBars: taker.filter((x) => x != null).length }
}
