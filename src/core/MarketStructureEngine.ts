import type { MarketStructure } from '../models/MarketStructure.js'
import type { StructurePoint } from '../models/StructurePoint.js'

export class MarketStructureEngine {
	private readonly state: MarketStructure = {
		trend: 'range',
	}

	public process(points: StructurePoint[]): MarketStructure {
		for (const point of points) {
			this.update(point)
		}

		return this.state
	}

	private update(point: StructurePoint): void {
		const previous = this.state.lastPoint

		// HH защищает предыдущий LOW
		if (
			previous &&
			point.type === 'high' &&
			point.label === 'HH' &&
			previous.type === 'low'
		) {
			this.state.protectedLow = previous
		}

		// LL защищает предыдущий HIGH
		if (
			previous &&
			point.type === 'low' &&
			point.label === 'LL' &&
			previous.type === 'high'
		) {
			this.state.protectedHigh = previous
		}

		// Запоминаем последнюю обработанную структуру
		this.state.lastPoint = point

		// Инициализация первой External Leg
		if (!this.state.externalLeg && previous) {
			// HH после LOW
			if (
				point.type === 'high' &&
				point.label === 'HH' &&
				previous.type === 'low'
			) {
				this.state.externalLeg = {
					direction: 'bullish',
					high: point,
					low: previous,
				}
			}

			// LL после HIGH
			if (
				point.type === 'low' &&
				point.label === 'LL' &&
				previous.type === 'high'
			) {
				this.state.externalLeg = {
					direction: 'bearish',
					high: previous,
					low: point,
				}
			}
		}
	}
}
