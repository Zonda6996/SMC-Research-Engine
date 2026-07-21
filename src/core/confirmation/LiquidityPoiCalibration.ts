import type { Candle } from '../../models/price/Candle.js'

export const LIQUIDITY_POI_VERSION='liquidity-poi-0.4-structural-hierarchy'
export interface LiquidityPoiCandidate{
 id:string;version:string;direction:'long'|'short';zoneClass:'swing'|'local-eq';originAt:number;knownAt:number;near:number;far:number;atr:number;pivotCount:number;pivotPrices:number[];pivotTimes:number[];ageBars:number;displacementAtr:number;score:number;suppressedNearby:number
}
interface Pivot{type:'low'|'high';i:number;price:number;knownIndex:number;known:number;atr:number}
function atr(c:Candle[],i:number,n=14){let s=0,k=0;for(let j=Math.max(1,i-n+1);j<=i;j++){const x=c[j],p=c[j-1];if(x&&p){s+=Math.max(x.high-x.low,Math.abs(x.high-p.close),Math.abs(x.low-p.close));k++}}return k?s/k:0}
export function detectLiquidityPoi(c:Candle[]):LiquidityPoiCandidate[]{
 const piv:Pivot[]=[]
 for(let i=2;i<c.length-2;i++){const x=c[i]!,a=atr(c,i);if(!a)continue;const left=c.slice(i-2,i),right=c.slice(i+1,i+3);if(left.every(v=>x.low<v.low)&&right.every(v=>x.low<v.low))piv.push({type:'low',i,price:x.low,knownIndex:i+2,known:c[i+2]!.timestamp,atr:a});if(left.every(v=>x.high>v.high)&&right.every(v=>x.high>v.high))piv.push({type:'high',i,price:x.high,knownIndex:i+2,known:c[i+2]!.timestamp,atr:a})}
 const raw:LiquidityPoiCandidate[]=[]
 for(let z=0;z<piv.length;z++){const p=piv[z]!,tol=.25*p.atr,group=piv.filter((q,j)=>j<=z&&q.type===p.type&&Math.abs(q.price-p.price)<=tol&&q.known<=p.known).slice(-8);const prior=c.slice(Math.max(0,p.i-40),p.i+1),swing=p.type==='low'?p.price<=Math.min(...prior.map(x=>x.low)):p.price>=Math.max(...prior.map(x=>x.high));const eq=group.length>=2;if(!swing&&!eq)continue
  let displacementIndex=-1,disp=0;for(let j=p.knownIndex;j<Math.min(c.length,p.knownIndex+13);j++){const d=p.type==='low'?(c[j]!.high-p.price):(p.price-c[j]!.low);if(d/p.atr>disp){disp=d/p.atr;displacementIndex=j}if(d>=1.25*p.atr)break}if(displacementIndex<0||disp<1.25)continue
  const zoneClass:'swing'|'local-eq'=swing?'swing':'local-eq'
  const direction=p.type==='low'?'long':'short',far=p.price+(direction==='long'?-1:.5)*p.atr,age=Math.max(0,c.length-1-p.i),score=(swing?6:0)+group.length*2+Math.min(8,disp)+Math.min(6,age/20)
  raw.push({id:`${LIQUIDITY_POI_VERSION}|${p.type}|${p.known}|${p.price}`,version:LIQUIDITY_POI_VERSION,direction,zoneClass:zoneClass as 'swing'|'local-eq',originAt:c[p.i]!.timestamp,knownAt:c[displacementIndex]!.timestamp,near:p.price,far,atr:p.atr,pivotCount:group.length,pivotPrices:group.map(x=>x.price),pivotTimes:group.map(x=>c[x.i]!.timestamp),ageBars:age,displacementAtr:disp,score,suppressedNearby:0})
 }
 const sorted=raw.sort((a,b)=>b.score-a.score||b.knownAt-a.knownAt),kept:LiquidityPoiCandidate[]=[]
 for(const x of sorted){const blockers=kept.filter(k=>k.direction===x.direction&&Math.abs(k.near-x.near)<=2*Math.max(k.atr,x.atr));const dominant=blockers.some(k=>k.zoneClass==='swing'&&x.zoneClass!=='swing'&&(x.direction==='long'?k.near<x.near:k.near>x.near));if(dominant)continue;x.suppressedNearby=raw.filter(y=>y!==x&&y.direction===x.direction&&Math.abs(y.near-x.near)<=2*Math.max(y.atr,x.atr)&&y.score<x.score).length;kept.push(x)}
 return kept.sort((a,b)=>b.knownAt-a.knownAt).slice(0,100)
}
