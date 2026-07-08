import type { Candle } from '@/models/price/Candle.js'
import type { BreachedLevel } from '@/models/structure/BreachedLevel.js'
import type { MarketStructure } from '@/models/structure/MarketStructure.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

/**
 * Автомат подтверждения пробоя protected-уровня.
 *
 * Пробой имеет фазы:
 *  - none      — кандидата нет, уровень активен.
 *  - pending   — пришла 1-я свеча (свеча пробоя), закрывшаяся за уровнем;
 *                уровень пока ЖИВ, слома нет. Ждём 2-ю свечу.
 *
 * Уровней два (low/high) — автоматы независимы.
 */
type BreachPhase = 'none' | 'pending'

interface PendingBreach {
	phase: BreachPhase
	/** Свеча пробоя (1-я), закрывшаяся за уровнем. */
	breachIndex: number
	breachTimestamp: number
}

function none(): PendingBreach {
	return { phase: 'none', breachIndex: -1, breachTimestamp: 0 }
}

/**
 * MarketStructureEngine
 *
 * Инкрементально, по одной structure-точке, поддерживает protected-уровни
 * (protectedLow/protectedHigh) и накопительный список подтверждённых сломов
 * (`breached`).
 *
 * Правило слома (баг №3 v2, по авторской логике со скриншотов): одного
 * закрытия за уровнем недостаточно. Это лишь «свеча пробоя» (кандидат).
 * Слом подтверждается, когда следующая свеча ТОЖЕ закрывается за уровнем:
 *   - 1-я свеча за уровнем → pending (уровень жив).
 *   - 2-я свеча за уровнем  → подтверждённый слом → breach[] + обнулить уровень.
 *   - 2-я свеча закрылась обратно внутрь → «защита уровня», pending сбрасывается,
 *     уровень продолжает жить.
 * Прокол фитилем без закрытия — вообще не пробой.
 *
 * Проверка выполняется на окне свечей `(lastIndex, point.index]` — между прошлой
 * и текущей structure-точкой. Кандидат хранится между вызовами update() (в полях
 * pendingLow/pendingHigh), потому что свеча пробоя и подтверждение могут оказаться
 * по разные стороны structure-точки.
 *
 * Переназначение protected-уровня (новая HH даёт новый protectedLow, новая LL —
 * новый protectedHigh) сбрасывает любой неподтверждённый кандидат: старый уровень
 * больше не защищаемый, его «пробой» не имеет смысла.
 */
export class MarketStructureEngine {
	private readonly state: MarketStructure = { breached: [] }
	private lastIndex = -1
	private pendingLow: PendingBreach = none()
	private pendingHigh: PendingBreach = none()

	public update(point: StructurePoint, candles: Candle[]): void {
		// 1. Гоняем автоматы подтверждения по свечам окна (lastIndex, point.index].
		this.processCandles(point.index, candles)

		// 2. Логика выставления новых protected (без изменений по смыслу):
		//    HH после low → protectedLow = предыдущая low-точка;
		//    LL после high → protectedHigh = предыдущая high-точка.
		//    Переназначение сбрасывает неподтверждённый кандидат.
		const previous = this.state.lastPoint

		if (
			previous &&
			point.type === 'high' &&
			point.label === 'HH' &&
			previous.type === 'low'
		) {
			this.state.protectedLow = previous
			this.pendingLow = none()
		}

		if (
			previous &&
			point.type === 'low' &&
			point.label === 'LL' &&
			previous.type === 'high'
		) {
			this.state.protectedHigh = previous
			this.pendingHigh = none()
		}

		this.state.lastPoint = point
		this.lastIndex = point.index
	}

	private processCandles(pointIndex: number, candles: Candle[]): void {
		const start = this.lastIndex + 1
		for (let i = start; i <= pointIndex; i++) {
			const candle = candles[i]
			if (candle === undefined) continue
			this.processLow(candle, i)
			this.processHigh(candle, i)
		}
	}

	/**
	 * Автомат protectedLow: свеча закрывается ВНИЗ за уровнем.
	 *  none    + close < price  → pending (свеча пробоя)
	 *  pending + close < price  → подтверждённый слом
	 *  pending + close >= price → защита уровня, сброс pending
	 *  none    + close >= price → ничего
	 */
	private processLow(candle: Candle, index: number): void {
		const level = this.state.protectedLow
		if (level === undefined) return

		if (candle.close < level.price) {
			if (this.pendingLow.phase === 'none') {
				this.pendingLow = {
					phase: 'pending',
					breachIndex: index,
					breachTimestamp: candle.timestamp,
				}
			} else {
				this.commitBreach(level, this.pendingLow, index, candle.timestamp)
				delete this.state.protectedLow
				this.pendingLow = none()
			}
		} else {
			// Закрытие не ниже уровня → если был кандидат, это «защита уровня».
			this.pendingLow = none()
		}
	}

	/**
	 * Автомат protectedHigh: свеча закрывается ВВЕРХ за уровнем.
	 *  none    + close > price  → pending (свеча пробоя)
	 *  pending + close > price  → подтверждённый слом
	 *  pending + close <= price → защита уровня, сброс pending
	 *  none    + close <= price → ничего
	 */
	private processHigh(candle: Candle, index: number): void {
		const level = this.state.protectedHigh
		if (level === undefined) return

		if (candle.close > level.price) {
			if (this.pendingHigh.phase === 'none') {
				this.pendingHigh = {
					phase: 'pending',
					breachIndex: index,
					breachTimestamp: candle.timestamp,
				}
			} else {
				this.commitBreach(level, this.pendingHigh, index, candle.timestamp)
				delete this.state.protectedHigh
				this.pendingHigh = none()
			}
		} else {
			this.pendingHigh = none()
		}
	}

	private commitBreach(
		level: StructurePoint,
		pending: PendingBreach,
		confirmIndex: number,
		confirmTimestamp: number,
	): void {
		const entry: BreachedLevel = {
			level,
			breachIndex: pending.breachIndex,
			breachTimestamp: pending.breachTimestamp,
			confirmIndex,
			confirmTimestamp,
		}
		this.state.breached.push(entry)
	}

	public getState(): Readonly<MarketStructure> {
		return {
			...this.state,
			breached: [...this.state.breached],
		}
	}
}
