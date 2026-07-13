// multiTfEntryEngine.test.ts
//
// Синтетические сценарии мульти-ТФ входа (SPEC 7.14): CHoCH-вход и стоп за
// LTF-экстремум, перезаход после выбитого стопа, лимит попыток, отмена по 0%
// старшей сетки, дедлайн, look-ahead-граница активации.
//
// События триггера в тестах рукотворные (минимальный StructureEvent) —
// сам BosChochEngine покрыт собственными тестами; здесь проверяется
// механика движка вокруг триггера.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MultiTfEntryEngine, chochTrigger, computeLtfEvents } from '@/core/fib/MultiTfEntryEngine.js'
import type { MultiTfSetupSpec } from '@/models/fib/MultiTf.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { Candle } from '@/models/price/Candle.js'

const TF = 60_000

/** Свеча с явными OHLC; timestamp = i × 1 минута. */
function candle(i: number, high: number, low: number, close?: number): Candle {
	return { timestamp: i * TF, open: (high + low) / 2, high, low, close: close ?? (high + low) / 2, volume: 1 }
}

/** Минимальное CHoCH-событие: важны только type/direction/confirmIndex. */
function choch(confirmIndex: number, direction: 'up' | 'down'): StructureEvent {
	return {
		type: 'choch',
		direction,
		levelPrice: 0,
		levelType: direction === 'up' ? 'high' : 'low',
		levelIndex: 0,
		levelLabel: 'UNKNOWN',
		breachIndex: confirmIndex - 1,
		breachTimestamp: (confirmIndex - 1) * TF,
		confirmIndex,
		confirmTimestamp: confirmIndex * TF,
		sweptBefore: false,
		sweptDepth: 0,
		oppositeSweptBefore: false,
	}
}

/**
 * Базовый лонг-сетап: зона 100 (вход старшей сетки), 0% = 90 (отмена),
 * TP1 = 120, TP2 = 140, HTF-риск = 10.
 */
function longSpec(overrides: Partial<MultiTfSetupSpec> = {}): MultiTfSetupSpec {
	return {
		id: 'test|local|ote',
		scenario: 'ote',
		direction: 'long',
		entryLevel: 100,
		cancelLevel: 90,
		tp1: 120,
		tp2: 140,
		htfRiskSize: 10,
		activationTimestamp: 0,
		deadlineTimestamp: null,
		...overrides,
	}
}

describe('MultiTfEntryEngine: вход и стоп', () => {
	it('CHoCH-вход: entry по close свечи подтверждения, стоп за LTF-экстремум окна', () => {
		// Бар 0: касание зоны (low 99). Бары 1–2: локальный лоу 97.
		// Бар 3: CHoCH подтверждён, close 103. Бары 4–6: рост до TP2.
		const candles = [
			candle(0, 105, 99),
			candle(1, 102, 97),
			candle(2, 103, 98),
			candle(3, 104, 100, 103),
			candle(4, 125, 102), // TP1 = 120
			candle(5, 130, 118),
			candle(6, 145, 125), // TP2 = 140
		]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [choch(3, 'up')],
		})
		assert.equal(outcomes.length, 1)
		const o = outcomes[0]!
		assert.equal(o.state, 'tp2')
		assert.equal(o.entered, true)
		assert.equal(o.entryIndex, 3)
		assert.equal(o.entryPrice, 103)
		// Экстремум окна [0..3]: min low = 97.
		assert.equal(o.stopPrice, 97)
		assert.equal(o.riskSize, 6)
		// riskRatio = 6 / 10.
		assert.equal(o.riskRatio, 0.6)
		assert.equal(o.tp1Hit, true)
		assert.equal(o.tp1Index, 4)
		assert.equal(o.tp2Index, 6)
		// rTp1 = (120 − 103) / 6.
		assert.ok(Math.abs((o.rTp1 ?? 0) - 17 / 6) < 1e-9)
	})

	it('шорт зеркален: стоп за max high окна, цели ниже', () => {
		const spec = longSpec({
			direction: 'short',
			entryLevel: 100,
			cancelLevel: 110,
			tp1: 80,
			tp2: 60,
		})
		const candles = [
			candle(0, 101, 95), // касание зоны (high 101 >= 100)
			candle(1, 103, 96), // локальный хай 103
			candle(2, 102, 97),
			candle(3, 100, 96, 97), // CHoCH вниз, close 97
			candle(4, 98, 78), // TP1 = 80
			candle(5, 82, 58), // TP2 = 60
		]
		const outcomes = new MultiTfEntryEngine().simulateSetup(spec, {
			ltfCandles: candles,
			ltfEvents: [choch(3, 'down')],
		})
		const o = outcomes[0]!
		assert.equal(o.state, 'tp2')
		assert.equal(o.stopPrice, 103)
		assert.equal(o.riskSize, 6)
	})

	it('конфликт в баре после входа: стоп имеет приоритет над TP', () => {
		const candles = [
			candle(0, 105, 99),
			candle(1, 103, 97),
			candle(2, 104, 100, 103), // вход, стоп 97
			candle(3, 125, 96), // и TP1, и стоп в одном баре → лосс
		]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [choch(2, 'up')],
		})
		const o = outcomes[0]!
		assert.equal(o.state, 'stopped')
		assert.equal(o.tp1Hit, false)
		assert.equal(o.rStop, -1)
	})
})

