import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIndicatorPayload } from '../tools/visualizer/server.js'
const H=3_600_000
const candles=Array.from({length:260},(_,i)=>({timestamp:i*H,open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.3+i*.01,volume:1000+i}))
test('indicator payload timestamps belong to the exact displayed series',()=>{const p=buildIndicatorPayload(candles);assert.equal(p.apex.bands.length,candles.length);for(let i=0;i<p.apex.bands.length;i++){const b=p.apex.bands[i];if(b)assert.equal(b.t,candles[i]!.timestamp)}const times=new Set(candles.map(c=>c.timestamp));for(const s of p.reversal.signals)assert.ok(times.has(s.at))})
