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
	'1h': 3_600_000,
	'2h': 7_200_000,
	'4h': 14_400_000,
	'1d': 86_400_000,
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
	const since = end - capped * tfMs

	const all: number[][] = []
	let cursor = since
	while (all.length < capped) {
		const page = await exchange.fetchOHLCV(symbol, timeframe, cursor, BINANCE_PAGE_LIMIT)
		if (page.length === 0) break
		all.push(...(page as number[][]))
		const lastTs = Number(page[page.length - 1]![0])
		const nextCursor = lastTs + tfMs
		if (nextCursor <= cursor) break // защита от зацикливания
		if (nextCursor >= end) break // правая граница окна достигнута
		cursor = nextCursor
	}

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
