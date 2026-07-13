// regimeMetrics.test.ts
//
// Тесты метрик режима рынка (SPEC 7.15, волна 1) на синтетике:
// - effRatio: прямолинейный тренд ≈ 1, пила ≈ 0;
// - atrRatio: сжатие диапазона <1, расширение >1;
// - chochShare / trendStability: подача синтетических событий и trend-записей;
// - look-ahead: значение на индексе i не зависит от данных с индексами > i.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeRegimeMetrics } from '@/core/analysis/regimeMetrics.js'
import type { Candle } from '@/models/price/Candle.js'
import type { ATRPoint } from '@/models/indicators/ATRPoint.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { TrendHistoryEntry } from '@/models/structure/TrendHistoryEntry.js'

const HOUR = 3_600_000

function candle(i: number, close: number, range = 1): Candle {
	return {
		timestamp: i * HOUR,
		open: close,
		high: close + range / 2,
		low: close - range / 2,
		close,
		volume: 100,
	}
}

/** Прямолинейный тренд: close растёт на step каждый бар. */
function trendCandles(n: number, step = 10): Candle[] {
	return Array.from({ length: n }, (_, i) => candle(i, 1000 + i * step))
}

/** Пила: close чередуется 1000 / 1010. */
function chopCandles(n: number): Candle[] {
	return Array.from({ length: n }, (_, i) => candle(i, i % 2 === 0 ? 1000 : 1010))
}

function syntheticEvent(confirmIndex: number, type: 'bos' | 'choch'): StructureEvent {
	return {
		type,
		direction: 'up',
		levelPrice: 1000,
		levelType: 'high',
		levelIndex: confirmIndex - 2,
		levelLabel: 'HH',
		breachIndex: confirmIndex - 1,
		breachTimestamp: (confirmIndex - 1) * HOUR,
		confirmIndex,
		confirmTimestamp: confirmIndex * HOUR,
		sweptBefore: false,
		sweptDepth: 0,
		oppositeSweptBefore: false,
	}
}

function syntheticTrend(confirmedAtIndex: number, trend: TrendHistoryEntry['trend']): TrendHistoryEntry {
	return { index: confirmedAtIndex - 5, label: 'HH', trend, confirmedAtIndex }
}

