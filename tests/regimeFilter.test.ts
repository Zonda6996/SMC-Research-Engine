// Тесты волны 2 фильтра режима (SPEC 7.15): пороговая логика,
// асимметрия по сценариям, консервативность при отсутствии данных.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { passesRegimeFilter, DEFAULT_REGIME_FILTER } from '../src/core/analysis/regimeFilter.js'
import type { RegimeMetrics } from '../src/core/analysis/regimeMetrics.js'

const good: RegimeMetrics = { effRatio: 0.3, atrRatio: 1.2, chochShare: 0.25, trendStability: 0.9 }
const squeezed: RegimeMetrics = { effRatio: 0.3, atrRatio: 0.8, chochShare: 0.25, trendStability: 0.9 }
const choppy: RegimeMetrics = { effRatio: 0.3, atrRatio: 1.2, chochShare: 0.625, trendStability: 0.5 }

test('deep в хорошем режиме проходит', () => {
	assert.equal(passesRegimeFilter('deep', good), true)
})

test('deep при сжатой волатильности блокируется', () => {
	assert.equal(passesRegimeFilter('deep', squeezed), false)
})

test('deep при пиле направлений (chochShare >= 0.5) блокируется', () => {
	assert.equal(passesRegimeFilter('deep', choppy), false)
})

test('ote фильтруется так же, как deep', () => {
	assert.equal(passesRegimeFilter('ote', squeezed), false)
	assert.equal(passesRegimeFilter('ote', good), true)
})

test('breaker НЕ фильтруется даже в худшем режиме', () => {
	const worst: RegimeMetrics = { effRatio: 0.01, atrRatio: 0.5, chochShare: 1, trendStability: 0.5 }
	assert.equal(passesRegimeFilter('breaker', worst), true)
	assert.equal(passesRegimeFilter('breaker161', worst), true)
})

test('граница atrRatio: ровно на пороге проходит, ниже — нет', () => {
	const onEdge: RegimeMetrics = { ...good, atrRatio: DEFAULT_REGIME_FILTER.minAtrRatio }
	const below: RegimeMetrics = { ...good, atrRatio: DEFAULT_REGIME_FILTER.minAtrRatio - 0.001 }
	assert.equal(passesRegimeFilter('deep', onEdge), true)
	assert.equal(passesRegimeFilter('deep', below), false)
})

test('граница chochShare: ровно на пороге блокируется (>=)', () => {
	const onEdge: RegimeMetrics = { ...good, chochShare: DEFAULT_REGIME_FILTER.maxChochShare }
	assert.equal(passesRegimeFilter('deep', onEdge), false)
})

test('null-метрики не блокируют (окно не набралось — не доказательство)', () => {
	const empty: RegimeMetrics = { effRatio: null, atrRatio: null, chochShare: null, trendStability: null }
	assert.equal(passesRegimeFilter('deep', empty), true)
	assert.equal(passesRegimeFilter('deep', undefined), true)
})

test('частичные метрики: блокирует любая доступная плохая', () => {
	const onlyBadAtr: RegimeMetrics = { effRatio: null, atrRatio: 0.7, chochShare: null, trendStability: null }
	const onlyBadChoch: RegimeMetrics = { effRatio: null, atrRatio: null, chochShare: 0.75, trendStability: null }
	assert.equal(passesRegimeFilter('deep', onlyBadAtr), false)
	assert.equal(passesRegimeFilter('deep', onlyBadChoch), false)
})
