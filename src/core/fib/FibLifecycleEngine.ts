// FibLifecycleEngine.ts
//
// Симулирует плейбук по каждой Fib-сетке бар за баром и записывает исходы.
// Правила зафиксированы с пользователем (см. SPEC 7.8):
//   - OTE:     ретрейс в 61.8–78.6 → вход по 78.6;
//   - Deep:    откат в 23.6–38.2  → вход по 38.2;
//   - Breaker: цена дошла до 141 до касания OTE → вход на ретесте 100%;
//   - стоп за 0%, TP1 = 141, TP2 = 241;
//   - wide-стопы (исследовательские): за 0% с буфером 0.5/1.0 × ATR14,
//     где ATR восстанавливается как legSize / legAtrRatio;
//   - Fade (исследовательский, ПРОТИВ сетки): вход по касанию 141 (fade141)
//     или 241 (fade241), стоп за 161/261 ('zone') либо + 0.5 ATR ('zoneAtr'),
//     цели TP1 = 100%, TP2 = 78.6;
//   - Fade волна 1: fade141 с широким стопом за 200 + 0.5 ATR ('far');
//     fade241n — вход 241 с ближними целями TP1 = 141, TP2 = 100;
//     fade200 — вход 200, стоп за 241 (+ 0.5 ATR), цели 100 → 78.6;
//   - 'zero200' — тренд-сценарии со стопом за 0% и TP2 = 200 вместо 241;
//   - экспирация: противоположное событие подтверждено до входа;
//   - конфликт внутри бара (вход и стоп в одной свече) — консервативно лосс.
//
// Диагностические поля (в EV не участвуют, look-ahead не добавляют —
// это post-hoc сканы строго вперёд от уже известных индексов):
//   - maxExtensionRatio: максимум цены после входа как ratio сетки, окно
//     до касания исходного стопа либо конца данных (только тренд-сценарии);
//   - tpAfterStop: после стопа цена всё же дошла до TP1 раньше события
//     против направления сделки.
//
// Look-ahead исключён: симуляция начинается с createdAtIndex + 1 и идёт
// только вперёд; экспирация проверяется по confirmIndex событий.

import type { Candle } from '@/models/price/Candle.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { FibAnchorMode, FibDirection, FibGridCandidate, FibVariant } from '@/models/fib/FibGrid.js'
import type {
	FibLifecycleResult,
	FibReachRecord,
	FibScenario,
	FibSetupOutcome,
	FibStopMode,
} from '@/models/fib/FibLifecycle.js'

export interface FibLifecycleInput {
	candidates: FibGridCandidate[]
	events: StructureEvent[]
	candles: Candle[]
}

const ANCHOR_MODES: FibAnchorMode[] = ['local', 'global']

export class FibLifecycleEngine {
	build(input: FibLifecycleInput): FibLifecycleResult {
		const outcomes: FibSetupOutcome[] = []
		const reach: FibReachRecord[] = []
		for (const candidate of input.candidates) {
			for (const mode of ANCHOR_MODES) {
				const variant = candidate.variants[mode]
				if (!variant) continue
				outcomes.push(...this.simulate(candidate, mode, variant, input))
				const record = this.measureReach(candidate, mode, variant, input)
				if (record) reach.push(record)
			}
		}
		return { outcomes, reach }
	}

