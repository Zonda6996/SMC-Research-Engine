import type { Candle } from '@/models/price/Candle.js'
import type { BreachedLevel } from '@/models/structure/BreachedLevel.js'
import type { MarketStructure, Trend } from '@/models/structure/MarketStructure.js'
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
 * Инкрементально, по одной structure-точке, поддерживает:
 *  - protected-уровни (protectedLow/protectedHigh) и накопительный список
 *    подтверждённых сломов (`breached`) — баг №3 v2;
 *  - тренд (`trend`) с эволюцией по точкам (`trendHistory`) — баг №4.
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
 *
 * Правило тренда (баг №4): первичный источник — sequence structure-меток
 * (HH/HL/LH/LL). Гистерезис: вход в новый тренд требует ОБА подтверждения
 * (bullish = HH+HL, bearish = LH+LL), выход — по первому противоречию (LL в
 * bullish → range). Реализовано через скользящие `lastHighLabel`/`lastLowLabel`.
 * Эволюция по точкам сохраняется в `trendHistory` — фундамент для будущего
 * look-ahead-free BOS/CHoCH (баг №5): каждый момент имеет свой trend.
 */
export class MarketStructureEngine {
	private readonly window: number
	private readonly state: MarketStructure = {
		breached: [],
		trend: 'range',
		trendHistory: [],
	}
	private lastIndex = -1
	private pendingLow: PendingBreach = none()
	private pendingHigh: PendingBreach = none()
	private lastHighLabel: StructurePoint['label'] | null = null
	private lastLowLabel: StructurePoint['label'] | null = null

	/**
	 * @param window PivotDetector window (default 2). Используется только для
	 *               датировки confirmedAtIndex в trendHistory — логика тренда и
	 *               пробоев от него не зависит. Передаётся из runAnalysis.
	 */
	constructor(window: number = 2) {
		this.window = window
	}

	public update(point: StructurePoint, candles: Candle[]): void {
		// 1. Гоняем автоматы подтверждения по свечам окна (lastIndex, point.index].
		this.processCandles(point.index, candles)

		// 2. Эволюция тренда (баг №4) — после пробоев, до выставления protected.
		this.processTrend(point)

		// 3. Логика выставления новых protected (без изменений по смыслу):
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

	/**
	 * Эволюция тренда по structure-меткам с гистерезисом (баг №4).
	 *
	 * Скользящие `lastHighLabel`/`lastLowLabel` хранят последние seen метки
	 * каждого типа. На каждой точке обновляем соответствующую и вычисляем trend:
	 *  - (HH, HL) → bullish
	 *  - (LH, LL) → bearish
	 *  - иначе    → range
	 *
	 * Гистерезис: вход в новый тренд требует ОБА подтверждения (одна HH в range
	 * → остаёмся range, ждём HL); выход — по первому противоречию (LL в bullish
	 * → (HH, LL) → range). UNKNOWN-метки (первая точка типа) не сбрасывают
	 * накопленные подтверждения, но и не дают тренда, пока не появится пара.
	 */
	private processTrend(point: StructurePoint): void {
		if (point.type === 'high') {
			this.lastHighLabel = point.label
		} else {
			this.lastLowLabel = point.label
		}

		const trend = this.computeTrend()
		this.state.trend = trend
		this.state.trendHistory.push({
			index: point.index,
			label: point.label,
			trend,
			confirmedAtIndex: point.index + this.window,
		})
	}

	private computeTrend(): Trend {
		if (
			this.lastHighLabel === 'HH' &&
			this.lastLowLabel === 'HL'
		) {
			return 'bullish'
		}
		if (
			this.lastHighLabel === 'LH' &&
			this.lastLowLabel === 'LL'
		) {
			return 'bearish'
		}
		return 'range'
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
			trendHistory: [...this.state.trendHistory],
		}
	}
}
