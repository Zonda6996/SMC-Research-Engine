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
 assert.equal(LIQUIDITY_POI_VERSION,'liquidity-poi-0.9-freshness-consumption')
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


it('first post-arm sweep consumes freshness; close beyond far is a separate failure',()=>{
 const c=candles();c[5]={...c[5]!,low:90}
 const life:ProtectedLevelLifecycle={id:'p1',direction:'long',point:{type:'low',label:'HL',index:5,price:90} as never,originAt:c[5]!.timestamp,knownAt:c[10]!.timestamp,supersededAt:null,breachedAt:null,endAt:null,active:true}
 c[12]={...c[12]!,low:89,close:91}
 let out=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(out.lifecycleState,'consumed')
 assert.equal(out.consumedAt,c[12]!.timestamp)
 assert.equal(out.failedAt,null)
 c[12]={...c[12]!,low:70,close:70}
 out=detectLiquidityPoi(c,[],{protectedHistory:[life]})[0]!
 assert.equal(out.lifecycleState,'failed')
 assert.equal(out.failedAt,c[12]!.timestamp)
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
