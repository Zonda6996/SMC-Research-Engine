import type { MarketStructure } from '@/models/structure/MarketStructure.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export class MarketStructureEngine {
	private readonly state: MarketStructure = {}

	public update(point: StructurePoint): void {
		const previous = this.state.lastPoint

		if (
			previous &&
			point.type === 'high' &&
			point.label === 'HH' &&
			previous.type === 'low'
		) {
			this.state.protectedLow = previous
		}

		if (
			previous &&
			point.type === 'low' &&
			point.label === 'LL' &&
			previous.type === 'high'
		) {
			this.state.protectedHigh = previous
		}

		this.state.lastPoint = point
	}

	public getState(): Readonly<MarketStructure> {
		return {
			...this.state,
		}
	}
}
