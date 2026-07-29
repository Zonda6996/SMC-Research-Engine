import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { computeApexBands, detectReversals } from '../src/core/signals/ApexEngine.js'
const bar=(t:number,o:number,h:number,l:number,c:number):Candle=>({timestamp:t,open:o,high:h,low:l,close:c,volume:1})
it('Apex: внешний край дальше внутреннего на любой положительной ширине',()=>{const c=Array.from({length:50},(_,i)=>bar(i,100,102,98,100));const b=computeApexBands(c,{lookback:10,devLookback:10}).at(-1)!;assert.ok(b.redHi>b.redLo&&b.greenLo<b.greenHi)})
it('Reversal: без касания края направленная свеча не создаёт сигнал',()=>{const c=Array.from({length:50},(_,i)=>bar(i,99,101,98,100));assert.equal(detectReversals(c,{lookback:10,devLookback:10}).length,0)})