	/**
	 * Гистограмма досягаемости: min/max ratio сетки от создания кандидата до
	 * подтверждения первого противоположного события либо конца данных.
	 * Независима от сценариев входа — «куда цена реально ходит после BOS/CHoCH».
	 */
	private measureReach(
		candidate: FibGridCandidate,
		mode: FibAnchorMode,
		variant: FibVariant,
		input: FibLifecycleInput,
	): FibReachRecord | null {
		if (variant.legSize <= 0) return null
		const long = candidate.direction === 'long'
		const level0 = variant.levels.find((l) => l.ratio === 0)
		if (!level0) return null
		const p0 = level0.price

		const expiryIndex = this.firstOppositeConfirm(candidate.direction, candidate.createdAtIndex, input.events)
		const from = candidate.createdAtIndex + 1
		const to = expiryIndex != null ? Math.min(expiryIndex, input.candles.length) : input.candles.length
		if (from >= to) return null

		// Ratio точки цены: (price − p0) / legSize × 100, для short зеркально.
		const ratioOf = (price: number) => ((long ? price - p0 : p0 - price) / variant.legSize) * 100

		let minRatio = Infinity
		let maxRatio = -Infinity
		// Fade-reach: min/max ratio ПОСЛЕ первого касания 141 и 241 (в том же
		// окне). Свеча касания включается: её противоположный экстремум — уже
		// потенциальный откат. touched* становится true до обновления after*.
		let touched141 = false
		let touched241 = false
		let after141Min = Infinity
		let after141Max = -Infinity
		let after241Min = Infinity
		let after241Max = -Infinity
		for (let i = from; i < to; i++) {
			const candle = input.candles[i]
			if (!candle) continue
			// Для long-сетки глубина ретрейса — low, потолок — high (short зеркально).
			const lowRatio = ratioOf(long ? candle.low : candle.high)
			const highRatio = ratioOf(long ? candle.high : candle.low)
			minRatio = Math.min(minRatio, lowRatio)
			maxRatio = Math.max(maxRatio, highRatio)

			if (!touched141 && highRatio >= 141) touched141 = true
			if (touched141) {
				after141Min = Math.min(after141Min, lowRatio)
				after141Max = Math.max(after141Max, highRatio)
			}
			if (!touched241 && highRatio >= 241) touched241 = true
			if (touched241) {
				after241Min = Math.min(after241Min, lowRatio)
				after241Max = Math.max(after241Max, highRatio)
			}
		}
		if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio)) return null

		return {
			candidateId: candidate.id,
			variantMode: mode,
			trigger: candidate.trigger,
			direction: candidate.direction,
			legAtrRatio: variant.legAtrRatio,
			oppositeSweptBefore: candidate.oppositeSweptBefore,
			minRetraceRatio: minRatio,
			maxExtensionRatio: maxRatio,
			windowBars: to - from,
			after141: touched141 && Number.isFinite(after141Min)
				? { pullbackRatio: after141Min, extensionRatio: after141Max }
				: null,
			after241: touched241 && Number.isFinite(after241Min)
				? { pullbackRatio: after241Min, extensionRatio: after241Max }
				: null,
		}
	}

	private simulate(
		candidate: FibGridCandidate,
		mode: FibAnchorMode,
		variant: FibVariant,
		input: FibLifecycleInput,
	): FibSetupOutcome[] {
		const price = (ratio: number): number => {
			const level = variant.levels.find((l) => l.ratio === ratio)
			if (!level) throw new Error(`FibLifecycle: missing level ${ratio}`)
			return level.price
		}

		const long = candidate.direction === 'long'
		const p0 = price(0)
		const p236 = price(23.6)
		const p382 = price(38.2)
		const p786 = price(78.6)
		const p100 = price(100)
		const p141 = price(141)
		const p161 = price(161)
		const p200 = price(200)
		const p241 = price(241)
		const p261 = price(261)

		// ATR14 на момент пробоя восстанавливается из уже посчитанного отношения:
		// legAtrRatio = legSize / atr. Если недоступен — ATR-зависимые режимы
		// (wide05/wide10/zoneAtr) для этого варианта не эмитятся.
		const atr =
			variant.legAtrRatio != null && variant.legAtrRatio > 0
				? variant.legSize / variant.legAtrRatio
				: null
		// Буфер откладывается «за» уровень в сторону от направления сделки:
		// для long-сетки — вниз от 0%, для short — вверх (и зеркально для fade).
		const away = long ? -1 : 1

		// Индекс подтверждения первого противоположного события после создания —
		// с этого бара невошедшие сетапы экспирируются.
		const expiryIndex = this.firstOppositeConfirm(candidate.direction, candidate.createdAtIndex, input.events)

		// Предусловие breaker: касание 141 ДО касания OTE-зоны (78.6).
		const { extFirst, extIndex } = this.breakerPrecondition(
			candidate.createdAtIndex + 1,
			input.candles,
			long,
			p786,
			p141,
			expiryIndex,
		)

		interface ScenarioSpec {
			scenario: FibScenario
			stopMode: FibStopMode
			entryLevel: number
			stopLevel: number
			fromIndex: number
			/** Направление СДЕЛКИ (для fade инвертировано относительно сетки). */
			tradeLong: boolean
			tp1: number
			tp2: number
			/** Трекинг maxExtensionRatio — только тренд-сценарии. */
			trackExtension: boolean
			/**
			 * Волна 2: вход не по касанию, а по закрытию первой свечи обратно
			 * на «нашей» стороне уровня (подтверждение отбоя). Вход по close.
			 */
			confirmClose?: boolean
			/** Волна 3 (breaker161): уровень отмены сетапа до входа. */
			cancelLevel?: number | null
			/** Волна 4 (scale-in): уровень добора второй половины позиции. */
			addLevel?: number | null
		}

		const from = candidate.createdAtIndex + 1
		const trend = (
			scenario: FibScenario,
			stopMode: FibStopMode,
			entryLevel: number,
			stopLevel: number,
			fromIndex = from,
			tp2 = p241,
		): ScenarioSpec => ({
			scenario, stopMode, entryLevel, stopLevel, fromIndex,
			tradeLong: long, tp1: p141, tp2, trackExtension: true,
		})
		// Fade: сделка ПРОТИВ сетки от зоны расширения, цели вниз по сетке.
		const fade = (
			scenario: FibScenario,
			stopMode: FibStopMode,
			entryLevel: number,
			stopLevel: number,
			tp1 = p100,
			tp2 = p786,
			confirmClose = false,
		): ScenarioSpec => ({
			scenario, stopMode, entryLevel, stopLevel, fromIndex: from,
			tradeLong: !long, tp1, tp2, trackExtension: false, confirmClose,
		})

		const scenarios: ScenarioSpec[] = [
			// OTE симулируется в двух режимах стопа: за 0% и укороченный за 23.6.
			trend('ote', 'zero', p786, p0),
			trend('ote', 'tight', p786, p236),
			trend('deep', 'zero', p382, p0),
			// Волна 1: тот же стоп за 0%, но TP2 = 200 вместо 241 — гипотеза
			// по данным расширений (до 200 доходит заметно больше сделок).
			trend('ote', 'zero200', p786, p0, from, p200),
			trend('deep', 'zero200', p382, p0, from, p200),
			// Волна 4: добор второй половины на уровне медианной просадки
			// победителей (данные MAE): ote → 50, deep → 23.6.
			{ ...trend('oteScale', 'zero', p786, p0), addLevel: price(50) },
			{ ...trend('deepScale', 'zero', p382, p0), addLevel: p236 },
		]
		// Wide-стопы: буфер в ATR за уровнем 0% (только при известном ATR).
		if (atr != null) {
			scenarios.push(
				trend('ote', 'wide05', p786, p0 + away * 0.5 * atr),
				trend('ote', 'wide10', p786, p0 + away * 1.0 * atr),
				trend('deep', 'wide05', p382, p0 + away * 0.5 * atr),
				trend('deep', 'wide10', p382, p0 + away * 1.0 * atr),
			)
		}
		// Breaker существует только при выполненном предусловии; ретест 100%
		// отслеживается после бара, где цена достигла 141.
		if (extFirst && extIndex != null) {
			scenarios.push(trend('breaker', 'zero', p100, p0, extIndex + 1))
			// Волна 4: добор второй половины на 78.6 (медиана MAE победителей
			// breaker ≈ −0.18R ≈ уровень 82).
			scenarios.push({ ...trend('breakerScale', 'zero', p100, p0, extIndex + 1), addLevel: p786 })
			// Волна 3: сокращённый стоп за 23.6 (тест по MAE победителей).
			scenarios.push(trend('breaker', 'tight', p100, p236, extIndex + 1))
			// Волна 3: вход глубже — на 78.6 вместо 100 (лучше цена, шире запас).
			scenarios.push(trend('breaker78', 'zero', p786, p0, extIndex + 1))
			// Волна 3 (breaker161): отмена, если импульс уходит за 161 до ретеста.
			// Если бар касания 141 сам прошил 161 — сетап мгновенно отменён,
			// не эмитим вовсе (эквивалент expired, в EV не участвует).
			const extBar = input.candles[extIndex]
			const insta161 = extBar != null && (long ? extBar.high >= p161 : extBar.low <= p161)
			if (!insta161) {
				const spec = trend('breaker161', 'zero', p100, p0, extIndex + 1)
				scenarios.push({ ...spec, cancelLevel: p161 })
			}
		}
		// Fade-зоны: стоп за дальней границей ('zone') и + 0.5 ATR ('zoneAtr').
		// Дальняя граница лежит В НАПРАВЛЕНИИ сетки (против сделки), поэтому
		// ATR-буфер откладывается с противоположным знаком (−away).
		scenarios.push(
			fade('fade141', 'zone', p141, p161),
			fade('fade241', 'zone', p241, p261),
			// Волна 1: fade241n — тот же вход/стоп, но ближние цели 141 → 100.
			fade('fade241n', 'zone', p241, p261, p141, p100),
			// Волна 1: fade200 — вход по касанию 200 (фильтр «прошили 141 —
			// ждём глубже»), стоп ровно за 241, цели 100 → 78.6.
			fade('fade200', 'zone', p200, p241),
		)
		if (atr != null) {
			scenarios.push(
				fade('fade141', 'zoneAtr', p141, p161 - away * 0.5 * atr),
				fade('fade241', 'zoneAtr', p241, p261 - away * 0.5 * atr),
				// Волна 1: fade141 с широким стопом за 200 + 0.5 ATR — риск в цене
				// ~3× шире зонного, издержки в R пропорционально меньше.
				fade('fade141', 'far', p141, p200 - away * 0.5 * atr),
				// Волна 1: fade200 со стопом за 241 + 0.5 ATR («небольшой запас»).
				fade('fade200', 'zoneAtr', p200, p241 - away * 0.5 * atr),
				// Волна 2: те же лучшие конструкции, но вход только после свечи,
				// закрывшейся обратно за уровнем (подтверждение отбоя).
				fade('fade141c', 'far', p141, p200 - away * 0.5 * atr, p100, p786, true),
				fade('fade241nc', 'zoneAtr', p241, p261 - away * 0.5 * atr, p141, p100, true),
			)
		}

		return scenarios.map((spec) =>
			this.simulateScenario(candidate, mode, variant, spec.scenario, spec.stopMode, {
				candles: input.candles,
				events: input.events,
				fromIndex: spec.fromIndex,
				long: spec.tradeLong,
				entryLevel: spec.entryLevel,
				stopLevel: spec.stopLevel,
				tp1: spec.tp1,
				tp2: spec.tp2,
				expiryIndex,
				extension: spec.trackExtension ? { p0, legSize: variant.legSize } : null,
				confirmClose: spec.confirmClose ?? false,
				cancelLevel: spec.cancelLevel ?? null,
				addLevel: spec.addLevel ?? null,
			}),
		)
	}

	/**
	 * Проверяет, что случилось раньше после соз����ания сетки:
	 * касание расширения 141 или касание OTE-зоны (78.6).
	 */
	private breakerPrecondition(
		fromIndex: number,
		candles: Candle[],
		long: boolean,
		p786: number,
		p141: number,
		expiryIndex: number | null,
	): { extFirst: boolean; extIndex: number | null } {
		for (let i = fromIndex; i < candles.length; i++) {
			if (expiryIndex != null && i >= expiryIndex) break
			const candle = candles[i]
			if (!candle) continue
			const touchedOte = long ? candle.low <= p786 : candle.high >= p786
			const touchedExt = long ? candle.high >= p141 : candle.low <= p141
			// Обе зоны в одном баре — считаем, что OTE была раньше (консервативно
			// для breaker: не создаём сетап при неоднозначности).
			if (touchedOte) return { extFirst: false, extIndex: null }
			if (touchedExt) return { extFirst: true, extIndex: i }
		}
		return { extFirst: false, extIndex: null }
	}

	private simulateScenario(
		candidate: FibGridCandidate,
		mode: FibAnchorMode,
		variant: FibVariant,
		scenario: FibScenario,
		stopMode: FibStopMode,
		ctx: {
			candles: Candle[]
			events: StructureEvent[]
			fromIndex: number
			/** Направление сделки (для fade инвертировано относительно сетки). */
			long: boolean
			entryLevel: number
			stopLevel: number
			tp1: number
			tp2: number
			expiryIndex: number | null
			/** Параметры трекинга maxExtensionRatio; null — не отслеживать (fade). */
			extension: { p0: number; legSize: number } | null
			/** Волна 2: вход по закрытию подтверждающей свечи вместо касания. */
			confirmClose: boolean
			/**
			 * Волна 3 (breaker161): если цена до входа уходит ЗА этот уровень в
			 * favorable-сторону — сетап отменяется (state 'expired'). Конфликт
			 * в одном баре с касанием входа — консервативно отмена.
			 */
			cancelLevel?: number | null
			/**
			 * Волна 4 (scale-in): уровень добора второй половины позиции.
			 * Позиция 50/50, 1R = плановый риск полной позиции. Добор — только
			 * до TP1. null — обычный сценарий одним объёмом.
			 */
			addLevel?: number | null
		},
	): FibSetupOutcome {
		const base: FibSetupOutcome = {
			candidateId: candidate.id,
			variantMode: mode,
			scenario,
			stopMode,
			trigger: candidate.trigger,
			// Фактическое направление сделки — для fade инвертировано, чтобы
			// L/S-разрезы в агрегации оставались честными.
			direction: ctx.long ? 'long' : 'short',
			legAtrRatio: variant.legAtrRatio,
			oppositeSweptBefore: candidate.oppositeSweptBefore,
			createdAtIndex: candidate.createdAtIndex,
			entered: false,
			entryIndex: null,
			entryPrice: null,
			stopPrice: ctx.stopLevel,
			riskSize: null,
			state: 'no-entry',
			tp1Hit: false,
			tp1Index: null,
			tp2Hit: false,
			tp2Index: null,
			stopIndex: null,
			rTp1: null,
			rTp2: null,
			rStop: null,
			exposure: null,
			beAfterTp1: null,
			mfeR: null,
			maeR: null,
			maxExtensionRatio: null,
			tpAfterStop: null,
			barsToEntry: null,
			barsToResolve: null,
		}

		const { candles, long } = ctx

		// ---- Фаза 1: ждём вход ----
		// Обычный режим: вход по касанию уровня. Волна 2 (confirmClose): после
		// касания ждём первую свечу, ЗАКРЫВШУЮСЯ обратно на «нашей» стороне
		// уровня, вход по её close (сама свеча касания может подтвердить сразу).
		// Прошив стопа до подтверждения — invalidated: фильтр «не ловим нож».
		let entryIndex = -1
		let entryPriceActual = ctx.entryLevel
		let touched = false
		for (let i = ctx.fromIndex; i < candles.length; i++) {
			// Экспирация проверяется на баре подтверждения противоположного события:
			// сетап отменён структурным разворотом.
			if (ctx.expiryIndex != null && i >= ctx.expiryIndex) {
				return { ...base, state: 'expired' }
			}
			const candle = candles[i]
			if (!candle) continue

			const touchedEntry = long ? candle.low <= ctx.entryLevel : candle.high >= ctx.entryLevel
			const breachedStop = long ? candle.low <= ctx.stopLevel : candle.high >= ctx.stopLevel

			// Волна 3 (breaker161): импульс ушёл за уровень отмены до входа —
			// сетап отменён. Проверка ДО касания входа: конфликт в одном баре
			// (и 100, и 161 задеты) трактуется консервативно как отмена.
			if (ctx.cancelLevel != null) {
				const beyondCancel = long ? candle.high >= ctx.cancelLevel : candle.low <= ctx.cancelLevel
				if (beyondCancel) return { ...base, state: 'expired' }
			}

			if (ctx.confirmClose) {
				if (!touched && touchedEntry) touched = true
				if (touched) {
					// Цена ушла за стоп до подтверждения — вход отфильтрован.
					if (breachedStop) return { ...base, state: 'invalidated' }
					const closeConfirmed = long ? candle.close > ctx.entryLevel : candle.close < ctx.entryLevel
					if (closeConfirmed) {
						entryIndex = i
						entryPriceActual = candle.close
						break
					}
				}
				continue
			}

			if (touchedEntry) {
				entryIndex = i
				// Вход и стоп в одной свече — консервативно немедленный лосс.
				// Scale: уровень добора лежит между входом и стопом, значит на пути
				// к стопу задет — обе половины набраны, полный лосс −1R планового.
				if (breachedStop) {
					const addLvl = ctx.addLevel ?? null
					const conflictEntry = addLvl != null ? (ctx.entryLevel + addLvl) / 2 : ctx.entryLevel
					const conflictRisk =
						addLvl != null
							? 0.5 * Math.abs(ctx.entryLevel - ctx.stopLevel) + 0.5 * Math.abs(addLvl - ctx.stopLevel)
							: Math.abs(ctx.entryLevel - ctx.stopLevel)
					return {
						...base,
						entered: true,
						entryIndex: i,
						entryPrice: conflictEntry,
						riskSize: conflictRisk,
						state: 'stopped',
						stopIndex: i,
						rTp1: Math.abs(ctx.tp1 - conflictEntry) / conflictRisk,
						rTp2: Math.abs(ctx.tp2 - conflictEntry) / conflictRisk,
						rStop: -1,
						exposure: 1,
						barsToEntry: i - candidate.createdAtIndex,
						barsToResolve: 0,
						mfeR: 0,
						maeR: -1,
						maxExtensionRatio: ctx.extension
							? this.trackMaxExtension(candles, i, long, ctx.stopLevel, ctx.extension)
							: null,
						tpAfterStop: this.checkTpAfterStop(candles, ctx.events, i, long, ctx.tp1),
					}
				}
				break
			}
			// Стоп-зона без касания входа возможна только для breaker
			// (его вход на 100%, а 0% дальше), для ote/deep вход всегда раньше.
			if (breachedStop) {
				return { ...base, state: 'invalidated' }
			}
		}
		if (entryIndex < 0) return { ...base, state: 'no-entry' }

		// ---- Фаза 2: позиция открыта, ждём стоп или TP2 ----
		// При confirmClose вход по close подтверждающей свечи: её экстремумы уже
		// в прошлом, симуляция позиции начинается со СЛЕДУЮЩЕГО бара.
		//
		// Scale-in (волна 4): позиция 50/50, вторая половина — по касанию
		// addLevel (только до TP1). 1R = плановый риск полной позиции:
		// 0.5·|e1−stop| + 0.5·|add−stop|. Все R-значения (mae/mfe/rTp/rStop)
		// считаются от средневзвешенного входа с учётом набранной доли —
		// не набравшая добор позиция и рискует, и зарабатывает половиной.
		const e1 = entryPriceActual
		const addLevel = ctx.addLevel ?? null
		const plannedRisk =
			addLevel != null
				? 0.5 * Math.abs(e1 - ctx.stopLevel) + 0.5 * Math.abs(addLevel - ctx.stopLevel)
				: Math.abs(e1 - ctx.stopLevel)
		let exposure = addLevel != null ? 0.5 : 1
		let avgEntry = e1
		let addFilled = false
		const toR = (priceValue: number): number =>
			(exposure * (long ? priceValue - avgEntry : avgEntry - priceValue)) / plannedRisk

		let tp1Hit = false
		let tp1Index: number | null = null
		let tp2Hit = false
		let tp2Index: number | null = null
		let stopIndex: number | null = null
		// Для менеджмента «безубыток после TP1»: вернулась ли ��ена к входу
		// раньше TP2. Бар касания TP1 проверяется консервативно (см. модель).
		let beAfterTp1: boolean | null = null
		let mfeR = 0
		let maeR = 0
		let finalIndex = candles.length - 1
		let state: FibSetupOutcome['state'] = 'open'

		const phase2From = ctx.confirmClose ? entryIndex + 1 : entryIndex
		for (let i = phase2From; i < candles.length; i++) {
			const candle = candles[i]
			if (!candle) continue

			const hitStop = long ? candle.low <= ctx.stopLevel : candle.high >= ctx.stopLevel
			const hitTp1 = long ? candle.high >= ctx.tp1 : candle.low <= ctx.tp1
			const hitTp2 = long ? candle.high >= ctx.tp2 : candle.low <= ctx.tp2

			// Волна 4: добор второй половины — только до TP1. Конфликты в одном
			// баре: с TP1 — консервативно TP первым (добор НЕ засчитан, прибыль
			// половиной); со стопом — добор первым (полный лосс −1R планового).
			if (addLevel != null && !addFilled && !tp1Hit) {
				const touchedAdd = long ? candle.low <= addLevel : candle.high >= addLevel
				if (touchedAdd && (hitStop || !hitTp1)) {
					addFilled = true
					avgEntry = (e1 + addLevel) / 2
					exposure = 1
				}
			}

			const favorable = long ? candle.high : candle.low
			const adverse = long ? candle.low : candle.high
			mfeR = Math.max(mfeR, toR(favorable))
			// MAE фиксируется только ДО взятия TP1: это база для калибровки
			// стопа («насколько глубоко проседают будущие победители»).
			// Просадка раннера после TP1 — другой вопрос (менеджмент), она
			// загрязняла метрику значениями глубже стопа.
			if (!tp1Hit) maeR = Math.min(maeR, toR(adverse))

			const touchedEntryBack = long ? candle.low <= avgEntry : candle.high >= avgEntry

			// Возврат к входу после TP1 (до TP2) — раннер при безубытке закрыт в 0.
			if (tp1Hit && beAfterTp1 == null && !hitTp2 && touchedEntryBack) {
				beAfterTp1 = true
			}

			// Конфликт внутри бара: стоп имеет приоритет (консервативно лосс).
			if (hitStop) {
				stopIndex = i
				finalIndex = i
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
				tp2Hit = true
				tp2Index = i
				finalIndex = i
				state = 'tp2'
				if (beAfterTp1 == null) beAfterTp1 = false
				break
			}
		}

		return {
			...base,
			entered: true,
			entryIndex,
			entryPrice: avgEntry,
			riskSize: plannedRisk,
			state,
			tp1Hit,
			tp1Index,
			tp2Hit,
			tp2Index,
			stopIndex,
			// R-мультипликаторы целей от фактической позиции (для scale —
			// средневзвешенный вход, масштаб на набранную долю).
			rTp1: Math.abs(toR(ctx.tp1)),
			rTp2: Math.abs(toR(ctx.tp2)),
			// Фактический лосс в плановых R: полный набор = −1 ровно,
			// половина без добора = меньше по модулю.
			rStop: state === 'stopped' ? toR(ctx.stopLevel) : null,
			exposure,
			beAfterTp1,
			mfeR,
			maeR,
			maxExtensionRatio: ctx.extension
				? this.trackMaxExtension(candles, entryIndex, long, ctx.stopLevel, ctx.extension)
				: null,
			tpAfterStop:
				state === 'stopped' && stopIndex != null
					? this.checkTpAfterStop(candles, ctx.events, stopIndex, long, ctx.tp1)
					: null,
			barsToEntry: entryIndex - candidate.createdAtIndex,
			barsToResolve: finalIndex - entryIndex,
		}
	}

	/**
	 * Максимум цены после входа как ratio сетки. Скан строго вперёд от входа
	 * до первого касания ИСХОДНОГО стопа adverse-стороной либо конца данных
	 * (favorable-экстремум стоп-бара включается — как в mfeR).
	 * Диагностика для анализа целей 141/200/241 и трейлинга; в EV не участвует.
	 */
	private trackMaxExtension(
		candles: Candle[],
		entryIndex: number,
		long: boolean,
		stopLevel: number,
		extension: { p0: number; legSize: number },
	): number | null {
		if (extension.legSize <= 0) return null
		let maxFavorable = long ? -Infinity : Infinity
		for (let i = entryIndex; i < candles.length; i++) {
			const candle = candles[i]
			if (!candle) continue
			maxFavorable = long
				? Math.max(maxFavorable, candle.high)
				: Math.min(maxFavorable, candle.low)
			const hitStop = long ? candle.low <= stopLevel : candle.high >= stopLevel
			if (hitStop) break
		}
		if (!Number.isFinite(maxFavorable)) return null
		const distance = long ? maxFavorable - extension.p0 : extension.p0 - maxFavorable
		return (distance / extension.legSize) * 100
	}

	/**
	 * «Стоп выбит, затем TP1 достигнут»: скан после стоп-бара до подтверждения
	 * первого события ПРОТИВ направления сделки либо конца данных.
	 */
	private checkTpAfterStop(
		candles: Candle[],
		events: StructureEvent[],
		stopIndex: number,
		long: boolean,
		tp1: number,
	): boolean {
		const boundary = this.firstOppositeConfirm(long ? 'long' : 'short', stopIndex, events)
		for (let i = stopIndex + 1; i < candles.length; i++) {
			if (boundary != null && i >= boundary) break
			const candle = candles[i]
			if (!candle) continue
			const hitTp1 = long ? candle.high >= tp1 : candle.low <= tp1
			if (hitTp1) return true
		}
		return false
	}

	/**
	 * confirmIndex первого события против заданного направления после afterIndex.
	 * Используется для экспирации невошедших сетапов (направление сетки,
	 * afterIndex = createdAtIndex) и для окна tpAfterStop (направление сделки,
	 * afterIndex = стоп-бар).
	 */
	private firstOppositeConfirm(
		direction: FibDirection,
		afterIndex: number,
		events: StructureEvent[],
	): number | null {
		const wantDirection = direction === 'long' ? 'down' : 'up'
		for (const event of events) {
			if (event.type === 'unlabeled') continue
			if (event.confirmIndex <= afterIndex) continue
			if (event.direction === wantDirection) return event.confirmIndex
		}
		return null
	}
}
