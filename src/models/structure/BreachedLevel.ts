// BreachedLevel.ts

import type { StructurePoint } from '@/models/structure/StructurePoint.js'

/**
 * Protected-уровень, пробитый ценой по two-candle confirmation
 * (фикс бага №3, переработанный по авторской логике слома).
 *
 * Правило слома: одного закрытия за уровнем недостаточно — это лишь
 * «свеча пробоя» (кандидат). Слом подтверждается, когда следующая свеча
 * тоже закрывается за уровнем. Если же она закрылась обратно внутрь —
 * это «защита уровня», кандидат сбрасывается, уровень выживает.
 *
 * Оба момента сохраняются: breachIndex — свеча пробоя (1-я),
 * confirmIndex — подтверждающая свеча (2-я, момент слома).
 */
export interface BreachedLevel {
	level: StructurePoint
	breachIndex: number
	breachTimestamp: number
	confirmIndex: number
	confirmTimestamp: number
}
