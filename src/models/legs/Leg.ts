import type { StructurePoint } from "../structure/StructurePoint.js"

export type LegDirection = 'bullish' | 'bearish'

export interface Leg {
	start: StructurePoint
	end: StructurePoint

	direction: LegDirection

	range: number
	candles: number
	duration: number
}
