// MarketStructure.ts

import type { BreachedLevel } from '@/models/structure/BreachedLevel.js'
import type { TrendHistoryEntry } from '@/models/structure/TrendHistoryEntry.js'
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
	/**
	 * Финальное значение тренда (последняя запись trendHistory).
	 * Фикс бага №4.
	 */
	trend: Trend
	/**
	 * Эволюция тренда по structure-точкам — по одной записи на точку.
	 * Фундамент для будущего look-ahead-free BOS/CHoCH (баг №5):
	 * каждый момент имеет своё trend, а не один финальный срез.
	 */
	trendHistory: TrendHistoryEntry[]
	// lastBos?: StructurePoint
	// lastChoch?: StructurePoint
}
