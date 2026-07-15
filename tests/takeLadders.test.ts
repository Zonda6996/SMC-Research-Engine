// Тесты SPEC 7.22: реплей лестниц тейков (takeLadders.ts).
//
// Проверяем: базовые исходы (стоп, полная лестница, BE после частичной
// фиксации), консервативные конвенции конфликтов внутри бара, перенормировку
// долей при невалидных ступенях и null для неразрешённых позиций.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import type { FibSetupOutcome } from '../src/models/fib/FibLifecycle.js'
import { replayLadder, TAKE_LADDERS, type TakeLadder } from '../src/core/analysis/takeLadders.js'
import { FEE_RATE, SLIP_RATE } from '../src/core/fib/fibCosts.js'

// ---------------------------------------------------------------------------
// Хелперы

function candle(low: number, high: number, timestamp = 0): Candle {
	return { timestamp, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 }
}

/** Лонг: вход 100, стоп 90 (риск 10). Уровни: 100→110, 141→114.1, 241→124.1. */
function makeOutcome(overrides: Partial<FibSetupOutcome> = {}): FibSetupOutcome {
	return {
		candidateId: 'c1',
		variantMode: 'local',
		scenario: 'ote',
		stopMode: 'zero',
		trigger: 'bos',
		direction: 'long',
		legAtrRatio: null,
		oppositeSweptBefore: false,
		createdAtIndex: 0,
		entered: true,
		entryIndex: 1,
		entryPrice: 100,
		stopPrice: 90,
		riskSize: 10,
		state: 'tp2',
		tp1Hit: false,
		tp1Index: null,
		tp2Hit: false,
		tp2Index: null,
		stopIndex: null,
		rTp1: null,
		rTp2: null,
		...overrides,
	} as FibSetupOutcome
}

const LEVELS: Record<number, number> = { 100: 110, 141: 114.1, 161: 116.1, 241: 124.1 }
const levelPrice = (ratio: number): number | null => LEVELS[ratio] ?? null

const entryCost = (100 * (FEE_RATE + SLIP_RATE)) / 10

function ladder(id: string): TakeLadder {
	const found = TAKE_LADDERS.find((l) => l.id === id)
	assert.ok(found, `ladder ${id} exists`)
	return found
}

// ---------------------------------------------------------------------------
// Базовые исходы

test('стоп до любых тейков: netR ≈ -1 - издержки', () => {
	const candles = [candle(99, 101), candle(99, 101), candle(89, 101)]
	const netR = replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-only'))
	assert.ok(netR != null)
	const expected = -1 - entryCost - (90 * (FEE_RATE + SLIP_RATE)) / 10
	assert.ok(Math.abs(netR - expected) < 1e-9, `netR ${netR} ≈ ${expected}`)
})

test('t100-only: полный выход на 100-уровне (+1R минус издержки)', () => {
	const candles = [candle(99, 101), candle(99, 101), candle(100, 111)]
	const netR = replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-only'))
	assert.ok(netR != null)
	const expected = 1 - entryCost - (110 * FEE_RATE) / 10
	assert.ok(Math.abs(netR - expected) < 1e-9, `netR ${netR} ≈ ${expected}`)
})

test('полная лестница t100-141-241 без возврата к входу', () => {
	const candles = [
		candle(99, 101),
		candle(99, 101),
		candle(101, 111), // 100
		candle(103, 115), // 141
		candle(110, 125), // 241
	]
	const netR = replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-141-241'))
	assert.ok(netR != null)
	const third = 1 / 3
	const expected =
		third * 1 + third * 1.41 + third * 2.41
		- entryCost
		- (110 * FEE_RATE * third) / 10 - (114.1 * FEE_RATE * third) / 10 - (124.1 * FEE_RATE * third) / 10
	assert.ok(Math.abs(netR - expected) < 1e-6, `netR ${netR} ≈ ${expected}`)
})

test('BE после первой фиксации: тейк 100, возврат к входу закрывает остаток', () => {
	const candles = [
		candle(99, 101),
		candle(99, 101),
		candle(101, 111), // 100 взят (лоу 101 > входа 100 — BE не тронут)
		candle(99, 105),  // возврат к входу: остаток закрыт по BE
	]
	const netR = replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-241'))
	assert.ok(netR != null)
	const expected = 0.5 * 1 - entryCost - (110 * FEE_RATE * 0.5) / 10 - (100 * (FEE_RATE + SLIP_RATE) * 0.5) / 10
	assert.ok(Math.abs(netR - expected) < 1e-9, `netR ${netR} ≈ ${expected}`)
})

