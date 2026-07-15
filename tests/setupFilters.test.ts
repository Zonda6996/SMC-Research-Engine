// Тесты слоя дискреционных фильтров (SPEC 7.20): late / align / extreme / chop.
// Синтетические фикстуры; каждый фильтр проверяется на блок, пропуск,
// консервативность при отсутствии данных и отсутствие look-ahead.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	buildSetupFilterContext,
	firstFailingFilter,
	passesAlignFilter,
	passesChopFilter,
	passesChopOteFilter,
	passesExtremeFilter,
	passesLateFilter,
	DEFAULT_SETUP_FILTER_CONFIG,
	type SetupFilterContext,
} from '../src/core/analysis/setupFilters.js'
import { passesRegimeFilter, DEFAULT_REGIME_FILTER } from '../src/core/analysis/regimeFilter.js'
import { FibGridEngine } from '../src/core/fib/FibGridEngine.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import type { TrendHistoryEntry } from '../src/models/structure/TrendHistoryEntry.js'
import type { FibGridCandidate, FibVariant } from '../src/models/fib/FibGrid.js'
import type { FibSetupOutcome } from '../src/models/fib/FibLifecycle.js'
import type { RegimeMetrics } from '../src/core/analysis/regimeMetrics.js'
import type { Trend } from '../src/models/structure/MarketStructure.js'

// ---------------------------------------------------------------------------
// Фикстуры

function candle(i: number, close: number, high = close + 1, low = close - 1): Candle {
	return { timestamp: i * 60_000, open: close, high, low, close, volume: 1 }
}

/** 12 свечей вокруг уровня 110: хаи не выше 110, закрытия ~105. */
function makeCandles(): Candle[] {
	const candles: Candle[] = []
	for (let i = 0; i < 12; i++) candles.push(candle(i, 105, 109, 100))
	return candles
}

function makeEvent(overrides: Partial<StructureEvent> = {}): StructureEvent {
	return {
		type: 'bos',
		direction: 'up',
		levelPrice: 110,
		levelType: 'high',
		levelIndex: 5,
		levelLabel: 'HH',
		breachIndex: 8,
		breachTimestamp: 8 * 60_000,
		confirmIndex: 9,
		confirmTimestamp: 9 * 60_000,
		sweptBefore: false,
		sweptDepth: 0,
		oppositeSweptBefore: false,
		...overrides,
	}
}

/** Нога 100→110, ATR на пробое = 2 (legAtrRatio = 5). */
function makeVariant(): FibVariant {
	return {
		start: { index: 2, timestamp: 2 * 60_000, price: 100, type: 'low', label: 'HL', knownAtIndex: 4 },
		levels: [],
		legSize: 10,
		legAtrRatio: 5,
	}
}

function makeCandidate(event: StructureEvent): FibGridCandidate {
	return {
		id: 'cand-1',
		eventId: FibGridEngine.eventId(event),
		trigger: 'bos',
		direction: 'long',
		end: { index: event.levelIndex, timestamp: event.levelIndex * 60_000, price: event.levelPrice, type: 'high', label: 'HH', knownAtIndex: event.levelIndex + 2 },
		variants: { local: makeVariant(), global: null },
		createdAtIndex: event.confirmIndex,
		oppositeSweptBefore: false,
		explanation: 'test',
	}
}

function makeOutcome(overrides: Partial<FibSetupOutcome> = {}): FibSetupOutcome {
	return {
		candidateId: 'cand-1',
		variantMode: 'local',
		scenario: 'ote',
		stopMode: 'zero',
		trigger: 'bos',
		direction: 'long',
		legAtrRatio: 5,
		oppositeSweptBefore: false,
		createdAtIndex: 9,
		entered: true,
		entryIndex: 10,
		entryPrice: 106,
		stopPrice: 100,
		riskSize: 6,
		state: 'tp2',
		tp1Hit: true,
		tp1Index: 11,
		tp2Hit: true,
		tp2Index: 11,
		stopIndex: null,
		rTp1: 1.5,
		rTp2: 3,
		rStop: null,
		exposure: 1,
		runnerRetraced: false,
		...overrides,
	} as FibSetupOutcome
}

function trends(values: Trend[], startConfirmed = 0): TrendHistoryEntry[] {
	return values.map((trend, i) => ({
		index: startConfirmed + i,
		label: 'HH',
		trend,
		confirmedAtIndex: startConfirmed + i,
	}))
}

const goodMetrics: RegimeMetrics = { effRatio: 0.3, atrRatio: 1.2, chochShare: 0.25, trendStability: 0.9 }

