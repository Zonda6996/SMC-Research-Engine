// FibLifecycleEngine.ts
//
// Симулирует плейбук по каждой Fib-сетке бар за баром и записывает исходы.
// Правила зафиксированы с пользователем (см. SPEC 7.8):
//   - OTE:     ретрейс в 61.8–78.6 → вход по 78.6;
//   - Deep:    откат в 23.6–38.2  → вход по 38.2;
//   - Breaker: цена дошла до 141 до касания OTE → вход на ретесте 100%;
//   - стоп за 0%, TP1 = 141, TP2 = 241;
//   - экспирация: противоположное событие подтверждено до входа;
//   - конфликт внутри бара (вход и стоп в одной свече) — консервативно лосс.
//
// Look-ahead исключён: симуляция начинается с createdAtIndex + 1 и идёт
// только вперёд; экспирация проверяется по confirmIndex событий.

import type { Candle } from '@/models/price/Candle.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { FibAnchorMode, FibGridCandidate, FibVariant } from '@/models/fib/FibGrid.js'
import type {
	FibLifecycleResult,
	FibScenario,
	FibSetupOutcome,
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
		for (const candidate of input.candidates) {
			for (const mode of ANCHOR_MODES) {
				const variant = candidate.variants[mode]
				if (!variant) continue
				outcomes.push(...this.simulate(candidate, mode, variant, input))
			}
		}
		return { outcomes }
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
		const p382 = price(38.2)
		const p786 = price(78.6)
		const p100 = price(100)
		const p141 = price(141)
		const p241 = price(241)

		// Индекс подтверждения первого противоположного события после создания —
		// с этого бара невошедшие сетапы экспирируются.
		const expiryIndex = this.firstOppositeConfirm(candidate, input.events)

		// Предусловие breaker: касание 141 ДО касания OTE-зоны (78.6).
		const { extFirst, extIndex } = this.breakerPrecondition(
			candidate.createdAtIndex + 1,
			input.candles,
			long,
			p786,
			p141,
			expiryIndex,
		)

		const scenarios: { scenario: FibScenario; entryLevel: number; fromIndex: number }[] = [
			{ scenario: 'ote', entryLevel: p786, fromIndex: candidate.createdAtIndex + 1 },
			{ scenario: 'deep', entryLevel: p382, fromIndex: candidate.createdAtIndex + 1 },
		]
		// Breaker существует только при выполненном предусловии; ретест 100%
		// отслеживается после бара, где цена достигла 141.
		if (extFirst && extIndex != null) {
			scenarios.push({ scenario: 'breaker', entryLevel: p100, fromIndex: extIndex + 1 })
		}

		return scenarios.map(({ scenario, entryLevel, fromIndex }) =>
			this.simulateScenario(candidate, mode, variant, scenario, {
				candles: input.candles,
				fromIndex,
				long,
				entryLevel,
				stopLevel: p0,
				tp1: p141,
				tp2: p241,
				expiryIndex,
			}),
		)
	}

	/**
	 * Проверяет, что случилось раньше после создания сетки:
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
		ctx: {
			candles: Candle[]
			fromIndex: number
			long: boolean
			entryLevel: number
			stopLevel: number
			tp1: number
			tp2: number
			expiryIndex: number | null
		},
	): FibSetupOutcome {
		const base: FibSetupOutcome = {
			candidateId: candidate.id,
			variantMode: mode,
			scenario,
			trigger: candidate.trigger,
			direction: candidate.direction,
			legAtrRatio: variant.legAtrRatio,
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
			mfeR: null,
			maeR: null,
			barsToEntry: null,
			barsToResolve: null,
		}

		const { candles, long } = ctx

		// ---- Фаза 1: ждём вход ----
		let entryIndex = -1
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

			if (touchedEntry) {
				entryIndex = i
				// Вход и стоп в одной свече — консервативно немедленный лосс.
				if (breachedStop) {
					return {
						...base,
						entered: true,
						entryIndex: i,
						entryPrice: ctx.entryLevel,
						riskSize: Math.abs(ctx.entryLevel - ctx.stopLevel),
						state: 'stopped',
						stopIndex: i,
						barsToEntry: i - candidate.createdAtIndex,
						barsToResolve: 0,
						mfeR: 0,
						maeR: -1,
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
		const entryPrice = ctx.entryLevel
		const risk = Math.abs(entryPrice - ctx.stopLevel)
		const toR = (priceValue: number): number =>
			(long ? priceValue - entryPrice : entryPrice - priceValue) / risk

		let tp1Hit = false
		let tp1Index: number | null = null
		let tp2Hit = false
		let tp2Index: number | null = null
		let stopIndex: number | null = null
		let mfeR = 0
		let maeR = 0
		let finalIndex = candles.length - 1
		let state: FibSetupOutcome['state'] = 'open'

		for (let i = entryIndex; i < candles.length; i++) {
			const candle = candles[i]
			if (!candle) continue

			const favorable = long ? candle.high : candle.low
			const adverse = long ? candle.low : candle.high
			mfeR = Math.max(mfeR, toR(favorable))
			maeR = Math.min(maeR, toR(adverse))

			const hitStop = long ? candle.low <= ctx.stopLevel : candle.high >= ctx.stopLevel
			const hitTp1 = long ? candle.high >= ctx.tp1 : candle.low <= ctx.tp1
			const hitTp2 = long ? candle.high >= ctx.tp2 : candle.low <= ctx.tp2

			// Конфликт внутри бара: стоп имеет приоритет (консервативно лосс).
			if (hitStop) {
				stopIndex = i
				finalIndex = i
				state = 'stopped'
				break
			}
			if (hitTp1 && !tp1Hit) {
				tp1Hit = true
				tp1Index = i
			}
			if (hitTp2) {
				tp2Hit = true
				tp2Index = i
				finalIndex = i
				state = 'tp2'
				break
			}
		}

		return {
			...base,
			entered: true,
			entryIndex,
			entryPrice,
			riskSize: risk,
			state,
			tp1Hit,
			tp1Index,
			tp2Hit,
			tp2Index,
			stopIndex,
			mfeR,
			maeR,
			barsToEntry: entryIndex - candidate.createdAtIndex,
			barsToResolve: finalIndex - entryIndex,
		}
	}

	/** confirmIndex первого события противоположного направления после создания сетки. */
	private firstOppositeConfirm(
		candidate: FibGridCandidate,
		events: StructureEvent[],
	): number | null {
		const wantDirection = candidate.direction === 'long' ? 'down' : 'up'
		for (const event of events) {
			if (event.type === 'unlabeled') continue
			if (event.confirmIndex <= candidate.createdAtIndex) continue
			if (event.direction === wantDirection) return event.confirmIndex
		}
		return null
	}
}
