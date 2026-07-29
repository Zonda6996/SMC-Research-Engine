import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import {
	APEX_PARAMS, APEX_VERSION, REVERSAL_VERSION,
	apexStateAt, computeApexBands, detectReversals,
} from '../src/core/signals/ApexEngine.js'

const bar = (ts: number, o: number, h: number, l: number, c: number): Candle =>
	({ timestamp: ts, open: o, high: h, low: l, close: c, volume: 10 })

it('Apex: калиброванные параметры зафиксированы', () => {
	assert.equal(APEX_VERSION, 'apex-1.1-tv-settings')
	assert.equal(REVERSAL_VERSION, 'reversal-1.0-directional-candle')
	assert.equal(APEX_PARAMS.source, 'hlc3')
	assert.equal(APEX_PARAMS.lookback, 200)
	assert.equal(APEX_PARAMS.kInner, 5.6)
	assert.equal(APEX_PARAMS.kOuter, 9.6)
	assert.equal(APEX_PARAMS.meanOffset, 0.85)
	assert.equal(APEX_PARAMS.meanSigma, 6)
	assert.equal(APEX_PARAMS.devLookback, 122)
	assert.equal(APEX_PARAMS.devOffset, 0.625)
	assert.equal(APEX_PARAMS.devSigma, 3.5)
})

it('Apex: источник средней — hlc3, средняя ALMA сохраняет константу', () => {
	const c = Array.from({ length: 60 }, (_, i) => bar(i, 100, 110, 100, 100))
	const b = computeApexBands(c, { lookback: 10, devLookback: 10 })
	assert.ok(Math.abs(b.at(-1)!.mean - 103.3333333) < 1e-6)
})

it('Apex: полосы логарифмически симметричны', () => {
	const c: Candle[] = []
	for (let i = 0; i < 100; i++) {
		const p = 100 + Math.sin(i / 4)
		c.push(bar(i, p, p + 1, p - 1, p))
	}
	const b = computeApexBands(c, { lookback: 20, devLookback: 20 }).at(-1)!
	assert.ok(Number.isFinite(b.mean) && b.s > 0)
	assert.ok(Math.abs(Math.log(b.redLo / b.mean) - 5.6 * b.s) < 1e-12)
	assert.ok(Math.abs(Math.log(b.mean / b.greenHi) - 5.6 * b.s) < 1e-12)
	assert.ok(Math.abs(Math.log(b.redHi / b.mean) - 9.6 * b.s) < 1e-12)
	assert.ok(Math.abs(Math.log(b.mean / b.greenLo) - 9.6 * b.s) < 1e-12)
	assert.ok(b.greenLo < b.greenHi && b.greenHi < b.mean)
	assert.ok(b.mean < b.redLo && b.redLo < b.redHi)
})

it('Reversal: BUY не может появиться на медвежьей свече', () => {
	const p = { lookback: 10, devLookback: 10, kInner: 0.1, kOuter: 0.2 } as const
	const c = Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100))
	// Медвежья свеча касается нижнего края: только взводит ожидание.
	c.push(bar(30, 100, 100, 90, 91))
	let s = detectReversals(c, p).filter(x => x.at >= 30)
	assert.equal(s.filter(x => x.direction === 'long').length, 0)
	// Следующая бычья свеча подтверждает BUY.
	c.push(bar(31, 91, 94, 90, 93))
	s = detectReversals(c, p).filter(x => x.at >= 30)
	assert.equal(s.filter(x => x.direction === 'long').length, 1)
	assert.equal(s.find(x => x.direction === 'long')!.at, 31)
})

it('Reversal: SELL не может появиться на бычьей свече', () => {
	const p = { lookback: 10, devLookback: 10, kInner: 0.1, kOuter: 0.2 } as const
	const c = Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100))
	c.push(bar(30, 100, 110, 100, 109))
	let s = detectReversals(c, p).filter(x => x.at >= 30)
	assert.equal(s.filter(x => x.direction === 'short').length, 0)
	c.push(bar(31, 109, 110, 106, 107))
	s = detectReversals(c, p).filter(x => x.at >= 30)
	assert.equal(s.filter(x => x.direction === 'short').length, 1)
	assert.equal(s.find(x => x.direction === 'short')!.at, 31)
})

it('Apex: состояние определяется по внутренним краям', () => {
	const b = { mean: 100, s: 0.01, redLo: 105.6, redHi: 109.6, greenHi: 94.4, greenLo: 90.4 }
	assert.equal(apexStateAt(bar(0, 100, 101, 94, 95), b), 'oversold')
	assert.equal(apexStateAt(bar(0, 100, 106, 99, 105), b), 'overbought')
	assert.equal(apexStateAt(bar(0, 100, 101, 99, 100), b), 'neutral')
})
