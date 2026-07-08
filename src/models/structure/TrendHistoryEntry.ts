// TrendHistoryEntry.ts

import type { StructurePoint } from '@/models/structure/StructurePoint.js'
import type { Trend } from '@/models/structure/MarketStructure.js'

/**
 * Запись в истории эволюции тренда — по одной на каждую structure-точку.
 *
 * Фундамент для будущего look-ahead-free BOS/CHoCH-детектора (баг №5):
 * каждый момент времени имеет своё значение trend, а не одно финальное.
 * BOS/CHoCH берёт trend-на-момент-свечи, а не финальный срез.
 */
export interface TrendHistoryEntry {
	index: number
	label: StructurePoint['label']
	trend: Trend
}
