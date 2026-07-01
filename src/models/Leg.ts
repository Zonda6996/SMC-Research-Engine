import type { StructurePoint } from './StructurePoint.js'

export type LegDirection = 'bullish' | 'bearish'

export interface Leg {
	start: StructurePoint
	end: StructurePoint

	direction: LegDirection

	range: number
	candles: number
	duration: number
}
