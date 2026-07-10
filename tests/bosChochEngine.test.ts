// bosChochEngine.test.ts
//
// Юнит-тесты BosChochEngine (src/core/events/): пул активных уровней,
// каждый фильтр изолированно, порядок применения, классификация.
// Синтетические данные — SPEC, раздел 8.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BosChochEngine } from '../src/core/events/BosChochEngine.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

const MS = 60_000

function candle(index: number, close: number, opts?: { high?: number; low?: number }): Candle {
	const high = opts?.high ?? close + 1
	const low = opts?.low ?? close - 1
	return { timestamp: index * MS, open: close, high, low, close, volume: 1 }
}

function pt(
	index: number,
	price: number,
	type: 'high' | 'low',
	label: StructurePoint['label'] = 'UNKNOWN',
): StructurePoint {
	return { index, timestamp: index * MS, price, type, label }
}

/** Движок с выключенными фильтрами — для изоляции тестируемого фильтра. */
function bareEngine(overrides: ConstructorParameters<typeof BosChochEngine>[0] = {}) {
	return new BosChochEngine({
		collapseCascades: false,
		hhllOnly: false,
		minLevelAge: 0,
		dedupAtrMultiple: null,
		skipSweptAtrMultiple: null,
		...overrides,
	})
}

describe('BosChochEngine — пул активных уровней (two-candle)', () => {
	it('пробой уровня: закрытие за уровнем + подтверждение = событие', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 115), candle(8, 116),
		]
		const events = bareEngine().build([pt(4, 110, 'high')], candles)

		assert.equal(events.length, 1)
		assert.equal(events[0]!.levelPrice, 110)
		assert.equal(events[0]!.breachIndex, 7)
		assert.equal(events[0]!.confirmIndex, 8)
		assert.equal(events[0]!.direction, 'up')
	})

	it('защита уровня: вторая свеча закрылась обратно — события нет, снятие зафиксировано', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 115), candle(8, 108),
			candle(9, 115), candle(10, 116), // повторный пробой — теперь sweptBefore
		]
		const events = bareEngine().build([pt(4, 110, 'high')], candles)

		assert.equal(events.length, 1)
		assert.equal(events[0]!.confirmIndex, 10)
		assert.equal(events[0]!.sweptBefore, true, 'защита = снятие ликвидности')
	})

	it('look-ahead-free: уровень не проверяется до confirmedAt = index + window', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 115), candle(6, 116), candle(7, 117),
		]
		const events = bareEngine().build([pt(4, 110, 'high')], candles)

		assert.equal(events.length, 1)
		assert.equal(events[0]!.breachIndex, 6, 'свеча 5 ещё вне окна подтверждения')
	})

	it('уровень не вытесняется свежими: старый уровень пула ломается независимо', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 108), candle(8, 106), candle(9, 107),
			candle(10, 115), candle(11, 116), // сносит оба high
		]
		const structure = [pt(4, 110, 'high'), pt(7, 108, 'high')]
		const events = bareEngine().build(structure, candles)

		assert.equal(events.length, 2, 'оба уровня в пуле, оба сломаны')
	})
})