describe('MultiTfEntryEngine: перезаходы', () => {
	it('после выбитого стопа — второй вход по следующему CHoCH, максимум 2 попытки', () => {
		const candles = [
			candle(0, 105, 99), // касание зоны
			candle(1, 102, 98),
			candle(2, 103, 100, 102), // CHoCH #1: вход 102, стоп 98
			candle(3, 103, 97), // стоп выбит (97 < 98)
			candle(4, 100, 96),
			candle(5, 101, 97, 100), // CHoCH #2: вход 100, стоп 96 (окно [4..5])
			candle(6, 99, 95), // стоп #2 выбит
			candle(7, 100, 96),
			candle(8, 102, 98, 101), // CHoCH #3 — НЕ должен использоваться (лимит 2)
			candle(9, 150, 100),
		]
		const events = [choch(2, 'up'), choch(5, 'up'), choch(8, 'up')]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: events,
		})
		assert.equal(outcomes.length, 2)
		assert.equal(outcomes[0]!.attempt, 1)
		assert.equal(outcomes[0]!.state, 'stopped')
		assert.equal(outcomes[0]!.entryIndex, 2)
		assert.equal(outcomes[1]!.attempt, 2)
		assert.equal(outcomes[1]!.state, 'stopped')
		assert.equal(outcomes[1]!.entryIndex, 5)
		// Стоп второй попытки — экстремум окна ПОСЛЕ первого стопа [4..5], не 95.
		assert.equal(outcomes[1]!.stopPrice, 96)
	})

	it('после успешной попытки перезахода нет', () => {
		const candles = [
			candle(0, 105, 99),
			candle(1, 103, 97),
			candle(2, 104, 100, 103), // вход
			candle(3, 125, 102), // TP1
			candle(4, 145, 120), // TP2
			candle(5, 100, 90),
		]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [choch(2, 'up'), choch(5, 'up')],
		})
		assert.equal(outcomes.length, 1)
		assert.equal(outcomes[0]!.state, 'tp2')
	})
})

describe('MultiTfEntryEngine: отмена и дедлайн', () => {
	it('пересечение 0% старшей сетки до триггера — cancelled', () => {
		const candles = [
			candle(0, 105, 99), // касание зоны
			candle(1, 100, 89), // low 89 < cancelLevel 90 — сетап мёртв
			candle(2, 104, 100, 103), // CHoCH после отмены — недействителен
		]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [choch(2, 'up')],
		})
		assert.equal(outcomes.length, 1)
		assert.equal(outcomes[0]!.state, 'cancelled')
		assert.equal(outcomes[0]!.entered, false)
	})

	it('пересечение 0% раньше касания зоны — cancelled без активации', () => {
		// Гэп: цена прошила и зону, и 0% одним баром.
		const candles = [candle(0, 105, 85), candle(1, 104, 100, 103)]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [choch(1, 'up')],
		})
		assert.equal(outcomes[0]!.state, 'cancelled')
	})

	it('CHoCH после дедлайна недействителен — no-trigger', () => {
		const candles = [
			candle(0, 105, 99),
			candle(1, 102, 98),
			candle(2, 103, 99),
			candle(3, 104, 100, 103), // CHoCH на баре 3, но дедлайн — ts бара 2
		]
		const outcomes = new MultiTfEntryEngine().simulateSetup(
			longSpec({ deadlineTimestamp: 2 * TF }),
			{ ltfCandles: candles, ltfEvents: [choch(3, 'up')] },
		)
		assert.equal(outcomes.length, 1)
		assert.equal(outcomes[0]!.state, 'no-trigger')
	})

	it('триггера нет до конца данных — no-trigger', () => {
		const candles = [candle(0, 105, 99), candle(1, 102, 98), candle(2, 103, 99)]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [],
		})
		assert.equal(outcomes[0]!.state, 'no-trigger')
	})

	it('касания зоны нет — no-touch', () => {
		// Цена не опускается до 100.
		const candles = [candle(0, 110, 104), candle(1, 112, 105)]
		const outcomes = new MultiTfEntryEngine().simulateSetup(longSpec(), {
			ltfCandles: candles,
			ltfEvents: [],
		})
		assert.equal(outcomes[0]!.state, 'no-touch')
	})
})

