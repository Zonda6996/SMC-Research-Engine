import type { ATRPoint } from '../models/ATRPoint.js'
import type { Leg } from '../models/Leg.js'
import type { LegStrength } from '../models/LegStrength.js'

export class LegStrengthEngine {
	build(legs: Leg[], atr: ATRPoint[]): LegStrength[] {
		const result: LegStrength[] = []

		for (const leg of legs) {
			const startIndex = Math.min(leg.start.index, leg.end.index)
			const endIndex = Math.max(leg.start.index, leg.end.index)

			const atrInsideLeg = atr.filter(
				point => point.index >= startIndex && point.index <= endIndex,
			)

			if (atrInsideLeg.length === 0) continue

			const averageAtr =
				atrInsideLeg.reduce((sum, point) => sum + point.value, 0) /
				atrInsideLeg.length

			const range = Math.abs(leg.end.price - leg.start.price)

			const strength = range / averageAtr

			result.push({
				leg,
				range,
				averageAtr,
				strength,
			})
		}

		return result
	}
}
