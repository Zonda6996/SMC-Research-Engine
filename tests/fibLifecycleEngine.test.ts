// fibLifecycleEngine.test.ts
//
// Синтетические сценарии плейбука: OTE-вход и цели, стоп, breaker,
// экспирация противоположным событием, конфликт входа и стопа в одном баре.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FibLifecycleEngine } from '@/core/fib/FibLifecycleEngine.js'
import { FibGridEngine } from '@/core/fib/FibGridEngine.js'
import type { FibGridCandidate } from '@/models/fib/FibGrid.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { Candle } from '@/models/price/Candle.js'

/** Свеча с одинаковым телом: high/low задают весь диапазон. */
function candle(i: number, high: number, low: number): Candle {
	return { timestamp: i * 60_000, open: (high + low) / 2, high, low, close: (high + low) / 2, volume: 1 }
}

/** Свеча с явным close — для тестов подтверждения закрытием (волна 2). */
function candleC(i: number, high: number, low: number, close: number): Candle {
	return { timestamp: i * 60_000, open: (high + low) / 2, high, low, close, volume: 1 }
}

/** Плоский ряд свечей вокруг цены. */
function flat(count: number, price: number): Candle[] {
	return Array.from({ length: count }, (_, i) => candle(i, price + 1, price - 1))
}

/**
 * Лонг-сетка: 0% = 100, 100% = 200 (нога 100).
 * Уровни: 78.6 → 178.6, 38.2 → 138.2, 141 → 241, 241 → 341.
 */
function longCandidate(createdAtIndex: number): FibGridCandidate {
	const levels = FibGridEngine.levels(100, 200)
	return {
		id: 'test:structural',
		eventId: 'test',
		trigger: 'bos',
		direction: 'long',
		end: { index: 5, timestamp: 5, price: 200, type: 'high', label: 'HH', knownAtIndex: 8 },
		variants: {
			local: {
				start: { index: 2, timestamp: 2, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 2 },
				levels,
				legSize: 100,
				legAtrRatio: 5,
			},
			global: null,
		},
		createdAtIndex,
		oppositeSweptBefore: false,
		explanation: 'test',
	}
}

function run(candidate: FibGridCandidate, candles: Candle[], events: StructureEvent[] = []) {
	return new FibLifecycleEngine().build({ candidates: [candidate], events, candles })
}

function outcome(
	result: ReturnType<FibLifecycleEngine['build']>,
	scenario: string,
	stopMode = 'zero',
) {
	return result.outcomes.find((o) => o.scenario === scenario && o.stopMode === stopMode)
}

