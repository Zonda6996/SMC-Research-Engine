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
