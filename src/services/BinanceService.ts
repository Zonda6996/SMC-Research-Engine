import ccxt from 'ccxt'

import type { Candle } from '@/models/price/Candle.js'
import type { GetCandlesOptions } from '@/models/price/GetCandleOptions.js'

export class BinanceService {
	private readonly exchange = new ccxt.binance()

	public async getCandles(options: GetCandlesOptions): Promise<Candle[]> {
		const { symbol, timeframe, limit } = options

		const ohlcv = await this.exchange.fetchOHLCV(
			symbol,
			timeframe,
			undefined,
			limit,
		)

		return ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
			timestamp: Number(timestamp),
			open: Number(open),
			high: Number(high),
			low: Number(low),
			close: Number(close),
			volume: Number(volume),
		}))
	}
}
