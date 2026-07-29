import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { APEX_VERSION, computeApexBands } from '../src/core/signals/ApexEngine.js'
import { GGI_ZONE_ENGINE_VERSION, computeGgiBands } from '../src/core/signals/GgiZoneEngine.js'

it('Apex: временный мост старых импортов ведёт на новый движок без расхождений', () => {
	const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
		timestamp: i,
		open: 100 + Math.sin(i),
		high: 102 + Math.sin(i),
		low: 98 + Math.sin(i),
		close: 100 + Math.cos(i),
		volume: 1,
	}))
	const params = { lookback: 10, devLookback: 10 }
	assert.equal(GGI_ZONE_ENGINE_VERSION, APEX_VERSION)
	assert.deepEqual(computeGgiBands(candles, params), computeApexBands(candles, params))
})
