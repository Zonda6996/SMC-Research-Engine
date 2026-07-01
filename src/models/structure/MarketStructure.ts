// MarketStructure.ts

import type { ProtectedState } from '@/models/structure/ProtectedState.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export type Trend = 'bullish' | 'bearish' | 'range'

export interface MarketStructure extends ProtectedState {
	lastPoint?: StructurePoint
	// trend: Trend
	// lastBos?: StructurePoint
	// lastChoch?: StructurePoint
}
