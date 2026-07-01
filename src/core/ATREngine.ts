import type { Candle } from '../models/Candle.js'
import type { ATRPoint } from '../models/ATRPoint.js'

export class ATREngine {
	constructor(private readonly period = 14) {}

	build(candles: Candle[]): ATRPoint[] {
		const result: ATRPoint[] = []

		const trueRanges: number[] = []

		let previousAtr: number | null = null

		for (let i = 1; i < candles.length; i++) {
			const current = candles[i]
			const previous = candles[i - 1]

			if (!current || !previous) continue

			const trueRange = Math.max(
				current.high - current.low,
				Math.abs(current.high - previous.close),
				Math.abs(current.low - previous.close),
			)

			trueRanges.push(trueRange)

			// Ждем первые period свечей
			if (trueRanges.length < this.period) continue

			let atr: number

			// Первый ATR = обычное среднее
			if (previousAtr === null) {
				atr = trueRanges.reduce((sum, value) => sum + value, 0) / this.period
			}
			// Далее формула Wilder
			else {
				atr = (previousAtr * (this.period - 1) + trueRange) / this.period
			}

			previousAtr = atr

			result.push({
				index: i,
				timestamp: current.timestamp,
				value: atr,
			})

			// Чтобы trueRanges не рос бесконечно
			if (trueRanges.length > this.period) {
				trueRanges.shift()
			}
		}

		return result
	}
}
