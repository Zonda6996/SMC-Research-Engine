import type { Leg, LegDirection } from '@/models/legs/Leg.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export class SwingLegEngine {
	private createLeg(
		start: StructurePoint,
		end: StructurePoint,
		direction: LegDirection,
	): Leg {
		return {
			start,
			end,
			direction,

			range: Math.abs(end.price - start.price),
			candles: end.index - start.index,
			duration: end.timestamp - start.timestamp,
		}
	}

	build(points: StructurePoint[]): Leg[] {
		const legs: Leg[] = []

		for (let i = 0; i < points.length - 1; i++) {
			const start = points[i]
			const end = points[i + 1]

			if (!start || !end) continue

			// На всякий случай убеждаемся,
			// что точки действительно чередуются.
			if (start.type === end.type) continue

			const direction: LegDirection =
				start.type === 'low' ? 'bullish' : 'bearish'

			legs.push(this.createLeg(start, end, direction))
		}

		return legs
	}
}
