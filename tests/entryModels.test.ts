// entryModels.test.ts — SPEC 7.24: модели входа, косты BingX, bigbar.
//
// Сценарий-фикстура: лонг, уровень входа 100, стоп 90 (риск 10), тейк 120.
// Свечи синтетические; проверяются статусы, границы и знаки netR, а не
// точные значения костов (они проверяются в двух opposite-тестах).

import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
	replayEntryModel,
	bigbarCovered,
	BINGX_MAKER_RATE,
	BINGX_TAKER_RATE,
	BINGX_SLIP_RATE,
	CONFIRM_MAX_BARS,
} from '../src/core/analysis/entryModels.js'
import type { FibSetupOutcome } from '../src/models/fib/FibLifecycle.js'
import type { Candle } from '../src/models/price/Candle.js'

let ts = 0
function candle(low: number, high: number, open?: number, close?: number): Candle {
	ts += 60_000
	const o = open ?? (low + high) / 2
	const c = close ?? (low + high) / 2
	return { timestamp: ts, open: o, high, low, close: c, volume: 1 }
}

/** Канонический touch-исход: вход на 100 (бар index=1), стоп 90. */
function makeOutcome(overrides: Partial<FibSetupOutcome> = {}): FibSetupOutcome {
	return {
		entered: true,
		entryIndex: 1,
		entryPrice: 100,
		stopPrice: 90,
		riskSize: 10,
		direction: 'long',
		...overrides,
	} as FibSetupOutcome
}

const TP = 120

test('touch: чистый вин — вход maker, тейк на 100-м уровне', () => {
	const candles = [
		candle(101, 105),
		candle(99, 103),   // касание уровня 100
		candle(101, 121),  // тейк 120
	]
	const r = replayEntryModel(candles, makeOutcome(), TP, 'touch')
	assert.equal(r.status, 'entered')
	const expected = (120 - 100) / 10
		- (100 * BINGX_MAKER_RATE) / 10  // вход лимиткой — maker, без слипа
		- (120 * BINGX_MAKER_RATE) / 10  // тейк лимиткой — maker
	assert.ok(Math.abs(r.netR! - expected) < 1e-9, `netR ${r.netR} ≈ ${expected}`)
})

test('touch: same-bar вход+стоп = мгновенный лосс (консервативно)', () => {
	const candles = [
		candle(101, 105),
		candle(89, 103),   // бар касается 100 и пробивает стоп 90
		candle(101, 121),
	]
	const r = replayEntryModel(candles, makeOutcome(), TP, 'touch')
	assert.equal(r.status, 'entered')
	assert.ok(r.netR! < -0.99, `same-bar лосс ~−1R, got ${r.netR}`)
})

test('closeConfirm: same-bar пробой стопа = missed-stop (спасённый лосс)', () => {
	const candles = [
		candle(101, 105),
		candle(88, 103, 102, 89),  // касание 100, закрытие 89 — за стопом
		candle(101, 121),
	]
	const r = replayEntryModel(candles, makeOutcome(), TP, 'closeConfirm')
	assert.equal(r.status, 'missed-stop')
	assert.equal(r.netR, 0)
})

test('closeConfirm: вход по закрытию свечи касания, риск от фактической цены', () => {
	const candles = [
		candle(98, 104, 103, 102),  // касание 100, закрытие 102 — вход маркетом
		candle(101, 121),           // тейк 120
	]
	const outcome = makeOutcome({ entryIndex: 0 })
	const r = replayEntryModel(candles, outcome, TP, 'closeConfirm')
	assert.equal(r.status, 'entered')
	assert.equal(r.entryPrice, 102)
	const risk = 102 - 90 // риск пересчитан от фактического входа
	const expected = (120 - 102) / risk
		- (102 * (BINGX_TAKER_RATE + BINGX_SLIP_RATE)) / risk  // маркет-вход
		- (120 * BINGX_MAKER_RATE) / risk                       // лимитный тейк
	assert.ok(Math.abs(r.netR! - expected) < 1e-9, `netR ${r.netR} ≈ ${expected}`)
})

