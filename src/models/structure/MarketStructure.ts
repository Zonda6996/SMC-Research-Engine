// MarketStructure.ts

import type { BreachedLevel } from '@/models/structure/BreachedLevel.js'
import type { ProtectedState } from '@/models/structure/ProtectedState.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export type Trend = 'bullish' | 'bearish' | 'range'

export interface MarketStructure extends ProtectedState {
	lastPoint?: StructurePoint
	/**
	 * Protected-уровни, пробитые ценой (закрытием свечи) до того,
	 * как сформировалась следующая противоположная экстремальная точка.
	 * Фикс бага №3. Накопительная история — пробитые уровни не
	 * реактивируются, только копятся здесь.
	 */
	breached: BreachedLevel[]
	// trend: Trend
	// lastBos?: StructurePoint
	// lastChoch?: StructurePoint
}