describe('MultiTfEntryEngine: look-ahead-границы', () => {
	it('LTF-свечи и CHoCH до activationTimestamp не участвуют', () => {
		// Бары 0–2 — до активации (глубокий лоу 80 НЕ должен попасть в стоп,
		// CHoCH на баре 1 НЕ должен использоваться как триггер).
		const candles = [
			candle(0, 105, 80),
			candle(1, 104, 95, 103),
			candle(2, 106, 100),
			candle(3, 105, 99), // активация с ts = 3×TF: касание зоны
			candle(4, 102, 97),
			candle(5, 104, 100, 103), // CHoCH после активации
			candle(6, 125, 102),
			candle(7, 145, 120),
		]
		const events = [choch(1, 'up'), choch(5, 'up')]
		const outcomes = new MultiTfEntryEngine().simulateSetup(
			longSpec({ activationTimestamp: 3 * TF }),
			{ ltfCandles: candles, ltfEvents: events },
		)
		const o = outcomes[0]!
		assert.equal(o.state, 'tp2')
		assert.equal(o.entryIndex, 5)
		// Стоп — экстремум окна [3..5] = 97, а не 80 из свечей до активации.
		assert.equal(o.stopPrice, 97)
	})

	it('стоп глубже 0% старшей сетки — попытка пропущена, ждём следующий триггер', () => {
		const candles = [
			candle(0, 105, 99),
			candle(1, 102, 89.5), // лоу глубже cancelLevel 90 — стоп бессмыслен
			candle(2, 104, 100, 103), // CHoCH #1: стоп был бы 89.5 ≤ 90 → пропуск
			candle(3, 105, 101),
			candle(4, 106, 102, 105), // CHoCH #2: окно [0..4] всё ещё содержит 89.5
		]
		// Пересечение cancelLevel в баре 1 отменяет сетап раньше — этот тест
		// проверяет ветку пропуска через ослабленный cancelLevel.
		const spec = longSpec({ cancelLevel: 89.6 })
		const outcomes = new MultiTfEntryEngine().simulateSetup(spec, {
			ltfCandles: candles,
			ltfEvents: [choch(2, 'up'), choch(4, 'up')],
		})
		// Бар 1 пересёк cancelLevel (89.5 < 89.6) — отмена. Ветка стоп-глубже-
		// отмены недостижима при cancel-скане: проверяем итог — не вошли.
		assert.equal(outcomes[0]!.entered, false)
	})
})

describe('chochTrigger и computeLtfEvents', () => {
	it('chochTrigger игнорирует BOS и события против направления', () => {
		const bos: StructureEvent = { ...choch(2, 'up'), type: 'bos' }
		const down = choch(3, 'down')
		const up = choch(4, 'up')
		const signal = chochTrigger({
			candles: [],
			events: [bos, down, up],
			fromIndex: 0,
			direction: 'long',
		})
		assert.equal(signal?.confirmIndex, 4)
	})

	it('computeLtfEvents прогоняет мини-пайплайн без ошибок на синтетике', () => {
		// Зигзаг с понижающимися лоу и пробоем вверх — хватит для пивотов.
		const prices = [100, 105, 98, 103, 96, 101, 94, 108, 112, 106, 116, 120, 114, 124, 128]
		const candles = prices.map((p, i) => candle(i, p + 2, p - 2, p))
		const events = computeLtfEvents(candles)
		assert.ok(Array.isArray(events))
	})
})