describe('computeRegimeMetrics', () => {
	it('effRatio: прямолинейный тренд даёт ~1, пила даёт ~0', () => {
		const trendMetrics = computeRegimeMetrics(trendCandles(80), [], [], [], { effWindow: 50 })
		const chopMetrics = computeRegimeMetrics(chopCandles(80), [], [], [], { effWindow: 50 })

		const trendVal = trendMetrics[70]!.effRatio
		const chopVal = chopMetrics[70]!.effRatio
		assert.ok(trendVal != null && trendVal > 0.99, `trend effRatio ~1, got ${trendVal}`)
		// Пила за чётное окно: |close[i]−close[i−50]| = 0 или 10, шум = 50·10.
		assert.ok(chopVal != null && chopVal < 0.05, `chop effRatio ~0, got ${chopVal}`)
	})

	it('effRatio: null пока окно не набралось', () => {
		const metrics = computeRegimeMetrics(trendCandles(60), [], [], [], { effWindow: 50 })
		assert.equal(metrics[49]!.effRatio, null)
		assert.notEqual(metrics[50]!.effRatio, null)
	})

	it('atrRatio: сжатие волатильности <1, расширение >1', () => {
		const n = 60
		const candles = trendCandles(n)
		// ATR: первые 40 баров = 10, последние 20 = 2 (сжатие).
		const atrShrink: ATRPoint[] = Array.from({ length: n }, (_, i) => ({
			index: i,
			timestamp: i * HOUR,
			value: i < 40 ? 10 : 2,
		}))
		const shrink = computeRegimeMetrics(candles, atrShrink, [], [], { atrSmaWindow: 30 })
		const shrinkVal = shrink[n - 1]!.atrRatio
		assert.ok(shrinkVal != null && shrinkVal < 1, `сжатие → <1, got ${shrinkVal}`)

		// ATR: первые 40 = 2, последние 20 = 10 (расширение).
		const atrExpand: ATRPoint[] = Array.from({ length: n }, (_, i) => ({
			index: i,
			timestamp: i * HOUR,
			value: i < 40 ? 2 : 10,
		}))
		const expand = computeRegimeMetrics(candles, atrExpand, [], [], { atrSmaWindow: 30 })
		const expandVal = expand[n - 1]!.atrRatio
		assert.ok(expandVal != null && expandVal > 1, `расширение → >1, got ${expandVal}`)
	})

	it('atrRatio: null пока SMA-окно не покрыто реальными значениями ATR', () => {
		const n = 50
		const candles = trendCandles(n)
		// ATR начинается только с индекса 20 (разгон) — SMA(30) готова не раньше 49.
		const atr: ATRPoint[] = Array.from({ length: n - 20 }, (_, k) => ({
			index: k + 20,
			timestamp: (k + 20) * HOUR,
			value: 5,
		}))
		const metrics = computeRegimeMetrics(candles, atr, [], [], { atrSmaWindow: 30 })
		assert.equal(metrics[48]!.atrRatio, null)
		assert.notEqual(metrics[49]!.atrRatio, null)
	})

	it('chochShare: пила направлений даёт высокую долю, серия BOS — нулевую', () => {
		const candles = trendCandles(100)
		// 8 событий: все BOS → 0; половина CHoCH → 0.5.
		const allBos = Array.from({ length: 8 }, (_, k) => syntheticEvent(10 + k * 5, 'bos'))
		const half = Array.from({ length: 8 }, (_, k) =>
			syntheticEvent(10 + k * 5, k % 2 === 0 ? 'choch' : 'bos'),
		)
		const bosMetrics = computeRegimeMetrics(candles, [], allBos, [], { eventWindow: 8 })
		const halfMetrics = computeRegimeMetrics(candles, [], half, [], { eventWindow: 8 })
		assert.equal(bosMetrics[60]!.chochShare, 0)
		assert.equal(halfMetrics[60]!.chochShare, 0.5)
		// До того как набралось 8 событий — null (7-е подтверждается на 40-й свече).
		assert.equal(bosMetrics[42]!.chochShare, null)
	})

	it('trendStability: устойчивый тренд даёт 1, чехарда — 0.5', () => {
		const candles = trendCandles(100)
		const stable = Array.from({ length: 8 }, (_, k) => syntheticTrend(10 + k * 5, 'bullish'))
		const flip = Array.from({ length: 8 }, (_, k) =>
			syntheticTrend(10 + k * 5, k % 2 === 0 ? 'bullish' : 'bearish'),
		)
		const stableMetrics = computeRegimeMetrics(candles, [], [], stable, { trendWindow: 8 })
		const flipMetrics = computeRegimeMetrics(candles, [], [], flip, { trendWindow: 8 })
		assert.equal(stableMetrics[60]!.trendStability, 1)
		assert.equal(flipMetrics[60]!.trendStability, 0.5)
	})

	it('look-ahead: значение на индексе i не зависит от данных с индексами > i', () => {
		const probe = 60
		const fullCandles = [...trendCandles(70), ...chopCandles(30).map((c, k) => ({ ...c, timestamp: (70 + k) * HOUR }))]
		const cutCandles = fullCandles.slice(0, probe + 1)

		const fullAtr: ATRPoint[] = fullCandles.map((c, i) => ({ index: i, timestamp: c.timestamp, value: 5 + (i % 3) }))
		const cutAtr = fullAtr.slice(0, probe + 1)

		// События: часть подтверждается до probe, часть после.
		const fullEvents = Array.from({ length: 12 }, (_, k) => syntheticEvent(8 + k * 6, k % 3 === 0 ? 'choch' : 'bos'))
		const cutEvents = fullEvents.filter((e) => e.confirmIndex <= probe)

		const fullTrends = Array.from({ length: 12 }, (_, k) =>
			syntheticTrend(8 + k * 6, k % 2 === 0 ? 'bullish' : 'bearish'),
		)
		const cutTrends = fullTrends.filter((t) => t.confirmedAtIndex <= probe)

		const opts = { effWindow: 30, atrSmaWindow: 20, eventWindow: 6, trendWindow: 6 }
		const fullMetrics = computeRegimeMetrics(fullCandles, fullAtr, fullEvents, fullTrends, opts)
		const cutMetrics = computeRegimeMetrics(cutCandles, cutAtr, cutEvents, cutTrends, opts)

		assert.deepEqual(fullMetrics[probe], cutMetrics[probe])
	})
})
