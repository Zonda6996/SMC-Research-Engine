import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityPoi, LIQUIDITY_POI_VERSION } from '../src/core/confirmation/LiquidityPoiCalibration.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import type { ProtectedLevelLifecycle } from '../src/models/structure/ProtectedLevelLifecycle.js'

const candles = (n=40): Candle[] => Array.from({length:n},(_,i)=>({
 timestamp:i*14_400_000,open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100.5+i*.1,volume:1,
}))

it('liquidity POI has a frozen non-trading structural-area version',()=>{
 assert.equal(LIQUIDITY_POI_VERSION,'liquidity-poi-1.0-liquidity-bound')
 assert.deepEqual(detectLiquidityPoi([]),[])
})

it('does not stretch the first structure event back to dataset start',()=>{
 const c=candles(12)
 const firstUp={direction:'up',type:'bos',confirmIndex:8,confirmTimestamp:c[8]!.timestamp,breachIndex:7} as StructureEvent
 assert.deepEqual(detectLiquidityPoi(c,[firstUp]),[])
})

it('builds protected POI from the actual causal protected-level history',()=>{
 const c=candles()
 c[5]={...c[5]!,low:90}
 const life:ProtectedLevelLifecycle={id:'p1',direction:'long',point:{type:'low',label:'HL',index:5,price:90} as never,originAt:c[5]!.timestamp,knownAt:c[10]!.timestamp,supersededAt:null,breachedAt:null,endAt:null,active:true}
 const out=detectLiquidityPoi(c,[],{protectedHistory:[life]})
 assert.equal(out.length,1)
 assert.equal(out[0]!.anchorId,'p1')
 assert.equal(out[0]!.zoneClass,'protected-structure')
 assert.equal(out[0]!.near,90)
 assert.equal(out[0]!.knownAt,c[10]!.timestamp)
 assert.equal(out[0]!.active,true)
})

it('consolidates overlapping same-segment anchors only after the newer anchor is known',()=>{
 const c=candles();c[5]={...c[5]!,low:90};c[7]={...c[7]!,low:89.8}
 const mk=(id:string,index:number,known:number):ProtectedLevelLifecycle=>({id,direction:'long',point:{type:'low',label:'HL',index,price:c[index]!.low} as never,originAt:c[index]!.timestamp,knownAt:c[known]!.timestamp,supersededAt:null,breachedAt:null,endAt:null,active:true})
 const out=detectLiquidityPoi(c,[],{protectedHistory:[mk('p1',5,10),mk('p2',7,12)]})
 assert.equal(out.length,1)
 const merged=out[0]!
 assert.equal(merged.componentAnchorIds.length,2)
 assert.equal(merged.knownAt,c[10]!.timestamp)
 assert.equal(merged.geometryKnownAt,c[12]!.timestamp)
 assert.equal(merged.near,89.8)
 assert.equal(merged.mergedCount,1)
})

it('does not merge calibrated boxes that do not overlap',()=>{
 const c=candles();c[5]={...c[5]!,low:90};c[7]={...c[7]!,low:70}
 const mk=(id:string,index:number,known:number):ProtectedLevelLifecycle=>({id,direction:'long',point:{type:'low',label:'HL',index,price:c[index]!.low} as never,originAt:c[index]!.timestamp,knownAt:c[known]!.timestamp,supersededAt:null,breachedAt:null,endAt:null,active:true})
 const out=detectLiquidityPoi(c,[],{protectedHistory:[mk('p1',5,10),mk('p2',7,12)]})
 assert.equal(out.filter(x=>x.componentAnchorIds.length===1).length,2)
})


it('keeps local EQ only in aligned P/D when the causal range is known',()=>{
 const c=Array.from({length:14},(_,i):Candle=>({timestamp:i*14_400_000,open:115,high:116,low:114,close:115,volume:1}))
 const event={direction:'up',type:'bos',confirmIndex:0,confirmTimestamp:c[0]!.timestamp,breachIndex:0} as StructureEvent
 const structure=[
  {index:0,timestamp:c[0]!.timestamp,price:120,type:'high',label:'HH'},
  {index:1,timestamp:c[1]!.timestamp,price:80,type:'low',label:'LL'},
 ] as never
 c[5]={...c[5]!,low:110};c[8]={...c[8]!,low:110.1}
 assert.equal(detectLiquidityPoi(c,[event],{structure}).filter(x=>x.zoneClass==='local-eq').length,0)
 c[5]={...c[5]!,low:90};c[8]={...c[8]!,low:90.1}
 const aligned=detectLiquidityPoi(c,[event],{structure}).filter(x=>x.zoneClass==='local-eq')
 assert.equal(aligned.length,1)
 assert.equal(aligned[0]!.pdZone,'discount')
 assert.equal(aligned[0]!.pdAligned,true)
})


