// MultiTfEntryEngine.ts
//
// Мульти-ТФ вход (SPEC 7.14): по сетапу старшего ТФ ищет подтверждение на
// младшем и симулирует сделку с LTF-стопом и HTF-целями.
//
// Механика (утверждена с пользователем):
//   1. Активация: первая LTF-свеча с timestamp >= activationTimestamp,
//      коснувшаяся entryLevel старшей сетки. LTF-свечи ДО активации в
//      симуляции не участвуют (look-ahead-граница).
//   2. Триггер — сменная функция-стратегия (default: CHoCH младшего ТФ в
//      сторону сделки через события BosChochEngine). Триггер легко заменить
//      (FVG, свечное подтверждение, ...) без переписывания движка.
//   3. Вход по close свечи подтверждения. Стоп — за LTF-экстремум окна
//      [активация(или предыдущий стоп)..подтверждение]: «низ последней ноги».
//   4. Цели — уровни старшей сетки (tp1/tp2), менеджмент идентичен плейбуку
//      (BE-трекинг, конфликт в баре — консервативно стоп первым).
//   5. Отмена ожидания: пересечение 0% старшей сетки (cancelLevel) либо
//      дедлайн (confirmTimestamp противоположного HTF-события). Конфликт
//      «касание зоны + пересечение 0» в одном баре — консервативно отмена.
//   6. Перезаходы: после выбитого LTF-стопа — следующий триггер, максимум
//      maxAttempts попыток (default 2), пока сетап жив.
//
// Look-ahead исключён: триггер-события BosChochEngine датированы confirmIndex
// (движок каузален по построению), стоп считается только по уже закрытым
// LTF-свечам, вход — по close свечи подтверждения, симуляция позиции — со
// СЛЕДУЮЩЕЙ свечи (экстремумы свечи входа уже в прошлом относительно close).

import type { Candle } from '@/models/price/Candle.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { FibDirection } from '@/models/fib/FibGrid.js'
import type { MultiTfOutcome, MultiTfSetupSpec } from '@/models/fib/MultiTf.js'
import { PivotDetector } from '@/core/builders/PivotDetector.js'
import { SwingEngine } from '@/core/builders/SwingEngine.js'
import { StructureEngine } from '@/core/builders/StructureEngine.js'
import { BosChochEngine } from '@/core/events/BosChochEngine.js'

/** Контекст, доступный триггеру: только прошлое относительно fromIndex. */
export interface MultiTfTriggerContext {
	candles: Candle[]
	events: StructureEvent[]
	/** Первый LTF-индекс, с которого сигнал допустим. */
	fromIndex: number
	direction: FibDirection
}

export interface MultiTfTriggerSignal {
	/** LTF-индекс свечи, на которой сигнал подтверждён (вход по её close). */
	confirmIndex: number
}

/** Сменная стратегия триггера входа на младшем ТФ. */
export type MultiTfTrigger = (ctx: MultiTfTriggerContext) => MultiTfTriggerSignal | null

/**
 * Default-триггер: первый CHoCH младшего ТФ в сторону сделки с
 * confirmIndex >= fromIndex. События должны быть построены BosChochEngine
 * по LTF-свечам (см. computeLtfEvents).
 */
export const chochTrigger: MultiTfTrigger = ({ events, fromIndex, direction }) => {
	const want = direction === 'long' ? 'up' : 'down'
	for (const event of events) {
		if (event.type !== 'choch') continue
		if (event.direction !== want) continue
		if (event.confirmIndex < fromIndex) continue
		return { confirmIndex: event.confirmIndex }
	}
	return null
}

/**
 * Мини-пайплайн младшего ТФ: pivots → swings → structure → BosChochEngine.
 * Тот же путь, что в runAnalysis, без Fib-части — мульти-ТФ нужны только
 * события структуры. pivotWindow согласован с детектором пивотов (иначе
 * датировка confirmIndex разойдётся с фактическим окном — look-ahead).
 */
export function computeLtfEvents(candles: Candle[], pivotWindow = 2): StructureEvent[] {
	const pivots = new PivotDetector(pivotWindow).detect(candles)
	const swings = new SwingEngine().build(pivots)
	const structure = new StructureEngine().build(swings)
	return new BosChochEngine({ pivotWindow }).build(structure, candles)
}

export interface MultiTfEngineInput {
	ltfCandles: Candle[]
	ltfEvents: StructureEvent[]
}

export interface MultiTfEngineConfig {
	/** Максимум попыток входа на один сетап (default 2). */
	maxAttempts?: number
	/** Стратегия триггера (default chochTrigger). */
	trigger?: MultiTfTrigger
}

export class MultiTfEntryEngine {
	private readonly maxAttempts: number
	private readonly trigger: MultiTfTrigger

