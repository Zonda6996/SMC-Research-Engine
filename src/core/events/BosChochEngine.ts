// BosChochEngine.ts
//
// Детектор BOS/CHoCH: пул активных уровней + утверждённые фильтры значимости.
// Правило выбрано и принято по протоколу приёмки (SPEC 7.6): слой C победил
// слои A/B на 10 эталонных кусках (~9/10 совпадение с ручной разметкой).
//
// Контракт движка — ПОРЯДОК применения фильтров (не крутится конфигом):
//   1. пул: пробой каждого активного уровня независимо (two-candle по умолчанию)
//   2. skip swept   — уровень с глубоким снятием ликвидности «отработан»
//   3. HH/LL only   — только структурно значимые экстремумы тренда
//   4. min age      — уровень должен продержаться N свечей
//   5. cascades     — одна свеча сносит несколько уровней = одно событие
//   6. dedup        — соседние уровни на одной цене = одно событие
//   7. классификация — sequential: слом против направления = CHoCH, по = BOS
//
// Все ценовые пороги нормируются на ATR(period) на момент свечи подтверждения —
// инвариантность к активу, таймфрейму и режиму волатильности.
//
// Look-ahead-free по построению: уровень проверяется на пробой только с
// confirmedAt = point.index + pivotWindow; классификация использует только
// прошедшие события.

import type { Candle } from '@/models/price/Candle.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import { ATREngine } from '@/core/analysis/ATREngine.js'

export type BreachMode = 'single' | 'two'

export interface BosChochConfig {
	/** Окно PivotDetector — датировка подтверждения уровня (confirmedAt = index + window). */
	pivotWindow: number
	/** 'two' = two-candle confirmation (закрытие за уровнем + подтверждающая свеча). */
	breachMode: BreachMode
	/** Одна свеча сносит несколько уровней одного направления → одно событие (самый дальний уровень). */
	collapseCascades: boolean
	/** События только от HH/LL — структурно значимых экстремумов тренда. */
	hhllOnly: boolean
	/** Уровень моложе N свечей не даёт события. 0 = выкл. */
	minLevelAge: number
	/** Dedup: события одного направления с уровнями ближе K×ATR → остаётся первое. null = выкл. */
	dedupAtrMultiple: number | null
	/** Skip swept: снятие ликвидности глубже K×ATR без слома «отрабатывает» уровень. null = выкл. */
	skipSweptAtrMultiple: number | null
	/** Период ATR для нормировки порогов. */
	atrPeriod: number
	/**
	 * Окно (в свечах) для аннотации oppositeSweptBefore: свип противоположного
	 * экстремума не старше N свечей до breachIndex. Только аннотация —
	 * на отбор событий не влияет, принятый конфиг не нарушает.
	 */
	oppositeSweepLookback: number
}

/** Принятый протоколом приёмки набор (SPEC 7.6). */
export const DEFAULT_BOS_CHOCH_CONFIG: BosChochConfig = {
	pivotWindow: 2,
	breachMode: 'two',
	collapseCascades: true,
	hhllOnly: true,
	minLevelAge: 20,
	dedupAtrMultiple: 1.2,
	skipSweptAtrMultiple: 0.6,
	atrPeriod: 14,
	oppositeSweepLookback: 25,
}

/** Внутреннее состояние уровня в пуле. */
interface PoolLevel {
	point: StructurePoint
	confirmedAt: number
	pending: { breachIndex: number; breachTimestamp: number } | null
	sweptAt: number | null
	sweptDepth: number
}

/** Сырой пробой до фильтров и классификации. */
interface RawBreach {
	level: StructurePoint
	breachIndex: number
	breachTimestamp: number
	confirmIndex: number
	confirmTimestamp: number
	sweptBefore: boolean
	sweptDepth: number
}

/** Факт снятия ликвидности: фитиль проколол уровень без слома. */
interface SweepRecord {
	/** Свеча, на которой случился прокол. */
	index: number
	/** Тип проколотого экстремума. */
	levelType: 'high' | 'low'
}

export class BosChochEngine {
	private readonly config: BosChochConfig

	constructor(config: Partial<BosChochConfig> = {}) {
		this.config = { ...DEFAULT_BOS_CHOCH_CONFIG, ...config }
	}