function makeContext(overrides: {
	candles?: Candle[]
	event?: StructureEvent
	trendHistory?: TrendHistoryEntry[]
	metricsAt9?: RegimeMetrics
} = {}): SetupFilterContext {
	const candles = overrides.candles ?? makeCandles()
	const event = overrides.event ?? makeEvent()
	const candidate = makeCandidate(event)
	const metrics: RegimeMetrics[] = candles.map(() => goodMetrics)
	if (overrides.metricsAt9) metrics[9] = overrides.metricsAt9
	return buildSetupFilterContext(candles, [event], [candidate], overrides.trendHistory ?? [], metrics)
}

// ---------------------------------------------------------------------------
// late

test('late: умеренный перелёт (0.2 ноги) проходит', () => {
	const candles = makeCandles()
	candles[9] = candle(9, 112, 113, 105) // close 112, уровень 110, нога 10 → overshoot 0.2
	assert.equal(passesLateFilter(makeOutcome(), makeContext({ candles })), true)
})

test('late: перелёт дальше трети ноги блокируется', () => {
	const candles = makeCandles()
	candles[9] = candle(9, 115, 116, 105) // overshoot 0.5 > 0.35
	assert.equal(passesLateFilter(makeOutcome(), makeContext({ candles })), false)
})

test('late: short зеркален (закрытие глубоко ПОД уровнем — блок)', () => {
	const candles = makeCandles()
	candles[9] = candle(9, 105, 106, 104) // для short: (110 − 105) / 10 = 0.5 > 0.35
	assert.equal(passesLateFilter(makeOutcome({ direction: 'short' }), makeContext({ candles })), false)
})

test('late: неизвестный candidateId — консервативно проходит', () => {
	assert.equal(passesLateFilter(makeOutcome({ candidateId: 'missing' }), makeContext()), true)
})

// ---------------------------------------------------------------------------
// align

test('align: long против доминирующего bearish блокируется', () => {
	const ctx = makeContext({ trendHistory: trends(['bearish', 'bearish', 'bearish', 'bearish', 'bearish', 'bearish', 'bullish', 'bearish']) })
	assert.equal(passesAlignFilter(makeOutcome(), ctx), false)
})

test('align: long по доминирующему bullish проходит', () => {
	const ctx = makeContext({ trendHistory: trends(['bullish', 'bullish', 'bullish', 'bearish', 'bullish', 'bullish', 'bullish', 'bullish']) })
	assert.equal(passesAlignFilter(makeOutcome(), ctx), true)
})

test('align: доминанта range — консервативно проходит', () => {
	const ctx = makeContext({ trendHistory: trends(['range', 'range', 'range', 'range', 'range', 'bullish', 'range', 'range']) })
	assert.equal(passesAlignFilter(makeOutcome(), ctx), true)
})

test('align: недобор окна — консервативно проходит', () => {
	const ctx = makeContext({ trendHistory: trends(['bearish', 'bearish', 'bearish']) })
	assert.equal(passesAlignFilter(makeOutcome(), ctx), true)
})

test('align: look-ahead-free — будущие записи не учитываются', () => {
	// 8 bullish подтверждены к createdAtIndex=9, лавина bearish — после.
	const visible = trends(['bullish', 'bullish', 'bullish', 'bullish', 'bullish', 'bullish', 'bullish', 'bullish'])
	const future = trends(['bearish', 'bearish', 'bearish', 'bearish', 'bearish', 'bearish', 'bearish', 'bearish'], 50)
	const ctx = makeContext({ trendHistory: [...visible, ...future] })
	assert.equal(passesAlignFilter(makeOutcome(), ctx), true)
})

// ---------------------------------------------------------------------------
// extreme

test('extreme: уровень-экстремум сегмента проходит', () => {
	assert.equal(passesExtremeFilter(makeOutcome(), makeContext()), true)
})

test('extreme: более высокий хай в сегменте — блок (сломан внутренний пивот)', () => {
	const candles = makeCandles()
	candles[3] = candle(3, 105, 112, 100) // high 112 > 110 + tolerance(0.5)
	assert.equal(passesExtremeFilter(makeOutcome(), makeContext({ candles })), false)
})

test('extreme: равная вершина в пределах ATR-допуска проходит', () => {
	const candles = makeCandles()
	candles[3] = candle(3, 105, 110.4, 100) // 110.4 <= 110 + 0.25×ATR(2) = 110.5
	assert.equal(passesExtremeFilter(makeOutcome(), makeContext({ candles })), true)
})

