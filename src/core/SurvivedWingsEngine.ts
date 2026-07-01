import type { StructurePoint } from '../models/StructurePoint.js'
import type { SurvivedWings } from '../models/SurvivedWings.js'

export class SurvivedWingsEngine {
	build(points: StructurePoint[]): SurvivedWings[] {
		return points.map((point, index) => {
			let strength = 0

			for (let i = index + 1; i < points.length; i++) {
				const next = points[i]

				if (!next) continue

				// HIGH
				if (point.type === 'high') {
					if (next.type !== 'high') continue

					// появился новый HH → жизнь закончилась
					if (next.label === 'HH') break

					// любой LH пережили
					strength++
				}

				// LOW
				if (point.type === 'low') {
					if (next.type !== 'low') continue

					if (next.label === 'LL') break

					strength++
				}
			}

			return {
				...point,
				strength,
			}
		})
	}
}