	/**
	 * Полный проход: пул → фильтры (фиксированный порядок) → классификация.
	 */
	build(structure: StructurePoint[], candles: Candle[]): StructureEvent[] {
		const { breaches, sweeps } = this.detectPool(structure, candles)
		const atr = this.buildAtrByIndex(candles)
		const filtered = this.applyFilters(breaches, atr)
		return this.classify(filtered, sweeps)
	}

	/**
	 * Сырые пробои пула без фильтров — для отладки и сравнения в визуализаторе.
	 */
	buildRaw(structure: StructurePoint[], candles: Candle[]): StructureEvent[] {
		const { breaches, sweeps } = this.detectPool(structure, candles)
		return this.classify(breaches, sweeps)
	}

	// ── Шаг 1. Пул активных уровней ─────────────────────────────

	private detectPool(
		structure: StructurePoint[],
		candles: Candle[],
	): { breaches: RawBreach[]; sweeps: SweepRecord[] } {
		const { pivotWindow, breachMode } = this.config
		const breaches: RawBreach[] = []
		const sweeps: SweepRecord[] = []
		const pool: PoolLevel[] = []
		let structIdx = 0

		for (let i = 0; i < candles.length; i++) {
			const candle = candles[i]!
			const ts = candle.timestamp

			// Поглощаем structure-точки, возникшие к этой свече.
			while (structIdx < structure.length && structure[structIdx]!.index <= i) {
				const pt = structure[structIdx]!
				pool.push({ point: pt, confirmedAt: pt.index + pivotWindow, pending: null, sweptAt: null, sweptDepth: 0 })
				structIdx++
			}

			// Проверяем пробой каждого активного уровня независимо.
			for (let p = pool.length - 1; p >= 0; p--) {
				const lvl = pool[p]!
				if (i < lvl.confirmedAt) continue

				const isBreach =
					lvl.point.type === 'high'
						? candle.close > lvl.point.price
						: candle.close < lvl.point.price

				if (!isBreach) {
					// Снятие ликвидности: фитиль проколол уровень без подтверждения
					// слома, либо pending-кандидат защитился. Копим max глубину.
					const pierceDepth =
						lvl.point.type === 'high'
							? candle.high - lvl.point.price
							: lvl.point.price - candle.low
					if (pierceDepth > 0 || lvl.pending !== null) {
						if (lvl.sweptAt === null) lvl.sweptAt = i
						lvl.sweptDepth = Math.max(lvl.sweptDepth, pierceDepth)
						// Каждый прокол — отдельная запись: для oppositeSweptBefore
						// важна свежесть последнего свипа, не первого.
						if (pierceDepth > 0) sweeps.push({ index: i, levelType: lvl.point.type })
					}
					lvl.pending = null
					continue
				}

				if (breachMode === 'single') {
					breaches.push({
						level: lvl.point,
						breachIndex: i, breachTimestamp: ts,
						confirmIndex: i, confirmTimestamp: ts,
						sweptBefore: lvl.sweptAt !== null,
						sweptDepth: lvl.sweptDepth,
					})
					pool.splice(p, 1)
					continue
				}

				// two-candle confirmation
				if (lvl.pending === null) {
					lvl.pending = { breachIndex: i, breachTimestamp: ts }
				} else {
					breaches.push({
						level: lvl.point,
						breachIndex: lvl.pending.breachIndex,
						breachTimestamp: lvl.pending.breachTimestamp,
						confirmIndex: i, confirmTimestamp: ts,
						sweptBefore: lvl.sweptAt !== null,
						sweptDepth: lvl.sweptDepth,
					})
					pool.splice(p, 1)
				}
			}
		}

		// Детерминированный порядок: по свече подтверждения, затем по возрасту уровня.
		breaches.sort((a, b) => a.confirmIndex - b.confirmIndex || a.level.index - b.level.index)
		return { breaches, sweeps }
	}

	// ── ATR по индексу свечи ─────────────────────────────────────

	/**
	 * ATR(period) как массив по индексам свечей (Wilder, через ATREngine).
	 * Индексы до первого значения заполняются первым доступным — пороги
	 * ранних событий не должны быть нулевыми.
	 */
	private buildAtrByIndex(candles: Candle[]): number[] {
		const points = new ATREngine(this.config.atrPeriod).build(candles)
		const atr = new Array<number>(candles.length).fill(0)
		for (const p of points) atr[p.index] = p.value
		const first = points[0]
		if (first) {
			for (let i = 0; i < first.index; i++) atr[i] = first.value
		}
		// Форвард-филл на случай дыр (ATREngine дыр не даёт, но контракт дешёвый).
		for (let i = 1; i < atr.length; i++) {
			if (atr[i] === 0) atr[i] = atr[i - 1]!
		}
		return atr
	}

