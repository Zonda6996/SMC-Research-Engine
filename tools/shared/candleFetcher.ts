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

export const TF_MS: Record<string, number> = {
	'1m': 60_000,
	'5m': 300_000,
	'15m': 900_000,
	'30m': 1_800_000,
	'1h': 3_600_000,
	'4h': 14_400_000,
	'1d': 86_400_000,
}

export type MarketKind = 'spot' | 'futures'

/**
 * Постраничная загрузка: Binance отдаёт максимум 1000 свечей за запрос,
 * для больших лимитов идём страницами от рассчитанного `since` вперёд.
 * binanceusdm = USDT-M perpetual futures: у низколиквидных альтов
 * фьючерсные свечи чище спотовых — меньше рваных фитилей.
 */
export async function fetchCandlesPaginated(
	symbol: string,
	timeframe: string,
	limit: number,
	market: MarketKind = 'spot',
): Promise<Candle[]> {
	const capped = Math.min(limit, MAX_CANDLES)

	const tfMs = TF_MS[timeframe]
	if (!tfMs) throw new Error(`Unknown timeframe: ${timeframe}`)

	const { default: ccxt } = await import('ccxt')
	const exchange = market === 'futures' ? new ccxt.binanceusdm() : new ccxt.binance()
	const since = Date.now() - capped * tfMs

	const all: number[][] = []
	let cursor = since
	while (all.length < capped) {
		const page = await exchange.fetchOHLCV(symbol, timeframe, cursor, BINANCE_PAGE_LIMIT)
		if (page.length === 0) break
		all.push(...(page as number[][]))
		const lastTs = Number(page[page.length - 1]![0])
		const nextCursor = lastTs + tfMs
		if (nextCursor <= cursor) break // защита от зацикливания
		cursor = nextCursor
	}

	return all.slice(-capped).map(([timestamp, open, high, low, close, volume]) => ({
		timestamp: Number(timestamp),
		open: Number(open),
		high: Number(high),
		low: Number(low),
		close: Number(close),
		volume: Number(volume),
	}))
}
