import assert from 'node:assert/strict'
import { it } from 'node:test'
import { MarketStructureEngine } from '../src/core/builders/MarketStructureEngine.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

const MS = 60_000
const candle = (index:number, close:number):Candle => ({ timestamp:index*MS, open:close, high:close+1, low:close-1, close, volume:1 })
const point = (index:number, price:number, type:'high'|'low', label:StructurePoint['label']):StructurePoint => ({ index, timestamp:index*MS, price, type, label })

it('records causal protected assignment and confirmed breach',()=>{
 const candles=[candle(0,105),candle(1,103),candle(2,100),candle(3,104),candle(4,110),candle(5,95),candle(6,94),candle(7,90)]
 const engine=new MarketStructureEngine(2)
 for(const p of [point(0,105,'high','UNKNOWN'),point(2,100,'low','UNKNOWN'),point(4,110,'high','HH'),point(7,90,'low','LL')]) engine.update(p,candles)
 const long=engine.getState().protectedHistory.find(x=>x.direction==='long')
 assert.ok(long)
 assert.equal(long.originAt,2*MS)
 assert.equal(long.knownAt,6*MS)
 assert.equal(long.breachedAt,6*MS)
 assert.equal(long.endAt,6*MS)
 assert.equal(long.active,false)
})

it('supersedes an old protected level when a newer one is assigned',()=>{
 const candles=Array.from({length:12},(_,i)=>candle(i,105))
 const engine=new MarketStructureEngine(2)
 for(const p of [point(0,108,'high','UNKNOWN'),point(2,100,'low','UNKNOWN'),point(4,110,'high','HH'),point(6,102,'low','HL'),point(8,112,'high','HH')]) engine.update(p,candles)
 const longs=engine.getState().protectedHistory.filter(x=>x.direction==='long')
 assert.equal(longs.length,2)
 assert.equal(longs[0]!.active,false)
 assert.equal(longs[0]!.supersededAt,10*MS)
 assert.equal(longs[1]!.active,true)
 assert.equal(longs[1]!.point.index,6)
})
