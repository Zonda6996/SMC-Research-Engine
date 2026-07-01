import type { Leg } from '../models/Leg.js'
import type { StructurePoint } from '../models/StructurePoint.js'

export class LegEngine {
	build(points: StructurePoint[]): Leg[] {
		const legs: Leg[] = []

		for (let i = 0; i < points.length; i++) {
			const start = points[i]

			if (!start) continue

			// ==========================
			// Bearish Leg (HH -> LL)
			// ==========================
			if (start.type === 'high' && start.label === 'HH') {
				let end: StructurePoint | undefined

				for (let j = i + 1; j < points.length; j++) {
					const current = points[j]

					if (!current) continue

					// нашли LL
					if (current.type === 'low' && current.label === 'LL') {
						// обновляем самый глубокий LL
						if (!end || current.price < end.price) {
							end = current
						}
					}

					// встретили новый HH → заканчиваем поиск
					if (current.type === 'high' && current.label === 'HH') {
						break
					}
				}

				if (end) {
					legs.push({
						start,
						end,
						direction: 'bearish',
					})
				}
			}

			// ==========================
			// Bullish Leg (LL -> HH)
			// ==========================
			if (start.type === 'low' && start.label === 'LL') {
				let end: StructurePoint | undefined

				for (let j = i + 1; j < points.length; j++) {
					const current = points[j]

					if (!current) continue

					if (current.type === 'high' && current.label === 'HH') {
						if (!end || current.price > end.price) {
							end = current
						}
					}

					if (current.type === 'low' && current.label === 'LL') {
						break
					}
				}

				if (end) {
					legs.push({
						start,
						end,
						direction: 'bullish',
					})
				}
			}
		}

		return legs
	}
}