it('protected-structure needs a close beyond near to consume; a bare wick leaves it fresh',()=>{
 const c=candles();c[5]={...c[5]!,low:90}
 const life:ProtectedLevelLifecycle={id:'p1',direction:'long',point:{type:'low',label:'HL',index:5,price:90} as never,originAt:c[5]!.timestamp,knownAt:c[10]!.timestamp,supersededAt:null,breachedAt:null,endAt:null,active:true}
 c[12]={...c[12]!,low:89,close:91}
 let out=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(out.lifecycleState,'fresh')
 assert.equal(out.consumedAt,null)
 c[13]={...c[13]!,low:85,close:89}
 out=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(out.lifecycleState,'consumed')
 assert.equal(out.consumedAt,c[13]!.timestamp)
 assert.equal(out.failedAt,null)
 c[13]={...c[13]!,low:70,close:70}
 out=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(out.lifecycleState,'failed')
 assert.equal(out.failedAt,c[13]!.timestamp)
})

it('local-eq still consumes on a bare wick sweep of near (spec 13.1, unchanged)',()=>{
 const c=Array.from({length:18},(_,i):Candle=>({timestamp:i*14_400_000,open:115,high:116,low:114,close:115,volume:1}))
 const event={direction:'up',type:'bos',confirmIndex:0,confirmTimestamp:c[0]!.timestamp,breachIndex:0} as StructureEvent
 c[5]={...c[5]!,low:90};c[8]={...c[8]!,low:90.1}
 c[16]={...c[16]!,low:89,close:91}
 const out=detectLiquidityPoi(c,[event],{}).find(x=>x.zoneClass==='local-eq')!
 assert.ok(out)
 assert.equal(out.near,90)
 assert.equal(out.lifecycleState,'consumed')
 assert.equal(out.consumedAt,c[16]!.timestamp)
})

it('outer-swing is never consumed by a near sweep; only far-close failure or retirement end it',()=>{
 const c=candles(30);c[5]={...c[5]!,low:90}
 const up={direction:'up',type:'choch',confirmIndex:10,confirmTimestamp:c[10]!.timestamp,breachIndex:9} as StructureEvent
 const structure=[{index:5,timestamp:c[5]!.timestamp,price:90,type:'low',label:'LL'}] as never
 c[15]={...c[15]!,low:89,close:91}
 const out=detectLiquidityPoi(c,[up],{structure}).find(x=>x.zoneClass==='outer-swing'&&x.direction==='long')!
 assert.ok(out)
 assert.equal(out.consumedAt,null)
 assert.notEqual(out.lifecycleState,'consumed')
})

it('same-direction overlapping outer-swing and local-eq areas do not merge (spec 12.2: they coexist)',()=>{
 const c=Array.from({length:18},(_,i):Candle=>({timestamp:i*14_400_000,open:115,high:116,low:114,close:115,volume:1}))
 const bos={direction:'up',type:'bos',confirmIndex:0,confirmTimestamp:c[0]!.timestamp,breachIndex:0} as StructureEvent
 const choch={direction:'up',type:'choch',confirmIndex:10,confirmTimestamp:c[10]!.timestamp,breachIndex:9} as StructureEvent
 const structure=[{index:5,timestamp:c[5]!.timestamp,price:90,type:'low',label:'LL'}] as never
 c[5]={...c[5]!,low:90};c[8]={...c[8]!,low:90.1}
 const out=detectLiquidityPoi(c,[bos,choch],{structure})
 const outer=out.filter(x=>x.zoneClass==='outer-swing'&&x.direction==='long')
 const local=out.filter(x=>x.zoneClass==='local-eq'&&x.direction==='long')
 assert.ok(outer.length>=1)
 assert.ok(local.length>=1)
 assert.ok(outer.every(x=>!x.componentClasses.includes('local-eq')))
 assert.ok(local.every(x=>!x.componentClasses.includes('outer-swing')))
})

