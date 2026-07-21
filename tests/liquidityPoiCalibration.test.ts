import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityPoi, LIQUIDITY_POI_VERSION } from '../src/core/confirmation/LiquidityPoiCalibration.js'

it('liquidity POI calibration has a frozen non-trading version',()=>{
 assert.equal(LIQUIDITY_POI_VERSION,'liquidity-poi-0.5.1-structural-lifecycle')
 assert.deepEqual(detectLiquidityPoi([]),[])
})
