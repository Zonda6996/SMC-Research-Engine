// battleConfig.test.ts
//
// Инварианты боевого конфига: геометрия сетапов согласована (стоп/тейк
// по правильные стороны от входа в ratio-пространстве) и сайзинг-стек
// возвращает утверждённые множители SPEC 7.35.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BATTLE_CONFIG, RESEARCH_CONFIG, canonRiskMultiplier, gridLevelPrice } from '../src/strategy/battleConfig.js'

describe('BATTLE_CONFIG geometry', () => {
	it('canon: stop below entry below take (trend direction, ratio space)', () => {
		for (const s of BATTLE_CONFIG.canon) {
			assert.ok(s.stop < s.entry, `${s.scenario}: stop ${s.stop} < entry ${s.entry}`)
			assert.ok(s.take > s.entry, `${s.scenario}: take ${s.take} > entry ${s.entry}`)
		}
	})

	it('executable cells, first-5 and cost gate match SPEC 7.53', () => {
		const deep = BATTLE_CONFIG.canon.find((s) => s.scenario === 'deep')!
		const ote = BATTLE_CONFIG.canon.find((s) => s.scenario === 'ote')!
		assert.deepEqual([deep.entry, deep.stop, deep.take], [38.2, 15, 61.8])
		assert.deepEqual([ote.entry, ote.stop, ote.take], [78.6, 61.8, 100])
		assert.equal(ote.timeStopBars, 20)
		assert.equal(deep.timeStopBars, null)
		assert.equal(BATTLE_CONFIG.reverse.length, 0)
		assert.deepEqual(BATTLE_CONFIG.entryGate, { timeframe: '5m', skipFirstBars: 1, cancelOnSkippedTouch: true })
		assert.equal(BATTLE_CONFIG.bigbarFilter, false)
		assert.equal(BATTLE_CONFIG.bigbarDiagnostic, true)
		assert.deepEqual(BATTLE_CONFIG.executionCostGate, { enabled: true, maxFullStopLossR: 1.75 })
		assert.deepEqual(BATTLE_CONFIG.benchmarks, { deep: 0.253, ote: 0.209 })
		assert.deepEqual(RESEARCH_CONFIG.mirrorProbe, { entry: 100, stop: 120, take: 78.6, cancelBeyond: 0 })
	})
})

describe('canonRiskMultiplier (SPEC 7.35)', () => {
	it('best cell: fresh x compact = 2.8', () => {
		assert.ok(Math.abs(canonRiskMultiplier(2, 1.0, 1.5) - 2.8) < 1e-9)
	})

	it('worst cell: stale x wide = 0.35', () => {
		assert.ok(Math.abs(canonRiskMultiplier(30, 2.0, 1.5) - 0.35) < 1e-9)
	})

	it('missing swing data skips the layer (neutral 1.0)', () => {
		assert.equal(canonRiskMultiplier(10, null, null), 1.0)
	})

	it('session layer disabled by default', () => {
		assert.equal(canonRiskMultiplier(10, null, null, 17), 1.0)
	})
})

describe('gridLevelPrice', () => {
	it('maps ratio to price for long grid', () => {
		assert.equal(gridLevelPrice(100, 200, 0), 100)
		assert.equal(gridLevelPrice(100, 200, 100), 200)
		assert.equal(gridLevelPrice(100, 200, 141), 241)
		assert.ok(Math.abs(gridLevelPrice(100, 200, 61.8) - 161.8) < 1e-9)
	})

	it('maps ratio to price for short grid (p0 above p100)', () => {
		assert.equal(gridLevelPrice(200, 100, 141), 59)
	})
})
