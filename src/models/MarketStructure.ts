// MarketStructure.ts

import type { ProtectedState } from './ProtectedState.js'
import type { StructurePoint } from './StructurePoint.js'
import type { ExternalLeg } from './ExternalLeg.js'

export type Trend = 'bullish' | 'bearish' | 'range'

export interface MarketStructure extends ProtectedState {
	trend: Trend
	lastPoint?: StructurePoint
	lastBos?: StructurePoint
	lastChoch?: StructurePoint
	externalLeg?: ExternalLeg
}