	// ── Шаги 2–6. Фильтры в фиксированном порядке ────────────────

	private applyFilters(breaches: RawBreach[], atr: number[]): RawBreach[] {
		const { skipSweptAtrMultiple, hhllOnly, minLevelAge, collapseCascades, dedupAtrMultiple } = this.config
		let result = breaches

		// 2. Skip swept: глубокое снятие ликвидности «отрабатывает» уровень.
		if (skipSweptAtrMultiple !== null) {
			result = result.filter((b) => {
				if (!b.sweptBefore) return true
				const threshold = skipSweptAtrMultiple * (atr[b.confirmIndex] ?? 0)
				return b.sweptDepth <= threshold
			})
		}

		// 3. HH/LL only.
		if (hhllOnly) {
			result = result.filter((b) => b.level.label === 'HH' || b.level.label === 'LL')
		}

		// 4. Min level age.
		if (minLevelAge > 0) {
			result = result.filter((b) => b.confirmIndex - b.level.index >= minLevelAge)
		}

		// 5. Collapse cascades: на одной свече — одно событие на направление,
		//    выживает самый дальний (старый) уровень.
		if (collapseCascades) {
			const byKey = new Map<string, RawBreach>()
			for (const b of result) {
				const key = `${b.confirmIndex}:${b.level.type}`
				const prev = byKey.get(key)
				if (!prev || b.level.index < prev.level.index) byKey.set(key, b)
			}
			result = [...byKey.values()].sort(
				(a, b) => a.confirmIndex - b.confirmIndex || a.level.index - b.level.index,
			)
		}

		// 6. Dedup: последовательные события одного направления с уровнями
		//    ближе K×ATR — дубликаты, остаётся первое. Смена направления
		//    сбрасывает цепочку.
		if (dedupAtrMultiple !== null) {
			let lastKept: RawBreach | null = null
			result = result.filter((b) => {
				if (lastKept && lastKept.level.type === b.level.type) {
					const tolerance = dedupAtrMultiple * (atr[b.confirmIndex] ?? 0)
					if (Math.abs(b.level.price - lastKept.level.price) < tolerance) return false
				}
				lastKept = b
				return true
			})
		}

		return result
	}

	// ── Шаг 7. Последовательная классификация ────────────────────

	/**
	 * Метки выводятся из самих событий (как размечает человек): слом против
	 * текущего направления = CHoCH (направление переворачивается), слом по
	 * направлению = BOS. Первому событию не с чем сравниваться → unlabeled.
	 */
	private classify(breaches: RawBreach[], sweeps: SweepRecord[]): StructureEvent[] {
		const { oppositeSweepLookback } = this.config
		let dir: 'up' | 'down' | null = null
		return breaches.map((b) => {
			const eventDir: 'up' | 'down' = b.level.type === 'high' ? 'up' : 'down'
			let type: StructureEvent['type']
			if (dir === null) type = 'unlabeled'
			else if (eventDir === dir) type = 'bos'
			else type = 'choch'
			dir = eventDir

			// Свип противоположного экстремума в окне до первого закрытия за
			// уровнем. Только прошлое (index <= breachIndex) — look-ahead-free.
			const oppositeType = b.level.type === 'high' ? 'low' : 'high'
			const oppositeSweptBefore = sweeps.some(
				(s) =>
					s.levelType === oppositeType &&
					s.index <= b.breachIndex &&
					b.breachIndex - s.index <= oppositeSweepLookback,
			)

			return {
				type,
				direction: eventDir,
				levelPrice: b.level.price,
				levelType: b.level.type,
				levelIndex: b.level.index,
				levelLabel: b.level.label,
				breachIndex: b.breachIndex,
				breachTimestamp: b.breachTimestamp,
				confirmIndex: b.confirmIndex,
				confirmTimestamp: b.confirmTimestamp,
				sweptBefore: b.sweptBefore,
				sweptDepth: b.sweptDepth,
				oppositeSweptBefore,
			}
		})
	}
}
