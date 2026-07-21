import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'

export const LIQUIDITY_POI_VERSION='liquidity-poi-0.5.1-structural-lifecycle'
export type LiquidityZoneClass='outer-swing'|'protected-structure'|'local-eq'
export interface LiquidityPoiCandidate{
 id:string;version:string;direction:'long'|'short';zoneClass:LiquidityZoneClass;originAt:number;knownAt:number;near:number;far:number;atr:number;pivotCount:number;pivotPrices:number[];pivotTimes:number[];eventType:string|null;active:boolean;supersededAt:number|null;invalidatedAt:number|null;endAt:number;mergedCount:number
}
interface Pivot{type:'low'|'high';i:number;price:number;known:number;atr:number}
function atr(c:Candle[],i:number,n=14){let s=0,k=0;for(let j=Math.max(1,i-n+1);j<=i;j++){const x=c[j],p=c[j-1];if(x&&p){s+=Math.max(x.high-x.low,Math.abs(x.high-p.close),Math.abs(x.low-p.close));k++}}return k?s/k:0}
function zone(c:Candle[],direction:'long'|'short',zoneClass:LiquidityZoneClass,i:number,knownAt:number,eventType:string|null,pivots:Pivot[]):LiquidityPoiCandidate|null{const a=atr(c,i);if(!a)return null;const near=direction==='long'?c[i]!.low:c[i]!.high,far=near+(direction==='long'?-1:.5)*a;return{id:`${LIQUIDITY_POI_VERSION}|${zoneClass}|${direction}|${knownAt}|${near}`,version:LIQUIDITY_POI_VERSION,direction,zoneClass,originAt:c[i]!.timestamp,knownAt,near,far,atr:a,pivotCount:pivots.length||1,pivotPrices:pivots.length?pivots.map(x=>x.price):[near],pivotTimes:pivots.length?pivots.map(x=>c[x.i]!.timestamp):[c[i]!.timestamp],eventType,active:true,supersededAt:null,invalidatedAt:null,endAt:c.at(-1)!.timestamp,mergedCount:Math.max(0,pivots.length-1)}}
export function detectLiquidityPoi(c:Candle[],events:StructureEvent[]=[]):LiquidityPoiCandidate[]{if(!c.length)return[];const result:LiquidityPoiCandidate[]=[],tfMs=c.length>1?c[1]!.timestamp-c[0]!.timestamp:14_400_000
 // Structure zones: no arbitrary rolling-bar extreme. The event defines the leg.
 for(let n=0;n<events.length;n++){const e=events[n]!,prev=events.slice(0,n).reverse().find(x=>x.direction!==e.direction),from=(prev?.confirmIndex??0)+1,to=e.confirmIndex;if(to<=from||!c[to])continue;let idx=from;if(e.direction==='up'){for(let i=from;i<=to;i++)if(c[i]!.low<c[idx]!.low)idx=i}else{for(let i=from;i<=to;i++)if(c[i]!.high>c[idx]!.high)idx=i}const direction=e.direction==='up'?'long':'short',cls:LiquidityZoneClass=e.type==='choch'?'outer-swing':'protected-structure',known=(c[e.confirmIndex+1]?.timestamp??(c[e.confirmIndex]!.timestamp+tfMs));const z=zone(c,direction,cls,idx,known,e.type,[]);if(z)result.push(z)}
 // Local EQH/EQL: merge a whole nearby pivot cluster into ONE zone.
 const piv:Pivot[]=[];for(let i=2;i<c.length-2;i++){const x=c[i]!,a=atr(c,i);if(!a)continue;const l=c.slice(i-2,i),r=c.slice(i+1,i+3),known=c[i+2]!.timestamp;if(l.every(v=>x.low<v.low)&&r.every(v=>x.low<v.low))piv.push({type:'low',i,price:x.low,known,atr:a});if(l.every(v=>x.high>v.high)&&r.every(v=>x.high>v.high))piv.push({type:'high',i,price:x.high,known,atr:a})}
 const used=new Set<number>();for(let i=0;i<piv.length;i++){if(used.has(i))continue;const p=piv[i]!,group=piv.map((x,j)=>({x,j})).filter(o=>!used.has(o.j)&&o.x.type===p.type&&Math.abs(o.x.price-p.price)<=.25*Math.max(o.x.atr,p.atr));if(group.length<2)continue;for(const o of group)used.add(o.j);const ps=group.map(o=>o.x),ext=p.type==='low'?ps.reduce((a,b)=>a.price<b.price?a:b):ps.reduce((a,b)=>a.price>b.price?a:b),known=Math.max(...ps.map(x=>x.known));const z=zone(c,p.type==='low'?'long':'short','local-eq',ext.i,known,null,ps);if(z)result.push(z)}
 // Approved structural lifecycle: no arbitrary age cutoff.
 const ordered=result.sort((a,b)=>a.knownAt-b.knownAt)
 for(let i=0;i<ordered.length;i++){const x=ordered[i]!
  if(x.zoneClass==='protected-structure'){const next=ordered.slice(i+1).find(y=>y.zoneClass==='protected-structure'&&y.direction===x.direction);if(next)x.supersededAt=next.knownAt}
  if(x.zoneClass==='outer-swing'){const nextExtreme=ordered.slice(i+1).find(y=>y.zoneClass==='outer-swing'&&y.direction===x.direction&&(x.direction==='long'?y.near<x.near:y.near>x.near));const opposite=events.find(e=>e.type==='choch'&&e.confirmTimestamp>x.knownAt&&e.direction===(x.direction==='long'?'down':'up'));const oppositeAt=opposite?(c[opposite.confirmIndex+1]?.timestamp??c[opposite.confirmIndex]!.timestamp+tfMs):null;x.supersededAt=[nextExtreme?.knownAt,oppositeAt].filter((v):v is number=>v!=null).sort((m,n)=>m-n)[0]??null}
  const start=c.findIndex(v=>v.timestamp>=x.knownAt),limit=x.supersededAt??Number.POSITIVE_INFINITY
  for(let k=Math.max(0,start);k<c.length&&c[k]!.timestamp<limit;k++){const bar=c[k]!;let invalid=false;if(x.zoneClass==='local-eq')invalid=x.direction==='long'?bar.low<=x.near:bar.high>=x.near;else if(x.zoneClass==='protected-structure')invalid=x.direction==='long'?bar.close<x.near:bar.close>x.near;else invalid=x.direction==='long'?bar.close<x.far:bar.close>x.far;if(invalid){x.invalidatedAt=bar.timestamp;break}}
  x.active=x.supersededAt==null&&x.invalidatedAt==null;x.endAt=x.invalidatedAt??x.supersededAt??c.at(-1)!.timestamp
 }
 // Exact duplicates from different events collapse by class/direction/near.
 const map=new Map<string,LiquidityPoiCandidate>();for(const x of ordered){const k=`${x.zoneClass}|${x.direction}|${Math.round(x.near/(x.atr*.1))}`;const old=map.get(k);if(!old||x.knownAt>old.knownAt)map.set(k,x)}return[...map.values()].sort((a,b)=>b.knownAt-a.knownAt).slice(0,120)}
