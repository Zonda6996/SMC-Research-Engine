import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityPoi, LIQUIDITY_POI_VERSION } from '../src/core/confirmation/LiquidityPoiCalibration.js'

it('liquidity POI calibration has a frozen non-trading version',()=>{
 assert.equal(LIQUIDITY_POI_VERSION,'liquidity-poi-0.4-structural-hierarchy')
 assert.deepEqual(detectLiquidityPoi([]),[])
})
