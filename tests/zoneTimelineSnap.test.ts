import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Frontend .mjs intentionally has no TypeScript declaration
import { snapZoneTime } from '../tools/visualizer/public/panels/zones.mjs'
const H=3_600_000, candles=[0,4,8,12].map(h=>({timestamp:h*H}))
test('MTF zone start snaps forward to a displayed candle',()=>{assert.equal(snapZoneTime(5*H,candles,'start'),8*H/1000);assert.equal(snapZoneTime(8*H,candles,'start'),8*H/1000)})
test('MTF zone end snaps backward and clamps to history',()=>{assert.equal(snapZoneTime(11*H,candles,'end'),8*H/1000);assert.equal(snapZoneTime(-H,candles,'end'),0);assert.equal(snapZoneTime(20*H,candles,'end'),12*H/1000)})
