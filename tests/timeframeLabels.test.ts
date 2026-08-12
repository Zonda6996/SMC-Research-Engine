import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Frontend .mjs intentionally has no TypeScript declaration
import { fmtTf } from '../tools/visualizer/public/lib/format.mjs'
test('zone timeframe labels use one canonical visible format',()=>{assert.equal(fmtTf('1d'),'1D');assert.equal(fmtTf('4h'),'4H');assert.equal(fmtTf('15m'),'15M');assert.equal(fmtTf(null),'—')})
