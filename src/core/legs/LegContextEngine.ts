import type { Leg } from '@/models/legs/Leg.js'
import type { LegContext } from '@/models/legs/LegContext.js'

export class LegContextEngine {
	build(legs: Leg[]): LegContext[] {
		return legs.map((leg, index) => {
			const previous = index > 0 ? legs[index - 1] : undefined
			const next = index < legs.length - 1 ? legs[index + 1] : undefined

			const context: LegContext = {
				leg,
				index,
				isLast: index === legs.length - 1,
				insideLegs: [],
			}

			if (previous) {
				context.previous = previous
			}

			if (next) {
				context.next = next
			}

			return context
		})
	}
}