describe('BosChochEngine — фильтры изолированно', () => {
	it('hhllOnly: событие от HL/LH/UNKNOWN отсекается, HH/LL остаётся', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 108), candle(8, 106), candle(9, 107),
			candle(10, 115), candle(11, 116),
		]
		const structure = [pt(4, 110, 'high', 'HH'), pt(7, 108, 'high', 'LH')]
		const events = bareEngine({ hhllOnly: true }).build(structure, candles)

		assert.equal(events.length, 1)
		assert.equal(events[0]!.levelLabel, 'HH')
	})

	it('minLevelAge: молодой уровень не даёт события', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 115), candle(8, 116),
		]
		// confirm(8) - level(4) = 4 свечи. age 5 → отсечено, age 4 → прошло.
		assert.equal(bareEngine({ minLevelAge: 5 }).build([pt(4, 110, 'high')], candles).length, 0)
		assert.equal(bareEngine({ minLevelAge: 4 }).build([pt(4, 110, 'high')], candles).length, 1)
	})

	it('collapseCascades: одна свеча сносит два уровня → одно событие по дальнему', () => {
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 108), candle(8, 106), candle(9, 107),
			candle(10, 115), candle(11, 116),
		]
		const structure = [pt(4, 110, 'high'), pt(7, 108, 'high')]
		const events = bareEngine({ collapseCascades: true }).build(structure, candles)

		assert.equal(events.length, 1)
		assert.equal(events[0]!.levelIndex, 4, 'выживает самый старый уровень')
	})

	it('dedup: два события одного направления с уровнями ближе K×ATR → остаётся первое', () => {
		// Свечи с range ~2 → ATR ~2. Уровни 110 и 110.5 (ближе 1.2×ATR).
		// Ломаются на РАЗНЫХ свечах (не каскад).
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 110.5, { high: 111 }), candle(8, 106), candle(9, 107),
			candle(10, 108), candle(11, 108.5), // ждём (не пробой 110/110.5... close < 110)
			candle(12, 111), candle(13, 111.5), // слом 110.5? нет: 111 > 110.5 и 111 > 110 — каскад!
		]
		// Чтобы разнести сломы по свечам, уровни дальше друг от друга по времени слома:
		// проще: уровень A=110 ломается на 12–13, уровень B=110.5 тоже — каскад выключен,
		// dedup должен отсечь второе событие с той же confirm-свечи? Нет — dedup
		// сравнивает ЦЕНЫ уровней последовательных событий. Оба события выживут
		// в пуле (cascades off) и dedup отсечёт второе.
		// atrPeriod 3: на коротких синтетических рядах ATR(14) ещё не определён.
		const structure = [pt(4, 110, 'high'), pt(7, 110.5, 'high')]
		const withDedup = bareEngine({ dedupAtrMultiple: 1.2, atrPeriod: 3 }).build(structure, candles)
		const withoutDedup = bareEngine().build(structure, candles)

		assert.equal(withoutDedup.length, 2)
		assert.equal(withDedup.length, 1)
		assert.equal(withDedup[0]!.levelPrice, 110, 'остаётся первое (старший уровень)')
	})

	it('dedup: смена направления сбрасывает цепочку', () => {
		// up-событие, затем down-событие с уровнем на близкой цене — не дубликат.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 109.5, { low: 109 }), candle(8, 110.2), candle(9, 111),
			candle(10, 112), candle(11, 113),
			candle(12, 108), candle(13, 107), // слом low 109.5? close 108 < 109.5 → pending, 107 → confirm
		]
		const structure = [pt(4, 110, 'high'), pt(7, 109.5, 'low')]
		const events = bareEngine({ dedupAtrMultiple: 1.2 }).build(structure, candles)

		assert.equal(events.length, 2, 'разные направления — оба события остаются')
	})

	it('skipSwept: глубокое снятие ликвидности отрабатывает уровень, мелкий укол — нет', () => {
		// Уровень 110. Свеча 7: фитиль high=118 (прокол 8 >> ATR), закрытие 108 → снятие.
		// Свечи 9–10: настоящий слом. С фильтром (0.6×ATR≈1.2) событие отсечено.
		const deepSweep = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 108, { high: 118 }),
			candle(8, 109), candle(9, 115), candle(10, 116),
		]
		const structure = [pt(4, 110, 'high')]
		assert.equal(
			bareEngine({ skipSweptAtrMultiple: 0.6, atrPeriod: 3 }).build(structure, deepSweep).length,
			0,
			'глубокое снятие → уровень отработан',
		)
		assert.equal(bareEngine().build(structure, deepSweep).length, 1, 'без фильтра событие есть')

		// Мелкий укол: фитиль 110.5 (прокол 0.5 < 0.6×ATR) — слом остаётся событием.
		const shallowPoke = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 108, { high: 110.5 }),
			candle(8, 109), candle(9, 115), candle(10, 116),
		]
		assert.equal(
			bareEngine({ skipSweptAtrMultiple: 0.6, atrPeriod: 3 }).build(structure, shallowPoke).length,
			1,
			'мелкий укол не отрабатывает уровень',
		)
	})
})

describe('BosChochEngine — классификация и порядок фильтров', () => {
	it('sequential: первый=unlabeled, по направлению=BOS, против=CHoCH', () => {
		// up-слом @ ~8, up-слом @ ~12, down-слом @ ~16.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 115), candle(8, 116), // слом high 110 → unlabeled (первое)
			candle(9, 120), candle(10, 114), candle(11, 116),
			candle(12, 125), candle(13, 126), // слом high 120 → BOS (up после up)
			candle(14, 118, { low: 117 }), candle(15, 121), candle(16, 122),
			candle(17, 112), candle(18, 111), // слом low 118? нет уровня... 
		]
		const structure = [pt(4, 110, 'high'), pt(9, 120, 'high'), pt(14, 118, 'low')]
		const events = bareEngine().build(structure, candles)

		assert.equal(events.length, 3)
		assert.equal(events[0]!.type, 'unlabeled')
		assert.equal(events[1]!.type, 'bos', 'up после up')
		assert.equal(events[2]!.type, 'choch', 'down после up')
	})

	it('классификация применяется ПОСЛЕ фильтров: отсечённое событие не влияет на направление', () => {
		// Два up-слома: первый от LH (отсекается hhllOnly), второй от HH.
		// Если бы классификация шла до фильтра, второй был бы BOS;
		// после фильтра он ПЕРВЫЙ видимый → unlabeled.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 105), candle(6, 107),
			candle(7, 108, { high: 109 }), candle(8, 106), candle(9, 107),
			candle(10, 115), candle(11, 116),
		]
		const structure = [pt(4, 110, 'high', 'HH'), pt(7, 108, 'high', 'LH')]
		const events = bareEngine({ hhllOnly: true }).build(structure, candles)

		assert.equal(events.length, 1)
		assert.equal(events[0]!.type, 'unlabeled', 'первое видимое событие — не BOS')
	})

	it('дефолтный конфиг = принятый протоколом набор', () => {
		const engine = new BosChochEngine()
		// Проверяем через поведение: молодой уровень (age < 20) не даёт события.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110, { high: 110 }), candle(5, 108), candle(6, 109),
			candle(7, 115), candle(8, 116),
		]
		const events = engine.build([pt(4, 110, 'high', 'HH')], candles)
		assert.equal(events.length, 0, 'дефолт: min age 20 отсекает молодой уровень')
	})
})
