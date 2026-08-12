import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Frontend .mjs intentionally has no TypeScript declaration
import { sortZoneTrades, zoneDistance } from '../tools/visualizer/public/lib/zoneTradeSort.mjs'
const base={near:90,far:95,knownAt:100,endAt:1000,zoneActive:true,zoneValid:true,zoneLastContributionAt:100}
test('current zone trade sorts before ended history',()=>{const old={...base,poiId:'old',near:99,far:101,zoneActive:false,endAt:400,entryAt:390};const live={...base,poiId:'live',near:80,far:85,entryAt:500};assert.equal(sortZoneTrades([old,live],100,600)[0].poiId,'live')})
test('nearest current zone sorts first and in-zone distance is zero',()=>{const near={...base,poiId:'near',near:99,far:101};const far={...base,poiId:'far',near:80,far:85};assert.equal(zoneDistance(near,100),0);assert.equal(sortZoneTrades([far,near],100,600)[0].poiId,'near')})
test('fresh contribution breaks equal-distance ties',()=>{const stale={...base,poiId:'stale',zoneLastContributionAt:200};const fresh={...base,poiId:'fresh',zoneLastContributionAt:300};assert.equal(sortZoneTrades([stale,fresh],100,600)[0].poiId,'fresh')})
test('newer event then stable poi id break remaining ties',()=>{const a={...base,poiId:'a',entryAt:300};const b={...base,poiId:'b',entryAt:400};assert.deepEqual(sortZoneTrades([a,b],100,600).map((x:any)=>x.poiId),['b','a']);assert.deepEqual(sortZoneTrades([{...a,entryAt:400},{...b,entryAt:400}],100,600).map((x:any)=>x.poiId),['a','b'])})
