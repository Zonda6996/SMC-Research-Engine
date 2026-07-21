import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityPoi, LIQUIDITY_POI_VERSION } from '../src/core/confirmation/LiquidityPoiCalibration.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'

it('liquidity POI calibration has a frozen non-trading version',()=>{
 assert.equal(LIQUIDITY_POI_VERSION,'liquidity-poi-0.5.2-history-boundary')
 assert.deepEqual(detectLiquidityPoi([]),[])
})

it('does not stretch the first structure event back to dataset start without a prior opposite event',()=>{
 const candles:Candle[]=Array.from({length:12},(_,i)=>({timestamp:i*14_400_000,open:100+i,high:101+i,low:99+i,close:100.5+i,volume:1}))
 const firstUp={direction:'up',type:'bos',confirmIndex:8,confirmTimestamp:candles[8]!.timestamp,breachIndex:7} as StructureEvent
 assert.deepEqual(detectLiquidityPoi(candles,[firstUp]),[])
})
