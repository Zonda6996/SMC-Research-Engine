import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { detectReversals } from '../src/core/signals/ApexEngine.js'

const bar = (timestamp: number, open: number, high: number, low: number, close: number): Candle =>
	({ timestamp, open, high, low, close, volume: 1 })

it('Reversal: повторный BUY запрещён до устойчивого возврата к средней', () => {
	const p = { lookback: 10, devLookback: 10, kInner: 0.1, kOuter: 0.2 } as const
	const candles: Candle[] = Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100))
	// Первое касание на медвежьей свече и подтверждение следующей бычьей.
	candles.push(bar(30, 100, 100, 90, 91))
	candles.push(bar(31, 91, 94, 90, 93))
	// Ещё одно касание и бычья свеча ниже средней: повторный BUY запрещён.
	candles.push(bar(32, 93, 94, 89, 90))
	candles.push(bar(33, 90, 94, 89, 93))
	let buys = detectReversals(candles, p).filter(x => x.at >= 30 && x.direction === 'long')
	assert.equal(buys.length, 1)
	// Серия далеко выше прежней средней гарантированно перевзводит long-сторону,
	// даже с учётом того, что ALMA сама движется за ценой.
	for (let i = 34; i < 54; i++) candles.push(bar(i, 119, 121, 118, 120))
	candles.push(bar(54, 120, 121, 80, 85))
	candles.push(bar(55, 85, 92, 82, 90))
	buys = detectReversals(candles, p).filter(x => x.at >= 30 && x.direction === 'long')
	assert.equal(buys.length, 2)
})
