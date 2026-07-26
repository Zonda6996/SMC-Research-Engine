import assert from 'node:assert/strict'
import { it } from 'node:test'
import { liquidityPoiProfileForTf } from '../tools/shared/poiProfiles.js'
import { LIQUIDITY_POI_CONFIG } from '../src/core/confirmation/LiquidityPoiCalibration.js'

it('§16.21: per-TF профили зон — 1h локальный (этажи ≤2%), 1d свинг (консолидация), 4h = дефолты движка', () => {
	assert.deepEqual(liquidityPoiProfileForTf(14_400_000), {}) // 4h — канон §16.13–§16.16 не трогается
	const h1 = liquidityPoiProfileForTf(3_600_000)
	assert.equal(h1.stackMaxPct, 0.02)
	assert.equal(h1.shelfValleyShare, 0.4)
	assert.equal(h1.shelfValleyMinBins, 2)
	const d1 = liquidityPoiProfileForTf(86_400_000)
	assert.equal(d1.shelfValleyShare, 0.15)
	assert.equal(d1.shelfMinShare, 0.12)
	assert.equal(d1.shelfTopN, 3)
	// профили — Partial поверх дефолтов: ключи существуют в конфиге движка
	for (const k of [...Object.keys(h1), ...Object.keys(d1)]) assert.ok(k in LIQUIDITY_POI_CONFIG, k)
	// дефолты движка не менялись профилями
	assert.equal(LIQUIDITY_POI_CONFIG.stackMaxPct, 0.08)
	assert.equal(LIQUIDITY_POI_CONFIG.shelfValleyShare, 0.25)
})
