import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { detectReversals } from '../src/core/signals/ApexEngine.js'

const bar = (timestamp: number, open: number, high: number, low: number, close: number): Candle =>
	({ timestamp, open, high, low, close, volume: 1 })

it('Reversal: повторный BUY запрещён до возврата закрытия к средней', () => {
	const p = { lookback: 10, devLookback: 10, kInner: 0.1, kOuter: 0.2 } as const
	const candles: Candle[] = Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100))
	// Первое касание и подтверждение.
	candles.push(bar(30, 100, 100, 90, 91))
	candles.push(bar(31, 91, 94, 90, 93))
	// Ещё одно касание и бычья свеча ниже средней — повторного сигнала быть не должно.
	candles.push(bar(32, 93, 94, 89, 90))
	candles.push(bar(33, 90, 94, 89, 93))
	let buys = detectReversals(candles, p).filter(x => x.at >= 30 && x.direction === 'long')
	assert.equal(buys.length, 1)
	// Возврат к средней перевзводит сторону; следующее касание снова может дать BUY.
	candles.push(bar(34, 93, 102, 92, 101))
	candles.push(bar(35, 101, 102, 89, 90))
	candles.push(bar(36, 90, 94, 89, 93))
	buys = detectReversals(candles, p).filter(x => x.at >= 30 && x.direction === 'long')
	assert.equal(buys.length, 2)
})