	constructor(config: MultiTfEngineConfig = {}) {
		this.maxAttempts = config.maxAttempts ?? 2
		this.trigger = config.trigger ?? chochTrigger
	}

	/**
	 * Симулирует все попытки мульти-ТФ входа по одному HTF-сетапу.
	 * Возвращает минимум одну запись (включая no-touch/no-trigger/cancelled) —
	 * пропуски нужны статистике не меньше, чем входы (метрика miss_pct).
	 */
	simulateSetup(spec: MultiTfSetupSpec, input: MultiTfEngineInput): MultiTfOutcome[] {
		const { ltfCandles: candles } = input
		const long = spec.direction === 'long'

		// ---- Активация: касание зоны первой допустимой LTF-свечой ----
		const touchIndex = this.findTouch(spec, candles, long)
		if (touchIndex == null) {
			return [this.emptyOutcome(spec, 1, 'no-touch')]
		}
		if (touchIndex === -1) {
			// Пересечение 0% старшей сетки раньше (или в баре) касания зоны.
			return [this.emptyOutcome(spec, 1, 'cancelled')]
		}

		const outcomes: MultiTfOutcome[] = []
		let searchFrom = touchIndex
		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			const result = this.attemptEntry(spec, input, searchFrom, touchIndex, attempt, long)
			outcomes.push(result.outcome)
			if (result.outcome.state !== 'stopped' || result.nextSearchFrom == null) break
			searchFrom = result.nextSearchFrom
		}
		return outcomes
	}

	/**
	 * Ищет касание entryLevel начиная с первой свечи после activationTimestamp.
	 * Возвращает индекс касания, null — касания нет (или дедлайн раньше),
	 * −1 — цена пересекла cancelLevel до/в момент касания (отмена).
	 */
	private findTouch(spec: MultiTfSetupSpec, candles: Candle[], long: boolean): number | null | -1 {
		for (let i = 0; i < candles.length; i++) {
			const candle = candles[i]
			if (!candle) continue
			if (candle.timestamp < spec.activationTimestamp) continue
			if (spec.deadlineTimestamp != null && candle.timestamp >= spec.deadlineTimestamp) return null
			const crossedCancel = long ? candle.low <= spec.cancelLevel : candle.high >= spec.cancelLevel
			if (crossedCancel) return -1
			const touched = long ? candle.low <= spec.entryLevel : candle.high >= spec.entryLevel
			if (touched) return i
		}
		return null
	}

	/** Одна попытка: ожидание триггера → вход → симуляция позиции. */
	private attemptEntry(
		spec: MultiTfSetupSpec,
		input: MultiTfEngineInput,
		searchFrom: number,
		touchIndex: number,
		attempt: number,
		long: boolean,
	): { outcome: MultiTfOutcome; nextSearchFrom: number | null } {
		const { ltfCandles: candles, ltfEvents: events } = input

		// ---- Фаза 1: ждём триггер, следя за отменой и дедлайном ----
		// Граница ожидания: первое пересечение cancelLevel либо дедлайн.
		// Триггер с confirmIndex за границей недействителен.
		let cancelBound = candles.length
		let cancelledByLevel = false
		for (let i = searchFrom; i < candles.length; i++) {
			const candle = candles[i]
			if (!candle) continue
			if (spec.deadlineTimestamp != null && candle.timestamp >= spec.deadlineTimestamp) {
				cancelBound = i
				break
			}
			const crossedCancel = long ? candle.low <= spec.cancelLevel : candle.high >= spec.cancelLevel
			if (crossedCancel) {
				cancelBound = i
				cancelledByLevel = true
				break
			}
		}

		// Триггер может дать сигнал с риском 0 (close на экстремуме окна) —
		// такой вход пропускается, поиск продолжается со следующей свечи.
		let from = searchFrom
		while (true) {
			const signal = this.trigger({ candles, events, fromIndex: from, direction: spec.direction })
			// Конфликт «триггер и отмена в одном баре» — консервативно отмена.
			if (!signal || signal.confirmIndex >= cancelBound) {
				const state = cancelledByLevel ? 'cancelled' : 'no-trigger'
				return { outcome: this.emptyOutcome(spec, attempt, state), nextSearchFrom: null }
			}
			const entryIndex = signal.confirmIndex
			const entryCandle = candles[entryIndex]
			if (!entryCandle) {
				from = entryIndex + 1
				continue
			}
			const entryPrice = entryCandle.close

			// Стоп: за LTF-экстремум окна [searchFrom..entryIndex] — «низ
			// последней ноги», которую цена поставила до слома. Все свечи окна
			// уже закрыты на момент входа — look-ahead нет.
			let extremum = long ? Infinity : -Infinity
			for (let i = searchFrom; i <= entryIndex; i++) {
				const candle = candles[i]
				if (!candle) continue
				extremum = long ? Math.min(extremum, candle.low) : Math.max(extremum, candle.high)
			}
			const stopPrice = extremum
			const riskSize = Math.abs(entryPrice - stopPrice)
			if (!Number.isFinite(stopPrice) || riskSize <= 0) {
				from = entryIndex + 1
				continue
			}
			// LTF-стоп глубже 0% старшей сетки — сетап структурно мёртв раньше,
			// чем сработает наш стоп: попытка не имеет смысла, ждём следующий триггер.
			const stopBeyondCancel = long ? stopPrice <= spec.cancelLevel : stopPrice >= spec.cancelLevel
			if (stopBeyondCancel) {
				from = entryIndex + 1
				continue
			}

			const outcome = this.simulatePosition(spec, candles, {
				attempt,
				entryIndex,
				entryPrice,
				stopPrice,
				riskSize,
				barsToTrigger: entryIndex - touchIndex,
				long,
			})
			return {
				outcome,
				nextSearchFrom: outcome.state === 'stopped' && outcome.stopIndex != null ? outcome.stopIndex + 1 : null,
			}
		}
	}

	/**
	 * Фаза 2: позиция открыта, менеджмент идентичен плейбуку.
	 * Вход по close свечи подтверждения → симуляция со СЛЕДУЮЩЕЙ свечи.
	 * Конфликт в баре: стоп имеет приоритет (консервативно лосс).
	 */
	private simulatePosition(
		spec: MultiTfSetupSpec,
		candles: Candle[],
		params: {
			attempt: number
			entryIndex: number
			entryPrice: number
			stopPrice: number
			riskSize: number
			barsToTrigger: number
			long: boolean
		},
	): MultiTfOutcome {
		const { entryIndex, entryPrice, stopPrice, riskSize, long } = params

		let tp1Hit = false
		let tp1Index: number | null = null
		let tp2Index: number | null = null
		let stopIndex: number | null = null
		let beAfterTp1: boolean | null = null
		let state: MultiTfOutcome['state'] = 'open'

		for (let i = entryIndex + 1; i < candles.length; i++) {
			const candle = candles[i]
			if (!candle) continue

			const hitStop = long ? candle.low <= stopPrice : candle.high >= stopPrice
			const hitTp1 = long ? candle.high >= spec.tp1 : candle.low <= spec.tp1
			const hitTp2 = long ? candle.high >= spec.tp2 : candle.low <= spec.tp2
			const touchedEntryBack = long ? candle.low <= entryPrice : candle.high >= entryPrice

			// Возврат к входу после TP1 (до TP2) — раннер при безубытке закрыт в 0.
			if (tp1Hit && beAfterTp1 == null && !hitTp2 && touchedEntryBack) {
				beAfterTp1 = true
			}
			if (hitStop) {
				stopIndex = i
				state = 'stopped'
				if (tp1Hit && beAfterTp1 == null) beAfterTp1 = true
				break
			}
			if (hitTp1 && !tp1Hit) {
				tp1Hit = true
				tp1Index = i
				// Консервативно: тень бара касания TP1 задела вход — считаем возврат.
				if (!hitTp2 && touchedEntryBack) beAfterTp1 = true
			}
			if (hitTp2) {
				tp2Index = i
				state = 'tp2'
				if (beAfterTp1 == null) beAfterTp1 = false
				break
			}
		}

		return {
			setupId: spec.id,
			scenario: spec.scenario,
			attempt: params.attempt,
			direction: spec.direction,
			state,
			entered: true,
			entryIndex,
			entryPrice,
			stopPrice,
			riskSize,
			riskRatio: spec.htfRiskSize > 0 ? riskSize / spec.htfRiskSize : null,
			tp1Hit,
			tp1Index,
			tp2Index,
			stopIndex,
			rTp1: Math.abs(spec.tp1 - entryPrice) / riskSize,
			rTp2: Math.abs(spec.tp2 - entryPrice) / riskSize,
			rStop: state === 'stopped' ? -1 : null,
			exposure: 1,
			beAfterTp1,
			barsToTrigger: params.barsToTrigger,
		}
	}

	private emptyOutcome(spec: MultiTfSetupSpec, attempt: number, state: MultiTfOutcome['state']): MultiTfOutcome {
		return {
			setupId: spec.id,
			scenario: spec.scenario,
			attempt,
			direction: spec.direction,
			state,
			entered: false,
			entryIndex: null,
			entryPrice: null,
			stopPrice: null,
			riskSize: null,
			riskRatio: null,
			tp1Hit: false,
			tp1Index: null,
			tp2Index: null,
			stopIndex: null,
			rTp1: null,
			rTp2: null,
			rStop: null,
			exposure: null,
			beAfterTp1: null,
			barsToTrigger: null,
		}
	}
}
