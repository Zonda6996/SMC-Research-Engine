// SwingEngine.ts

import type { Pivot } from '@/models/structure/Pivot.js'
import type { Swing } from '@/models/structure/Swing.js'

export class SwingEngine {
	public build(pivots: Pivot[]): Swing[] {
		const swings: Swing[] = []

		for (const pivot of pivots) {
			const last = swings.at(-1)

			if (!last) {
				swings.push({ ...pivot })
				continue
			}

			if (last.type !== pivot.type) {
				swings.push({ ...pivot })
				continue
			}

			if (pivot.type === 'high' && pivot.price > last.price) {
				swings[swings.length - 1] = { ...pivot }
			}

			if (pivot.type === 'low' && pivot.price < last.price) {
				swings[swings.length - 1] = { ...pivot }
			}
		}

		return swings
	}
}