test('extreme: зеркально для short (более низкий лоу в сегменте — блок)', () => {
	const candles = makeCandles()
	const event = makeEvent({ direction: 'down', levelType: 'low', levelPrice: 100 })
	candles[3] = candle(3, 105, 109, 98) // low 98 < 100 − 0.5
	const candidate = makeCandidate(event)
	const metrics: RegimeMetrics[] = candles.map(() => goodMetrics)
	const ctx = buildSetupFilterContext(candles, [event], [candidate], [], metrics)
	assert.equal(passesExtremeFilter(makeOutcome({ direction: 'short' }), ctx), false)
})

// ---------------------------------------------------------------------------
// chop

test('chop: хороший режим проходит', () => {
	assert.equal(passesChopFilter(makeOutcome(), makeContext()), true)
})

test('chop: низкий effRatio (пила по цене) блокируется', () => {
	const ctx = makeContext({ metricsAt9: { ...goodMetrics, effRatio: 0.1 } })
	assert.equal(passesChopFilter(makeOutcome(), ctx), false)
})

test('chop: низкий trendStability (чехарда трендов) блокируется', () => {
	const ctx = makeContext({ metricsAt9: { ...goodMetrics, trendStability: 0.4 } })
	assert.equal(passesChopFilter(makeOutcome(), ctx), false)
})

test('chop: строгий пресет применяется и к breaker (канонический сценарий портфеля)', () => {
	const ctx = makeContext({ metricsAt9: { ...goodMetrics, effRatio: 0.1 } })
	assert.equal(passesChopFilter(makeOutcome({ scenario: 'breaker' }), ctx), false)
})

// ---------------------------------------------------------------------------
// chop-ote (scoped: урок полноканонного OFAT — blanket-chop убивает deep)

test('chop-ote: плохой режим блокирует ote', () => {
	const ctx = makeContext({ metricsAt9: { ...goodMetrics, effRatio: 0.1 } })
	assert.equal(passesChopOteFilter(makeOutcome({ scenario: 'ote' }), ctx), false)
})

test('chop-ote: deep и breaker проходят даже в плохом режиме', () => {
	const ctx = makeContext({ metricsAt9: { ...goodMetrics, effRatio: 0.1, trendStability: 0.1 } })
	assert.equal(passesChopOteFilter(makeOutcome({ scenario: 'deep' }), ctx), true)
	assert.equal(passesChopOteFilter(makeOutcome({ scenario: 'breaker' }), ctx), true)
})

test('chop-ote: хороший режим пропускает ote', () => {
	assert.equal(passesChopOteFilter(makeOutcome({ scenario: 'ote' }), makeContext()), true)
})

test('baseline не изменился: DEFAULT_REGIME_FILTER игнорирует effRatio/trendStability', () => {
	const bad: RegimeMetrics = { effRatio: 0.05, atrRatio: 1.2, chochShare: 0.25, trendStability: 0.1 }
	assert.equal(passesRegimeFilter('ote', bad, DEFAULT_REGIME_FILTER), true)
})

// ---------------------------------------------------------------------------
// firstFailingFilter

test('firstFailingFilter: пустой список активных — всегда null (opt-in)', () => {
	const candles = makeCandles()
	candles[9] = candle(9, 115, 116, 105) // провалил бы late
	assert.equal(firstFailingFilter(makeOutcome(), [], makeContext({ candles })), null)
})

test('firstFailingFilter: возвращает первый сработавший в порядке списка', () => {
	const candles = makeCandles()
	candles[9] = candle(9, 115, 116, 105) // проваливает late
	const ctx = makeContext({ candles, metricsAt9: { ...goodMetrics, effRatio: 0.1 } }) // и chop
	assert.equal(firstFailingFilter(makeOutcome(), ['chop', 'late'], ctx), 'chop')
	assert.equal(firstFailingFilter(makeOutcome(), ['late', 'chop'], ctx), 'late')
})

test('firstFailingFilter: сетап, прошедший все фильтры — null', () => {
	const ctx = makeContext({ trendHistory: trends(['bullish', 'bullish', 'bullish', 'bullish', 'bullish', 'bullish', 'bullish', 'bullish']) })
	assert.equal(firstFailingFilter(makeOutcome(), ['late', 'align', 'extreme', 'chop'], ctx), null)
})

// ---------------------------------------------------------------------------
// Конфиг

test('дефолтный конфиг соответствует SPEC 7.20', () => {
	assert.equal(DEFAULT_SETUP_FILTER_CONFIG.lateMaxOvershoot, 0.35)
	assert.equal(DEFAULT_SETUP_FILTER_CONFIG.alignWindow, 8)
	assert.equal(DEFAULT_SETUP_FILTER_CONFIG.extremeAtrTolerance, 0.25)
	assert.equal(DEFAULT_SETUP_FILTER_CONFIG.chop.minEffRatio, 0.2)
	assert.equal(DEFAULT_SETUP_FILTER_CONFIG.chop.minTrendStability, 0.6)
})
