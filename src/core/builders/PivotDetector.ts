// PivotDetector.ts

import type { Candle } from '@/models/price/Candle.js'
import type { Pivot } from '@/models/structure/Pivot.js'

export class PivotDetector {
	constructor(private readonly window: number = 2) {
		if (window < 1) {
			throw new Error('Window must be greater than 0')
		}
	}

	public detect(candles: Candle[]): Pivot[] {
		const pivots: Pivot[] = []

		for (
			let index = this.window;
			index < candles.length - this.window;
			index++
		) {
			const candle = candles[index]!

			if (this.isPivotHigh(candles, index)) {
				pivots.push({
					index,
					timestamp: candle.timestamp,
					price: candle.high,
					type: 'high',
				})
			}

			if (this.isPivotLow(candles, index)) {
				pivots.push({
					index,
					timestamp: candle.timestamp,
					price: candle.low,
					type: 'low',
				})
			}
		}

		return pivots
	}

	private isPivotHigh(candles: Candle[], index: number): boolean {
		const current = candles[index]!.high

		for (let offset = 1; offset <= this.window; offset++) {
			if (candles[index - offset]!.high >= current) return false
			if (candles[index + offset]!.high >= current) return false
		}

		return true
	}

	private isPivotLow(candles: Candle[], index: number): boolean {
		const current = candles[index]!.low

		for (let offset = 1; offset <= this.window; offset++) {
			if (candles[index - offset]!.low <= current) return false
			if (candles[index + offset]!.low <= current) return false
		}

		return true
	}
}