describe('FibLifecycleEngine', () => {
	it('OTE: вход на 78.6, TP1 и TP2 достигнуты', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // ретрейс в OTE (178.6)
		candles.push(candle(11, 250, 200)) // TP1 (241)
		candles.push(candle(12, 350, 240)) // TP2 (341)
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.entered, true)
		assert.equal(ote?.entryIndex, 10)
		assert.equal(ote?.entryPrice, 178.6)
		assert.equal(ote?.tp1Hit, true)
		assert.equal(ote?.state, 'tp2')
		assert.equal(ote?.tp2Index, 12)
	})

	it('OTE: вход и затем стоп за 0% — state stopped', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход
		candles.push(candle(11, 180, 95)) // пробили 0% (100)
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.entered, true)
		assert.equal(ote?.state, 'stopped')
		assert.equal(ote?.stopIndex, 11)
		assert.equal(ote?.tp1Hit, false)
	})

	it('вход и стоп в одной свече — консервативно лосс', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 90)) // и вход, и стоп в одном баре
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.entered, true)
		assert.equal(ote?.state, 'stopped')
		assert.equal(ote?.barsToResolve, 0)
		assert.equal(ote?.maeR, -1)
	})

	it('deep: вход на 38.2 при глубоком откате', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 135)) // глубокий ретрейс до 138.2 (и OTE тоже)
		candles.push(candle(11, 250, 200))
		const result = run(longCandidate(9), candles)

		const deep = outcome(result, 'deep')
		assert.equal(deep?.entered, true)
		assert.equal(deep?.entryPrice, 138.2)
	})

	it('breaker: 141 раньше OTE → вход на ретесте 100%', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 245, 204)) // сразу к 141 (241) без OTE
		candles.push(candle(11, 240, 198)) // ретест 100% (200)
		candles.push(candle(12, 250, 220))
		const result = run(longCandidate(9), candles)

		const breaker = outcome(result, 'breaker')
		assert.ok(breaker, 'breaker-сетап должен существовать')
		assert.equal(breaker?.entered, true)
		assert.equal(breaker?.entryIndex, 11)
		assert.equal(breaker?.entryPrice, 200)
		assert.equal(breaker?.tp1Hit, true) // касание 241 в баре 12? high=250 ≥ 241 — да

		// OTE при этом коснулись на баре 11 (low 198 ≤ 178.6? нет, 198 > 178.6 — не коснулись).
		const ote = outcome(result, 'ote')
		assert.equal(ote?.entered, false)
	})

	it('breaker не создаётся, если OTE была раньше 141', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // OTE первой
		candles.push(candle(11, 250, 200)) // потом 141
		const result = run(longCandidate(9), candles)
		assert.equal(outcome(result, 'breaker'), undefined)
	})

	it('экспирация: противоположное событие до входа отменяет сетап', () => {
		const candles = flat(20, 205) // цена не ретрейсит
		const opposite: StructureEvent = {
			type: 'choch',
			direction: 'down',
			levelType: 'low',
			levelLabel: 'HL',
			levelIndex: 8,
			levelPrice: 190,
			breachIndex: 14,
			breachTimestamp: 14,
			confirmIndex: 15,
			confirmTimestamp: 15,
			sweptBefore: false,
			sweptDepth: 0,
			oppositeSweptBefore: false,
		}
		const result = run(longCandidate(9), candles, [opposite])

		const ote = outcome(result, 'ote')
		assert.equal(ote?.state, 'expired')
		assert.equal(ote?.entered, false)
	})

	it('no-entry: данные закончились без ретрейса', () => {
		const candles = flat(15, 205)
		const result = run(longCandidate(9), candles)
		assert.equal(outcome(result, 'ote')?.state, 'no-entry')
	})

	it('OTE tight: стоп за 23.6, срабатывает раньше стопа за 0%', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход на 178.6
		candles.push(candle(11, 180, 120)) // пробили 23.6 (123.6), но не 0% (100)
		const result = run(longCandidate(9), candles)

		const tight = outcome(result, 'ote', 'tight')
		assert.equal(tight?.entered, true)
		assert.equal(tight?.stopPrice, 123.6)
		assert.equal(tight?.state, 'stopped')

		const zero = outcome(result, 'ote', 'zero')
		assert.equal(zero?.state, 'open') // 0% не задет — позиция ещё жива
	})

	it('rTp1/rTp2 считаются от входа и риска', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175))
		candles.push(candle(11, 250, 200))
		candles.push(candle(12, 350, 240))
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		// Вход 178.6, стоп 100 → риск 78.6; TP1=241 → (241−178.6)/78.6 ≈ 0.794.
		assert.ok(Math.abs((ote?.rTp1 ?? 0) - (241 - 178.6) / 78.6) < 1e-9)
		assert.ok(Math.abs((ote?.rTp2 ?? 0) - (341 - 178.6) / 78.6) < 1e-9)
	})

	it('beAfterTp1: возврат к входу после TP1 фиксируется', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход 178.6
		candles.push(candle(11, 250, 200)) // TP1 (241)
		candles.push(candle(12, 200, 170)) // возврат к входу (178.6) без TP2
		candles.push(candle(13, 210, 190))
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.tp1Hit, true)
		assert.equal(ote?.beAfterTp1, true)
	})

	it('beAfterTp1 = false, если TP2 достигнут без возврата к входу', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175))
		candles.push(candle(11, 250, 200))
		candles.push(candle(12, 350, 240))
		const result = run(longCandidate(9), candles)
		assert.equal(outcome(result, 'ote')?.beAfterTp1, false)
	})

	// ---- Wide-стопы (буфер в ATR за 0%): ATR = legSize / legAtrRatio = 100/5 = 20,
	// wide05 → стоп 90, wide10 → стоп 80 ----

	it('wide05 переживает шейкаут, который выбивает zero', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход 178.6
		candles.push(candle(11, 180, 95)) // пробили 0% (100), но не 90
		candles.push(candle(12, 250, 200)) // TP1
		candles.push(candle(13, 350, 240)) // TP2
		const result = run(longCandidate(9), candles)

		const zero = outcome(result, 'ote', 'zero')
		assert.equal(zero?.state, 'stopped')

		const wide05 = outcome(result, 'ote', 'wide05')
		assert.equal(wide05?.stopPrice, 90)
		assert.equal(wide05?.state, 'tp2')

		const wide10 = outcome(result, 'ote', 'wide10')
		assert.equal(wide10?.stopPrice, 80)
		assert.equal(wide10?.state, 'tp2')
	})

	it('tpAfterStop: стоп выбит, затем TP1 всё же достигнут', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход 178.6
		candles.push(candle(11, 180, 95)) // стоп за 0%
		candles.push(candle(12, 250, 150)) // после стопа дошли до TP1 (241)
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.state, 'stopped')
		assert.equal(ote?.tpAfterStop, true)
		// Окно maxExtension закрывается на стоп-баре: максимум до него — 205.
		assert.equal(ote?.maxExtensionRatio, 105)
	})

	it('tpAfterStop = false, если после стопа TP1 не достигнут', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175))
		candles.push(candle(11, 180, 95)) // стоп
		candles.push(candle(12, 150, 120)) // TP1 не достигнут
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.state, 'stopped')
		assert.equal(ote?.tpAfterStop, false)
	})

	it('tpAfterStop = null для не-stopped исходов', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175))
		candles.push(candle(11, 250, 200))
		candles.push(candle(12, 350, 240))
		const result = run(longCandidate(9), candles)
		assert.equal(outcome(result, 'ote')?.tpAfterStop, null)
	})

	it('maxExtensionRatio продолжает расти после TP2 и фиксируется при касании стопа', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход
		candles.push(candle(11, 250, 200)) // TP1
		candles.push(candle(12, 350, 240)) // TP2 (ratio 250)
		candles.push(candle(13, 380, 300)) // продолжение до ratio 280
		candles.push(candle(14, 320, 95)) // возврат к исходному стопу — окно закрыто
		candles.push(candle(15, 500, 400)) // уже не учитывается
		const result = run(longCandidate(9), candles)

		const ote = outcome(result, 'ote')
		assert.equal(ote?.state, 'tp2')
		// (380 − 100) / 100 × 100 = 280; бар 15 за пределами окна.
		assert.equal(ote?.maxExtensionRatio, 280)
	})

	// ---- Fade: вход против сетки от зоны расширения ----

	it('fade141: касание 141 → шорт против лонг-сетки, цели 100% и 78.6', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 245, 204)) // касание 141 (241) → вход шорт
		candles.push(candle(11, 240, 195)) // TP1 = 100% (200)
		candles.push(candle(12, 200, 170)) // TP2 = 78.6 (178.6)
		const result = run(longCandidate(9), candles)

		const zone = outcome(result, 'fade141', 'zone')
		assert.equal(zone?.entered, true)
		assert.equal(zone?.direction, 'short') // фактическое направление сделки
		assert.equal(zone?.entryPrice, 241)
		assert.equal(zone?.stopPrice, 261) // за 161
		assert.equal(zone?.state, 'tp2')
		// Риск 20 (241→261), TP1 = 200 → rTp1 = 41/20 = 2.05.
		assert.ok(Math.abs((zone?.rTp1 ?? 0) - 2.05) < 1e-9)
		assert.equal(zone?.maxExtensionRatio, null) // только тренд-сценарии

		const zoneAtr = outcome(result, 'fade141', 'zoneAtr')
		assert.equal(zoneAtr?.stopPrice, 271) // 261 + 0.5 × ATR(20)
		assert.equal(zoneAtr?.state, 'tp2')
	})

	it('fade241: вход от 241, стоп за 261', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 345, 204)) // сразу к 241 (цена 341)
		candles.push(candle(11, 340, 195)) // TP1 (200)
		const result = run(longCandidate(9), candles)

		const zone = outcome(result, 'fade241', 'zone')
		assert.equal(zone?.entered, true)
		assert.equal(zone?.entryPrice, 341) // уровень 241 сетки
		assert.equal(zone?.stopPrice, 361) // уровень 261
		assert.equal(zone?.tp1Hit, true)
	})

	it('без legAtrRatio ATR-зависимые режимы не эмитятся', () => {
		const candidate = longCandidate(9)
		candidate.variants.local!.legAtrRatio = null
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175))
		const result = run(candidate, candles)

		assert.equal(outcome(result, 'ote', 'wide05'), undefined)
		assert.equal(outcome(result, 'ote', 'wide10'), undefined)
		assert.equal(outcome(result, 'deep', 'wide05'), undefined)
		assert.equal(outcome(result, 'fade141', 'zoneAtr'), undefined)
		assert.equal(outcome(result, 'fade141', 'far'), undefined)
		assert.equal(outcome(result, 'fade200', 'zoneAtr'), undefined)
		// ATR-независимые режимы на месте.
		assert.ok(outcome(result, 'ote', 'zero'))
		assert.ok(outcome(result, 'ote', 'tight'))
		assert.ok(outcome(result, 'fade141', 'zone'))
		assert.ok(outcome(result, 'fade241n', 'zone'))
		assert.ok(outcome(result, 'fade200', 'zone'))
	})

	// ---- Волна 1: широкий стоп fade141, ближние цели fade241n, вход от 200,
	// тренд с TP2 = 200. ATR = 20 (legSize 100 / legAtrRatio 5) ----

	it('fade141 far: стоп за 200 + 0.5 ATR переживает прошив 161', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 245, 204)) // касание 141 (241) → вход шорт
		candles.push(candle(11, 265, 230)) // прошили 161 (261) — zone выбит, far (310) жив
		candles.push(candle(12, 260, 195)) // TP1 = 100% (200)
		candles.push(candle(13, 200, 170)) // TP2 = 78.6 (178.6)
		const result = run(longCandidate(9), candles)

		const zone = outcome(result, 'fade141', 'zone')
		assert.equal(zone?.state, 'stopped')

		const far = outcome(result, 'fade141', 'far')
		assert.equal(far?.entered, true)
		assert.equal(far?.entryPrice, 241)
		assert.equal(far?.stopPrice, 310) // 300 (уровень 200) + 0.5 × 20
		assert.equal(far?.state, 'tp2')
		// Риск 69 (241→310), TP1 = 200 → rTp1 = 41/69.
		assert.ok(Math.abs((far?.rTp1 ?? 0) - 41 / 69) < 1e-9)
	})

	it('fade241n: вход от 241, ближние цели 141 → 100', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 345, 250)) // касание 241 (341) → вход шорт, до 241 не дошли
		candles.push(candle(11, 340, 240)) // TP1 = 141 (241)
		candles.push(candle(12, 250, 195)) // TP2 = 100% (200)
		const result = run(longCandidate(9), candles)

		const near = outcome(result, 'fade241n', 'zone')
		assert.equal(near?.entered, true)
		assert.equal(near?.entryPrice, 341)
		assert.equal(near?.stopPrice, 361) // за 261
		assert.equal(near?.tp1Index, 11)
		assert.equal(near?.state, 'tp2')
		assert.equal(near?.tp2Index, 12)
		// Риск 20, TP1 = 241 → rTp1 = 100/20 = 5.
		assert.equal(near?.rTp1, 5)

		// Старый fade241 (цели 100 → 78.6) в том же прогоне достиг только TP1.
		const old = outcome(result, 'fade241', 'zone')
		assert.equal(old?.tp1Hit, true)
		assert.equal(old?.state, 'open')
	})

	it('fade200: вход по касанию 200, стоп за 241 (+0.5 ATR), цель 100%', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 305, 204)) // касание 200 (300) → вход шорт
		candles.push(candle(11, 310, 250)) // ни стоп (341/351), ни тейк
		candles.push(candle(12, 260, 195)) // TP1 = 100% (200)
		const result = run(longCandidate(9), candles)

		const zone = outcome(result, 'fade200', 'zone')
		assert.equal(zone?.entered, true)
		assert.equal(zone?.entryPrice, 300)
		assert.equal(zone?.stopPrice, 341) // за 241
		assert.equal(zone?.tp1Hit, true)
		// Риск 41, TP1 = 200 → rTp1 = 100/41.
		assert.ok(Math.abs((zone?.rTp1 ?? 0) - 100 / 41) < 1e-9)

		const zoneAtr = outcome(result, 'fade200', 'zoneAtr')
		assert.equal(zoneAtr?.stopPrice, 351) // 341 + 0.5 × 20
		assert.equal(zoneAtr?.tp1Hit, true)
	})

	it('zero200: TP2 = 200 закрывается раньше, чем zero дошёл бы до 241', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 205, 175)) // вход 178.6
		candles.push(candle(11, 250, 200)) // TP1 (241)
		candles.push(candle(12, 305, 240)) // 200-уровень (300) достигнут, 241 (341) нет
		candles.push(candle(13, 250, 95)) // возврат в стоп
		const result = run(longCandidate(9), candles)

		const z200 = outcome(result, 'ote', 'zero200')
		assert.equal(z200?.state, 'tp2')
		assert.equal(z200?.tp2Index, 12)
		// Риск 78.6, TP2 = 300 → rTp2 = 121.4/78.6.
		assert.ok(Math.abs((z200?.rTp2 ?? 0) - 121.4 / 78.6) < 1e-9)

		const zero = outcome(result, 'ote', 'zero')
		assert.equal(zero?.state, 'stopped') // до 341 не дошли, вернулись в стоп
		assert.equal(zero?.tp1Hit, true)
	})

	// ---- Волна 2: вход с подтверждением закрытия свечи (fade141c/fade241nc).
	// Механизация «глаза»: после касания уровня ждём свечу, закрывшуюся
	// обратно на «нашей» стороне, вход по её close. ----

	it('fade141c: вход только после свечи, закрывшейся ниже 141', () => {
		const candles = flat(10, 205)
		// Касание 141 (241), но close выше уровня — подтверждения нет.
		candles.push(candleC(10, 245, 235, 243))
		// Свеча закрылась НИЖЕ 141 → подтверждение, вход по close = 238.
		candles.push(candleC(11, 244, 236, 238))
		// Позиция стартует со следующего бара: TP1 = 100% (200).
		candles.push(candle(12, 240, 195))
		const result = run(longCandidate(9), candles)

		const confirm = outcome(result, 'fade141c', 'far')
		assert.equal(confirm?.entered, true)
		assert.equal(confirm?.entryIndex, 11)
		assert.equal(confirm?.entryPrice, 238) // close подтверждающей свечи
		assert.equal(confirm?.stopPrice, 310) // 300 (уровень 200) + 0.5 ATR
		assert.equal(confirm?.tp1Hit, true)
		// Риск 72 (238→310), TP1 = 200 → rTp1 = 38/72.
		assert.ok(Math.abs((confirm?.rTp1 ?? 0) - 38 / 72) < 1e-9)

		// Обычный fade141 far вошёл бы уже на баре 10 по 241.
		const instant = outcome(result, 'fade141', 'far')
		assert.equal(instant?.entryIndex, 10)
		assert.equal(instant?.entryPrice, 241)
	})

	it('fade141c: прошив стопа до подтверждения — invalidated (нож отфильтрован)', () => {
		const candles = flat(10, 205)
		candles.push(candleC(10, 245, 235, 243)) // касание 141, без подтверждения
		candles.push(candleC(11, 315, 240, 312)) // пронесло через стоп (310) — фильтр
		candles.push(candle(12, 300, 195))
		const result = run(longCandidate(9), candles)

		const confirm = outcome(result, 'fade141c', 'far')
		assert.equal(confirm?.state, 'invalidated')
		assert.equal(confirm?.entered, false)

		// Обычный fade141 far вошёл на 10-м баре и словил стоп на 11-м.
		const instant = outcome(result, 'fade141', 'far')
		assert.equal(instant?.state, 'stopped')
	})

	it('fade241nc: подтверждение может прийти в самой свече касания', () => {
		const candles = flat(10, 205)
		// Касание 241 (341) с закрытием ниже уровня — подтверждение сразу.
		candles.push(candleC(10, 345, 300, 320))
		candles.push(candle(11, 330, 240)) // TP1 = 141 (241)
		candles.push(candle(12, 250, 195)) // TP2 = 100% (200)
		const result = run(longCandidate(9), candles)

		const confirm = outcome(result, 'fade241nc', 'zoneAtr')
		assert.equal(confirm?.entered, true)
		assert.equal(confirm?.entryIndex, 10)
		assert.equal(confirm?.entryPrice, 320) // close свечи касания
		assert.equal(confirm?.stopPrice, 371) // 361 (уровень 261) + 0.5 ATR
		assert.equal(confirm?.tp1Index, 11)
		assert.equal(confirm?.state, 'tp2')
	})

	// ---- Гистограмма досягаемости: куда цена ходит после события,
	// независимо от сценариев входа (одна запись на кандидат × якорь). ----

	it('reach: min/max ratio замеряются от создания до конца данных', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 210, 170)) // low 170 → ratio 70
		candles.push(candle(11, 260, 200)) // high 260 → ratio 160
		candles.push(candle(12, 240, 190))
		const result = run(longCandidate(9), candles)

		assert.equal(result.reach.length, 1)
		const reach = result.reach[0]
		assert.equal(reach?.variantMode, 'local')
		assert.equal(reach?.trigger, 'bos')
		// Замер с бара 10: min low = 170 → (170−100)/100×100 = 70.
		assert.equal(reach?.minRetraceRatio, 70)
		// Max high = 260 → ratio 160.
		assert.equal(reach?.maxExtensionRatio, 160)
		assert.equal(reach?.windowBars, 3)
	})

	it('reach: окно обрезается подтверждением противоположного события', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 210, 170)) // ratio 70 — в окне
		candles.push(candle(11, 230, 200)) // ratio 130 — в окне
		candles.push(candle(12, 300, 90)) // вне окна: expiry на баре 12
		const opposite: StructureEvent = {
			type: 'choch',
			direction: 'down',
			levelPrice: 120,
			levelType: 'low',
			levelIndex: 3,
			levelLabel: 'UNKNOWN',
			breachIndex: 11,
			breachTimestamp: 11,
			confirmIndex: 12,
			confirmTimestamp: 12,
			sweptBefore: false,
			sweptDepth: 0,
			oppositeSweptBefore: false,
		}
		const result = run(longCandidate(9), candles, [opposite])

		const reach = result.reach[0]
		assert.equal(reach?.minRetraceRatio, 70)
		assert.equal(reach?.maxExtensionRatio, 130) // бар 12 не попал в окно
		assert.equal(reach?.windowBars, 2)
	})

	it('reach: fade-reach after141/after241 замеряются после первого касания', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 220, 180)) // до 141 (241) не дошли: after141 = null пока
		candles.push(candle(11, 250, 210)) // касание 141 (241): after141 стартует
		candles.push(candle(12, 230, 150)) // откат до ratio 50 после касания
		candles.push(candle(13, 350, 200)) // продолжение до ratio 250 (241 тоже задет)
		candles.push(candle(14, 320, 280)) // после касания 241: откат до 180
		const result = run(longCandidate(9), candles)

		const reach = result.reach[0]
		// after141: окно с бара 11 (свеча касания включена).
		assert.equal(reach?.after141?.pullbackRatio, 50) // low 150 на баре 12
		assert.equal(reach?.after141?.extensionRatio, 250) // high 350 на баре 13
		// after241: окно с бара 13 (первое касание 241 = 341? нет: ratio 241 = цена 341).
		// High 350 → ratio 250 ≥ 241, значит бар 13 — касание.
		assert.equal(reach?.after241?.pullbackRatio, 100) // low 200 на баре 13
		assert.equal(reach?.after241?.extensionRatio, 250)
	})

	it('reach: after141 = null, если 141 не был достигнут', () => {
		const candles = flat(10, 205)
		candles.push(candle(10, 230, 180)) // max ratio 130 < 141
		candles.push(candle(11, 220, 190))
		const result = run(longCandidate(9), candles)

		const reach = result.reach[0]
		assert.equal(reach?.after141, null)
		assert.equal(reach?.after241, null)
	})

	it('полный runAnalysis возвращает fibLifecycle', async () => {
		const { runAnalysis } = await import('@/core/analysis/runAnalysis.js')
		const { readFileSync } = await import('node:fs')
		const fixture = JSON.parse(
			readFileSync(new URL('./fixtures/btcusdt-15m-500.json', import.meta.url), 'utf-8'),
		)
		const snapshot = runAnalysis(fixture)
		assert.ok(Array.isArray(snapshot.fibLifecycle.outcomes))
		assert.ok(snapshot.fibLifecycle.outcomes.length > 0)
	})
})