test('closeConfirm: стоп проверяется только со следующего бара после входа', () => {
	const candles = [
		candle(98, 104, 103, 102),  // вход по закрытию 102
		candle(89, 101),            // стоп 90 пробит следующим баром
	]
	const r = replayEntryModel(candles, makeOutcome({ entryIndex: 0 }), TP, 'closeConfirm')
	assert.equal(r.status, 'entered')
	assert.ok(r.netR! < -0.9, `лосс ~−1R от фактического риска, got ${r.netR}`)
})

test('candleConfirm: свеча касания бычья — подтверждает сама себя', () => {
	const candles = [
		candle(98, 104, 99, 103),  // касание 100, close 103 > open 99 — бычья
		candle(102, 121),          // тейк
	]
	const r = replayEntryModel(candles, makeOutcome({ entryIndex: 0 }), TP, 'candleConfirm')
	assert.equal(r.status, 'entered')
	assert.equal(r.entryPrice, 103)
})

test('candleConfirm: медвежьи свечи пропускаются, вход по первой бычьей', () => {
	const candles = [
		candle(98, 104, 103, 99),   // касание, медвежья — ждём
		candle(97, 101, 100, 98),   // медвежья — ждём
		candle(97, 103, 98, 102),   // бычья — вход по 102
		candle(101, 121),           // тейк
	]
	const r = replayEntryModel(candles, makeOutcome({ entryIndex: 0 }), TP, 'candleConfirm')
	assert.equal(r.status, 'entered')
	assert.equal(r.entryPrice, 102)
})

test('candleConfirm: тейк дошли без нас = missed-tp (упущенный вин)', () => {
	const candles = [
		candle(98, 104, 103, 99),   // касание, медвежья — ждём
		candle(99, 121, 100, 119),  // цена дошла до тейка 120 до подтверждения
	]
	const r = replayEntryModel(candles, makeOutcome({ entryIndex: 0 }), TP, 'candleConfirm')
	assert.equal(r.status, 'missed-tp')
})

test('candleConfirm: закрытие за стопом до подтверждения = missed-stop', () => {
	const candles = [
		candle(98, 104, 103, 99),   // касание, медвежья
		candle(88, 100, 99, 89),    // закрытие 89 за стопом 90
		candle(101, 121),
	]
	const r = replayEntryModel(candles, makeOutcome({ entryIndex: 0 }), TP, 'candleConfirm')
	assert.equal(r.status, 'missed-stop')
})

test('candleConfirm: нет подтверждения за CONFIRM_MAX_BARS = missed-expired', () => {
	const candles: Candle[] = [candle(98, 104, 103, 99)] // касание, медвежья
	for (let i = 0; i < CONFIRM_MAX_BARS + 2; i++) {
		candles.push(candle(95, 99, 98, 96)) // все медвежьи, стоп не задет
	}
	const r = replayEntryModel(candles, makeOutcome({ entryIndex: 0 }), TP, 'candleConfirm')
	assert.equal(r.status, 'missed-expired')
})

test('шорт: подтверждающая свеча — медвежья', () => {
	const candles = [
		candle(96, 102, 97, 101),  // касание 100 снизу вверх, бычья — НЕ подтверждает шорт
		candle(94, 100, 99, 95),   // медвежья — вход по 95
		candle(79, 96),            // тейк 80
	]
	const outcome = makeOutcome({ entryIndex: 0, direction: 'short', stopPrice: 110 })
	const r = replayEntryModel(candles, outcome, 80, 'candleConfirm')
	assert.equal(r.status, 'entered')
	assert.equal(r.entryPrice, 95)
})

test('bigbar: тело перекрыло зону — true, тени не считаются', () => {
	const candles = [
		candle(50, 90, 60, 80),    // тело 60–80: зону 65–75 перекрывает
		candle(50, 90, 68, 72),    // тело 68–72: НЕ перекрывает (только тени)
	]
	assert.equal(bigbarCovered(candles, 0, 1, 65, 75), true)
	assert.equal(bigbarCovered(candles, 1, 2, 65, 75), false)
})

test('bigbar: бар касания не включается (toIndexExclusive)', () => {
	const candles = [
		candle(70, 76, 71, 75),    // не перекрывает
		candle(50, 90, 60, 80),    // перекрыл бы, но это бар касания
	]
	assert.equal(bigbarCovered(candles, 0, 1, 65, 75), false)
})
