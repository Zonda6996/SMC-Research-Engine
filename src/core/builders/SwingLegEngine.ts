import type { Leg, LegDirection } from '@/models/legs/Leg.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'
import { buildLeg } from '../legs/buildLeg.js'

export class SwingLegEngine {
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

			legs.push(buildLeg(start, end, direction))
		}

		return legs
	}
}