it('lineage supersession does not invalidate an unswept protected area',()=>{
 const c=candles();c[5]={...c[5]!,low:90}
 const life:ProtectedLevelLifecycle={id:'p1',direction:'long',point:{type:'low',label:'HL',index:5,price:90} as never,originAt:c[5]!.timestamp,knownAt:c[10]!.timestamp,supersededAt:c[12]!.timestamp,breachedAt:null,endAt:c[12]!.timestamp,active:false}
 const out=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(out.valid,true)
 assert.equal(out.lineageSupersededAt,c[12]!.timestamp)
})


it('generates one local-swing extreme per side of a structural segment',()=>{
 const c=candles(24)
 const event={direction:'up',type:'bos',confirmIndex:2,confirmTimestamp:c[2]!.timestamp,breachIndex:2} as StructureEvent
 c[5]={...c[5]!,low:95};c[7]={...c[7]!,high:108};c[9]={...c[9]!,low:90};c[11]={...c[11]!,high:105}
 const structure=[
  {index:5,timestamp:c[5]!.timestamp,price:95,type:'low',label:'HL'},
  {index:7,timestamp:c[7]!.timestamp,price:108,type:'high',label:'HH'},
  {index:9,timestamp:c[9]!.timestamp,price:90,type:'low',label:'LL'},
  {index:11,timestamp:c[11]!.timestamp,price:105,type:'high',label:'LH'},
 ] as never
 const out=detectLiquidityPoi(c,[event],{structure})
 const locals=out.filter(x=>x.componentClasses.includes('local-swing'))
 assert.ok(locals.some(x=>x.direction==='long'&&x.near===90))
 assert.ok(locals.some(x=>x.direction==='short'&&x.near===108))
})

it('uses a causal heatmap liquidity pool for far when one qualifies; otherwise falls back to ATR',()=>{
 const c=candles();c[5]={...c[5]!,low:90}
 const life:ProtectedLevelLifecycle={id:'p1',direction:'long',point:{type:'low',label:'HL',index:5,price:90} as never,originAt:c[5]!.timestamp,knownAt:c[10]!.timestamp,supersededAt:null,breachedAt:null,endAt:null,active:true}
 const mkPool=(o:Record<string,unknown>)=>({id:'x',version:'v',spanBins:1,startIndex:0,lastContributionIndex:0,lastContributionAt:0,sweptIndex:null,contributions:5,volumeAccumulated:1,notional:1,remainingNotional:1,status:'active',endAt:0,...o}) as never
 const noPools=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(noPools.boundarySource,'atr-calibration')
 const causal=mkPool({side:'buy-side',extremePrice:85,bandLow:84,bandHigh:86,startAt:c[8]!.timestamp,sweptAt:null,weight:0.6})
 const future=mkPool({side:'buy-side',extremePrice:70,bandLow:68,bandHigh:72,startAt:c[20]!.timestamp,sweptAt:null,weight:0.9})
 const weak=mkPool({side:'buy-side',extremePrice:82,bandLow:81,bandHigh:83,startAt:c[8]!.timestamp,sweptAt:null,weight:0.2})
 const alreadySwept=mkPool({side:'buy-side',extremePrice:86,bandLow:85.5,bandHigh:86.5,startAt:c[8]!.timestamp,sweptAt:c[9]!.timestamp,weight:0.8})
 const withPools=detectLiquidityPoi(c,[],{protectedHistory:[life],heatmapPools:[causal,future,weak,alreadySwept]})[0]!
 assert.equal(withPools.boundarySource,'liquidity-cluster')
 assert.equal(withPools.far,84)
 assert.equal(withPools.liquidityBands.length,1)
 assert.equal(withPools.liquidityBands[0]!.price,85)
})

it('retires a 4h outer area on opposite CHoCH instead of carrying it indefinitely',()=>{
 const c=candles(30);c[5]={...c[5]!,low:90}
 const up={direction:'up',type:'choch',confirmIndex:10,confirmTimestamp:c[10]!.timestamp,breachIndex:9} as StructureEvent
 const down={direction:'down',type:'choch',confirmIndex:20,confirmTimestamp:c[20]!.timestamp,breachIndex:19} as StructureEvent
 const structure=[{index:5,timestamp:c[5]!.timestamp,price:90,type:'low',label:'LL'}] as never
 const out=detectLiquidityPoi(c,[up,down],{structure})
 const outer=out.find(x=>x.zoneClass==='outer-swing'&&x.direction==='long')
 assert.ok(outer)
 assert.equal(outer.lifecycleState,'retired')
 assert.equal(outer.retiredAt,c[21]!.timestamp)
 assert.equal(outer.active,false)
})