// ---------------------------------------------------------------------------
// Консервативные конвенции

test('конфликт стоп/тейк до первой фиксации = стоп', () => {
	const candles = [candle(99, 101), candle(99, 101), candle(89, 111)]
	const netR = replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-only'))
	assert.ok(netR != null)
	assert.ok(netR < -0.9, `конфликтный бар решён как стоп, netR ${netR}`)
})

test('BE взведён ранее: бар с тейком и касанием входа = BE остатка (консервативно)', () => {
	const candles = [
		candle(99, 101),
		candle(99, 101),
		candle(101, 111),  // 100 взят чисто, BE взведён
		candle(99, 115),   // бар достаёт и 141, и вход: порядок неизвестен → BE всего остатка
	]
	const netR = replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-141-241'))
	assert.ok(netR != null)
	const third = 1 / 3
	// 100 взят (треть), остаток 2/3 закрыт по BE — тейк 141 НЕ засчитан
	const expected =
		third * 1
		- entryCost
		- (110 * FEE_RATE * third) / 10
		- (100 * (FEE_RATE + SLIP_RATE) * (2 * third)) / 10
	assert.ok(Math.abs(netR - expected) < 1e-6, `netR ${netR} ≈ ${expected}`)
})

test('шорт: зеркальная механика', () => {
	const outcome = makeOutcome({ direction: 'short', entryPrice: 100, stopPrice: 110, riskSize: 10 })
	const shortLevels: Record<number, number> = { 100: 90, 241: 75.9 }
	const lp = (r: number): number | null => shortLevels[r] ?? null
	const candles = [
		candle(99, 101),
		candle(99, 101),
		candle(89, 101),  // 100 (90) взят; хай 101 > входа 100 — но фиксации в этом же баре
	]
	// Бар 2: берёт тейк 90 и касается входа (хай 101 ≥ 100) → тейк + BE остатка
	const netR = replayLadder(candles, outcome, lp, ladder('t100-241'))
	assert.ok(netR != null)
	const expected = 0.5 * 1 - entryCost - (90 * FEE_RATE * 0.5) / 10 - (100 * (FEE_RATE + SLIP_RATE) * 0.5) / 10
	assert.ok(Math.abs(netR - expected) < 1e-9, `netR ${netR} ≈ ${expected}`)
})

// ---------------------------------------------------------------------------
// Валидация ступеней и неразрешённые позиции

test('ступень не в сторону профита отбрасывается, доли перенормируются', () => {
	// Вход 100: «тейк» на 100 из уровня 110 валиден для лонга; сделаем уровень
	// ниже входа — невалиден.
	const badLevels: Record<number, number> = { 100: 95, 241: 124.1 }
	const lp = (r: number): number | null => badLevels[r] ?? null
	const candles = [candle(99, 101), candle(99, 101), candle(101, 125)]
	const netR = replayLadder(candles, makeOutcome(), lp, ladder('t100-241'))
	assert.ok(netR != null)
	// Вся позиция на 241 (124.1): +2.41R минус издержки
	const expected = 2.41 - entryCost - (124.1 * FEE_RATE) / 10
	assert.ok(Math.abs(netR - expected) < 1e-6, `netR ${netR} ≈ ${expected}`)
})

test('нет валидных ступеней: null', () => {
	const lp = (): number | null => null
	const candles = [candle(99, 101), candle(99, 101)]
	assert.equal(replayLadder(candles, makeOutcome(), lp, ladder('t100-only')), null)
})

test('данные кончились с открытым остатком: null', () => {
	const candles = [candle(99, 101), candle(99, 101), candle(101, 105)]
	assert.equal(replayLadder(candles, makeOutcome(), levelPrice, ladder('t100-only')), null)
})

test('не вошедшая сделка: null', () => {
	const candles = [candle(99, 101)]
	assert.equal(replayLadder(candles, makeOutcome({ entered: false, entryIndex: null, entryPrice: null }), levelPrice, ladder('t100-only')), null)
})

test('canon-лестница существует и повторяет канонический менеджмент (141+241)', () => {
	const canon = ladder('canon')
	assert.deepEqual(canon.steps.map((s) => s.ratio), [141, 241])
	assert.deepEqual(canon.steps.map((s) => s.fraction), [0.5, 0.5])
})
