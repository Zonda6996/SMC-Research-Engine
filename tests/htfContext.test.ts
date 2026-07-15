// htfContext.test.ts — SPEC 7.21: HTF-контекст (тренд + premium/discount).
//
// Главный инвариант — отсутствие look-ahead: HTF-состояние становится
// известным строго с момента закрытия подтверждающей HTF-свечи, не раньше.

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHtfContext, htfContextAt } from '../src/core/analysis/htfContext.js'
import type { AnalysisSnapshot } from '../src/models/analysis/AnalysisSnapshot.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'
import type { TrendHistoryEntry } from '../src/models/structure/TrendHistoryEntry.js'

const HTF_MS = 3_600_000 // 1h

function makeCandles(count: number): Candle[] {
	return Array.from({ length: count }, (_, i) => ({
		timestamp: i * HTF_MS,
		open: 100, high: 110, low: 90, close: 105, volume: 1,
	}))
}

function point(index: number, type: 'high' | 'low', price: number, label: StructurePoint['label'] = 'UNKNOWN'): StructurePoint {
	return { index, timestamp: index * HTF_MS, price, type, label }
}

function trendEntry(index: number, trend: TrendHistoryEntry['trend'], confirmedAtIndex: number): TrendHistoryEntry {
	return { index, label: 'HH', trend, confirmedAtIndex }
}

/** Минимальный снапшот: buildHtfContext читает только candles, structure, market.trendHistory. */
function makeSnapshot(candles: Candle[], structure: StructurePoint[], trendHistory: TrendHistoryEntry[]): AnalysisSnapshot {
	return { candles, structure, market: { trendHistory } } as unknown as AnalysisSnapshot
}

// ---------------------------------------------------------------------------
// Таймлайн тренда: look-ahead-free датировка

test('тренд не известен до закрытия подтверждающей HTF-свечи', () => {
	const candles = makeCandles(20)
	const snapshot = makeSnapshot(candles, [], [trendEntry(5, 'bullish', 7)])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	// Свеча 7 закрывается в ts = 7*HTF + HTF = 8*HTF.
	const closeTs = 8 * HTF_MS
	assert.equal(htfContextAt(ctx, closeTs - 1, 100, 'long').htfTrend, 'none')
	assert.equal(htfContextAt(ctx, closeTs, 100, 'long').htfTrend, 'bullish')
})

test('запись, подтверждающаяся за пределами данных, не известна никогда', () => {
	const candles = makeCandles(10)
	const snapshot = makeSnapshot(candles, [], [trendEntry(8, 'bearish', 15)])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	assert.equal(ctx.trendTimeline.length, 0)
})

test('берётся последняя известная запись тренда, а не первая', () => {
	const candles = makeCandles(30)
	const snapshot = makeSnapshot(candles, [], [
		trendEntry(3, 'bullish', 5),
		trendEntry(10, 'bearish', 12),
	])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	assert.equal(htfContextAt(ctx, 10 * HTF_MS, 100, 'long').htfTrend, 'bullish')
	assert.equal(htfContextAt(ctx, 20 * HTF_MS, 100, 'long').htfTrend, 'bearish')
})

// ---------------------------------------------------------------------------
// trendAligned

test('trendAligned: long по bullish = true, short по bullish = false', () => {
	const candles = makeCandles(20)
	const snapshot = makeSnapshot(candles, [], [trendEntry(5, 'bullish', 7)])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	const ts = 10 * HTF_MS
	assert.equal(htfContextAt(ctx, ts, 100, 'long').trendAligned, true)
	assert.equal(htfContextAt(ctx, ts, 100, 'short').trendAligned, false)
})

test('trendAligned: range и none дают null, а не false', () => {
	const candles = makeCandles(20)
	const withRange = buildHtfContext(makeSnapshot(candles, [], [trendEntry(5, 'range', 7)]), HTF_MS)
	assert.equal(htfContextAt(withRange, 10 * HTF_MS, 100, 'long').trendAligned, null)
	const empty = buildHtfContext(makeSnapshot(candles, [], []), HTF_MS)
	assert.equal(htfContextAt(empty, 10 * HTF_MS, 100, 'long').trendAligned, null)
})

// ---------------------------------------------------------------------------
// Dealing range и premium/discount

test('P/D: цена ниже equilibrium = discount, выше = premium', () => {
	const candles = makeCandles(20)
	// Свинги: low 100 (индекс 2, подтверждён 4), high 200 (индекс 5, подтверждён 7).
	const snapshot = makeSnapshot(candles, [point(2, 'low', 100), point(5, 'high', 200)], [])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	const ts = 10 * HTF_MS // диапазон известен с закрытия свечи 7 = 8*HTF
	assert.equal(htfContextAt(ctx, ts, 120, 'long').pdZone, 'discount')
	assert.equal(htfContextAt(ctx, ts, 180, 'long').pdZone, 'premium')
	assert.equal(htfContextAt(ctx, ts, 150, 'long').pdZone, 'discount') // равенство = discount
})

test('P/D: диапазон не известен, пока не подтверждены ОБА свинга', () => {
	const candles = makeCandles(20)
	const snapshot = makeSnapshot(candles, [point(2, 'low', 100), point(5, 'high', 200)], [])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	// high подтверждается на свече 7 (закрытие 8*HTF); до этого — none.
	assert.equal(htfContextAt(ctx, 7 * HTF_MS, 120, 'long').pdZone, 'none')
	assert.equal(htfContextAt(ctx, 8 * HTF_MS, 120, 'long').pdZone, 'discount')
})

test('P/D: новый подтверждённый свинг обновляет диапазон', () => {
	const candles = makeCandles(30)
	const snapshot = makeSnapshot(candles, [
		point(2, 'low', 100), point(5, 'high', 200),
		point(10, 'low', 150), // диапазон становится 150..200, eq = 175
	], [])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	assert.equal(htfContextAt(ctx, 10 * HTF_MS, 160, 'long').pdZone, 'premium') // старый eq=150
	assert.equal(htfContextAt(ctx, 20 * HTF_MS, 160, 'long').pdZone, 'discount') // новый eq=175
})

test('P/D: вырожденный диапазон (high <= low) пропускается', () => {
	const candles = makeCandles(20)
	const snapshot = makeSnapshot(candles, [point(2, 'high', 100), point(5, 'low', 150)], [])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	assert.equal(ctx.rangeTimeline.length, 0)
})

test('pdAligned: long+discount = true, long+premium = false, none = null', () => {
	const candles = makeCandles(20)
	const snapshot = makeSnapshot(candles, [point(2, 'low', 100), point(5, 'high', 200)], [])
	const ctx = buildHtfContext(snapshot, HTF_MS)
	const ts = 10 * HTF_MS
	assert.equal(htfContextAt(ctx, ts, 120, 'long').pdAligned, true)
	assert.equal(htfContextAt(ctx, ts, 180, 'long').pdAligned, false)
	assert.equal(htfContextAt(ctx, ts, 180, 'short').pdAligned, true)
	assert.equal(htfContextAt(ctx, ts, 120, 'short').pdAligned, false)
	assert.equal(htfContextAt(ctx, 0, 120, 'long').pdAligned, null)
})
