import type { StructurePoint } from './StructurePoint.js'

export type ExternalDirection = 'bullish' | 'bearish'

export interface ExternalLeg {
	high: StructurePoint
	low: StructurePoint
	direction: ExternalDirection
}
