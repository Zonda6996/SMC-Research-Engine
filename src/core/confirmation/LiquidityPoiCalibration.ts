import type { Candle } from '../../models/price/Candle.js'

export const LIQUIDITY_POI_VERSION='liquidity-poi-0.3-calibration'
export interface LiquidityPoiCandidate{ id:string;version:string;direction:'long'|'short';originAt:number;knownAt:number;near:number;atr:number;pivotCount:number;pivotPrices:number[];pivotTimes:number[];ageBars:number;score:number;boundaries:{density20:number;density30:number;density40:number;atr025:number;atr050:number;atr075:number;atr100:number} }
function atr(c:Candle[],i:number,n=14){let s=0,k=0;for(let j=Math.max(1,i-n+1);j<=i;j++){const x=c[j],p=c[j-1];if(x&&p){s+=Math.max(x.high-x.low,Math.abs(x.high-p.close),Math.abs(x.low-p.close));k++}}return k?s/k:0}
export function detectLiquidityPoi(c:Candle[]):LiquidityPoiCandidate[]{
 const piv:{type:'low'|'high';i:number;price:number;known:number;atr:number}[]=[]
 for(let i=2;i<c.length-2;i++){const x=c[i]!,a=atr(c,i);if(!a)continue;const left=c.slice(i-2,i),right=c.slice(i+1,i+3);if(left.every(v=>x.low<v.low)&&right.every(v=>x.low<v.low))piv.push({type:'low',i,price:x.low,known:c[i+2]!.timestamp,atr:a});if(left.every(v=>x.high>v.high)&&right.every(v=>x.high>v.high))piv.push({type:'high',i,price:x.high,known:c[i+2]!.timestamp,atr:a})}
 const out:LiquidityPoiCandidate[]=[]
 for(let z=0;z<piv.length;z++){const p=piv[z]!,tol=.25*p.atr,group=piv.filter((q,j)=>j<=z&&q.type===p.type&&Math.abs(q.price-p.price)<=tol&&q.known<=p.known).slice(-8);const age=Math.max(0,c.length-1-p.i);const score=group.length*2+Math.min(10,age/12);const outward=p.type==='low'?-1:1;const sigma=.15*p.atr;const depth=(ratio:number)=>sigma*Math.sqrt(-2*Math.log(ratio));const at=(d:number)=>p.price+outward*d;out.push({id:`${LIQUIDITY_POI_VERSION}|${p.type}|${p.known}|${p.price}`,version:LIQUIDITY_POI_VERSION,direction:p.type==='low'?'long':'short',originAt:c[p.i]!.timestamp,knownAt:p.known,near:p.price,atr:p.atr,pivotCount:group.length,pivotPrices:group.map(x=>x.price),pivotTimes:group.map(x=>c[x.i]!.timestamp),ageBars:age,score,boundaries:{density20:at(depth(.2)),density30:at(depth(.3)),density40:at(depth(.4)),atr025:at(.25*p.atr),atr050:at(.5*p.atr),atr075:at(.75*p.atr),atr100:at(p.atr)}})}
 const seen=new Set<string>();return out.sort((a,b)=>b.knownAt-a.knownAt).filter(x=>{const k=`${x.direction}|${Math.round(x.near/x.atr*10)}`;if(seen.has(k))return false;seen.add(k);return true}).slice(0,100)
}
