// MultiTf.ts
//
// Модели мульти-ТФ входа (SPEC 7.14): сетка и сценарий — со старшего ТФ,
// вход и стоп — со структуры младшего. Спецификация сетапа (MultiTfSetupSpec)
// готовится batch-раннером из FibGridCandidate + исхода бенчмарка; исходы
// попыток (MultiTfOutcome) сравниваются попарно с обычным входом плейбука.
//
// Соглашение по R: riskSize — LTF-риск (|вход − LTF-стоп| в цене), все
// R-мультипликаторы (rTp1/rTp2/rStop) — в единицах LTF-риска. Приведение к
// риску старшей сделки — через riskRatio = LTF-риск / HTF-риск.

import type { FibDirection } from './FibGrid.js'

/** Сетап старшего ТФ, для которого ищется мульти-ТФ вход на младшем. */
export interface MultiTfSetupSpec {
	/** Уникальный id: candidateId|anchorMode|scenario. */
	id: string
	/** Сценарий плейбука (ote | deep | breaker | breaker161). */
	scenario: string
	direction: FibDirection
	/** Уровень зоны интереса старшей сетки (78.6 / 38.2 / 100). */
	entryLevel: number
	/** 0% старшей сетки: пересечение = сетап мёртв, ожидание отменено. */
	cancelLevel: number
	/** Цели — уровни старшей сетки (141 / 241). */
	tp1: number
	tp2: number
	/** Риск эквивалентной старшей сделки: |entryLevel − cancelLevel|. */
	htfRiskSize: number
	/**
	 * Open-timestamp HTF-бара, в котором бенчмарк коснулся зоны. Сканирование
	 * LTF начинается с первой LTF-свечи с timestamp >= этого значения —
	 * LTF-свечи до активации в симуляции не участвуют (look-ahead-граница).
	 */
	activationTimestamp: number
	/**
	 * Дедлайн ожидания: confirmTimestamp первого противоположного HTF-события
	 * после создания сетапа (экспирация, как в FibLifecycleEngine). null —
	 * противоположного события в данных нет.
	 */
	deadlineTimestamp: number | null
}

/**
 * Статус попытки:
 * - 'no-touch'   — LTF-свечи не нашли касания зоны (разрыв данных);
 * - 'no-trigger' — зона активна, но триггер не случился до дедлайна/конца;
 * - 'cancelled'  — цена пересекла 0% старшей сетки до триггера;
 * - 'stopped' | 'tp2' | 'open' — как в плейбуке.
 */
export type MultiTfState = 'no-touch' | 'no-trigger' | 'cancelled' | 'stopped' | 'tp2' | 'open'

export interface MultiTfOutcome {
	setupId: string
	scenario: string
	/** Номер попытки (1..maxAttempts): перезаход после выбитого LTF-стопа. */
	attempt: number
	direction: FibDirection
	state: MultiTfState
	entered: boolean
	/** Индексы — по массиву LTF-свечей. */
	entryIndex: number | null
	entryPrice: number | null
	stopPrice: number | null
	/** LTF-риск в цене; 1R попытки. */
	riskSize: number | null
	/** LTF-риск / HTF-риск — коэффициент приведения к R старшей сделки. */
	riskRatio: number | null
	tp1Hit: boolean
	tp1Index: number | null
	tp2Index: number | null
	stopIndex: number | null
	/** R-мультипликаторы целей в LTF-R. */
	rTp1: number | null
	rTp2: number | null
	/** −1 при стопе (полная позиция, добора нет), null — стопа не было. */
	rStop: number | null
	/** Всегда 1 (мульти-ТФ входит одним объёмом); для совместимости с fibCosts. */
	exposure: number | null
	beAfterTp1: boolean | null
	/** LTF-баров от активации зоны (или предыдущего стопа) до триггера. */
	barsToTrigger: number | null
}
