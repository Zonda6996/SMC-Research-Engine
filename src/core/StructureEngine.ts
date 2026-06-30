import type { Pivot } from '../models/Pivot.js'
import type { Swing } from '../models/Swing.js'
import type {
	StructurePoint,
	StructureLabel,
} from '../models/StructurePoint.js'

export class StructureEngine {
	public build(swings: Swing[]): StructurePoint[] {
		const structure: StructurePoint[] = []

		let previousHigh: Swing | null = null
		let previousLow: Swing | null = null

		for (const swing of swings) {
			let label: StructureLabel | 'UNKNOWN' = 'UNKNOWN'

			if (swing.type === 'high') {
				if (previousHigh) {
					label = swing.price > previousHigh.price ? 'HH' : 'LH'
				}

				previousHigh = swing
			} else {
				if (previousLow) {
					label = swing.price > previousLow.price ? 'HL' : 'LL'
				}

				previousLow = swing
			}

			structure.push({
				...swing,
				label,
			})
		}

		return structure
	}
}
