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
	/**
	 * Индекс свечи, начиная с которой эта trend-запись «существует» для
	 * downstream-потребителей (BOS/CHoCH-детектор, визуализатор).
	 *
	 * Trend вычисляется по structure-метке, которая сама подтверждается только
	 * спустя `window` свечей (см. PivotDetector). До этого момента использовать
	 * эту trend-запись — look-ahead bias. Поэтому confirmedAtIndex = index + window.
	 *
	 * Фундамент для look-ahead-free BOS/CHoCH (баг №5): детектор берёт последнюю
	 * запись с confirmedAtIndex <= текущая свеча, а не просто последнюю с
	 * index <= текущая свеча.
	 */
	confirmedAtIndex: number
}
