// dedupFilter.test.ts — волна 3 (SPEC 7.16): три правила дедупликации.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDedup, maxConcurrentTrades } from '../src/core/analysis/dedupFilter.js'
import type { FibSetupOutcome } from '../src/models/fib/FibLifecycle.js'

/** Минимальный исход: создан на created, вошёл на entry, разрешился на end. */
function mk(over: Partial<FibSetupOutcome>): FibSetupOutcome {
	return {
		candidateId: 'c' + Math.random(),
		variantMode: 'local',
		scenario: 'deep',
		stopMode: 'zero',
		trigger: 'bos',
		direction: 'long',
		legAtrRatio: null,
		oppositeSweptBefore: false,
		createdAtIndex: 0,
		entered: true,
		entryIndex: 10,
		entryPrice: 100,
		stopPrice: 90,
		riskSize: 10,
		state: 'stopped',
		tp1Hit: false,
		tp1Index: null,
		tp2Hit: false,
		tp2Index: null,
		stopIndex: 20,
		rTp1: null,
		rTp2: null,
		rStop: -1,
		exposure: 1,
		beAfterTp1: null,
		mfeR: null,
		maeR: null,
		maxExtensionRatio: null,
		tpAfterStop: null,
		barsToEntry: null,
		barsToResolve: null,
		...over,
	} as FibSetupOutcome
}

// Серия «BOS как собаки»: три сетапа одного направления, второй и третий
// созданы, пока сделка первого ещё открыта (вход 10, стоп 20).
const series = [
	mk({ createdAtIndex: 0, entryIndex: 10, stopIndex: 20 }),
	mk({ createdAtIndex: 12, entryIndex: 15, stopIndex: 25, state: 'stopped' }),
	mk({ createdAtIndex: 18, entryIndex: 30, stopIndex: 40, state: 'stopped' }),
]

test('cooldown: сетапы, созданные во время открытой сделки, отброшены', () => {
	const kept = applyDedup(series, 'cooldown')
	// #2 создан на 12 (сделка #1 жива до 20) — отброшен.
	// #3 создан на 18 — тоже внутри сделки #1 — отброшен.
	assert.equal(kept.length, 1)
	assert.equal(kept[0]?.createdAtIndex, 0)
})

test('one-position: блок по входу, а не по созданию', () => {
	const kept = applyDedup(series, 'one-position')
	// #2 входит на 15 (сделка #1 занята до 20) — отброшен.
	// #3 входит на 30 (всё разрешилось) — взят.
	assert.equal(kept.length, 2)
	assert.deepEqual(kept.map((o) => o.createdAtIndex), [0, 18])
})

test('latest-only: новая сетка отменяет невошедшую старую', () => {
	const late = [
		mk({ createdAtIndex: 0, entryIndex: 30, stopIndex: 40 }), // вошёл ПОСЛЕ появления новой сетки
		mk({ createdAtIndex: 12, entryIndex: 15, stopIndex: 25 }),
	]
	const kept = applyDedup(late, 'latest-only')
	// #1 ещё не вошёл, когда на 12 появился #2 — #1 отменён.
	assert.equal(kept.length, 1)
	assert.equal(kept[0]?.createdAtIndex, 12)
})

test('latest-only: вошедшая сделка доводится до конца', () => {
	const kept = applyDedup(series, 'latest-only')
	// #1 вошёл на 10, новая сетка появилась на 12 — сделка уже открыта, не трогаем.
	assert.equal(kept.length, 3)
})

test('направления и сценарии не пересекаются', () => {
	const mixed = [
		mk({ createdAtIndex: 0, entryIndex: 10, stopIndex: 20, direction: 'long' }),
		mk({ createdAtIndex: 12, entryIndex: 15, stopIndex: 25, direction: 'short' }),
		mk({ createdAtIndex: 12, entryIndex: 15, stopIndex: 25, scenario: 'ote' }),
	]
	assert.equal(applyDedup(mixed, 'cooldown').length, 3)
})

test('невошедшие сетапы всегда сохраняются', () => {
	const withNoEntry = [
		mk({ createdAtIndex: 0, entryIndex: 10, stopIndex: 20 }),
		mk({ createdAtIndex: 12, entered: false, entryIndex: null, state: 'no-entry', stopIndex: null }),
	]
	assert.equal(applyDedup(withNoEntry, 'cooldown').length, 2)
})

test('open-сделка блокирует до конца данных', () => {
	const withOpen = [
		mk({ createdAtIndex: 0, entryIndex: 10, state: 'open', stopIndex: null }),
		mk({ createdAtIndex: 100, entryIndex: 110, stopIndex: 120 }),
	]
	assert.equal(applyDedup(withOpen, 'cooldown').length, 1)
})

test('maxConcurrentTrades считает пересечения внутри группы', () => {
	assert.equal(maxConcurrentTrades(series), 2) // сделки [10,20] и [15,25]
	assert.equal(maxConcurrentTrades(applyDedup(series, 'one-position')), 1)
})
