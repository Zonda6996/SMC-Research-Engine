import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'

export const REFINED_POI_VERSION = 'refined-poi-0.1.1-ltf-aligned'
export interface RefinedTrace { state:string; at:number; price?:number; note?:string; volume?:number; volumeRatio?:number }
export interface RefinedPoiCandidate {
 id:string; version:string; direction:'long'|'short'; poiTop:number; poiBottom:number; poiKnownAt:number; poiTouchAt:number|null
 obTop:number; obBottom:number; fvgTop:number; fvgBottom:number; eventType:string; eventAt:number
 status:'entered'|'rejected'|'pending'; rejectionReason:string|null; entryAt:number|null; entry:number|null; stop:number|null; tp2:number|null; outcome:'tp'|'stop'|'open'|null; grossR:number|null; trace:RefinedTrace[]
}
const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0
function atr(c:Candle[],i:number,n=14):number{const x:number[]=[];for(let k=Math.max(1,i-n+1);k<=i;k++){const v=c[k],p=c[k-1];if(v&&p)x.push(Math.max(v.high-v.low,Math.abs(v.high-p.close),Math.abs(v.low-p.close)))}return avg(x)||0}
function dirBar(c:Candle,long:boolean){return long?c.close>c.open:c.close<c.open}
export function detectRefinedPoi(htf:Candle[],events:StructureEvent[],ltf:Candle[]):RefinedPoiCandidate[]{
 const out:RefinedPoiCandidate[]=[]
 for(const e of events){
  const long=e.direction==='up',i=e.breachIndex
  if(i<2||i+1>=htf.length)continue
  let fvg:null|{lo:number;hi:number;known:number}=null
  for(let k=Math.max(1,i-2);k<=Math.min(htf.length-2,e.confirmIndex);k++){
   const a=htf[k-1]!,b=htf[k+1]!
   if(long&&a.high<b.low)fvg={lo:a.high,hi:b.low,known:b.timestamp}
   if(!long&&a.low>b.high)fvg={lo:b.high,hi:a.low,known:b.timestamp}
  }
  if(!fvg)continue
  let ob:Candle|null=null
  for(let k=i-1;k>=Math.max(0,i-10);k--){const c=htf[k]!;if(long?c.close<c.open:c.close>c.open){ob=c;break}}
  if(!ob)continue
  const lo=Math.max(ob.low,fvg.lo),hi=Math.min(ob.high,fvg.hi)
  if(!(hi>lo))continue
  const tfMs=htf.length>1?htf[1]!.timestamp-htf[0]!.timestamp:14_400_000
  const knownAt=Math.max(htf[e.confirmIndex]?.timestamp??e.confirmTimestamp,fvg.known)+tfMs
  const id=`${REFINED_POI_VERSION}|${long?'long':'short'}|${knownAt}|${lo}|${hi}`
  const r:RefinedPoiCandidate={id,version:REFINED_POI_VERSION,direction:long?'long':'short',poiTop:hi,poiBottom:lo,poiKnownAt:knownAt,poiTouchAt:null,obTop:ob.high,obBottom:ob.low,fvgTop:fvg.hi,fvgBottom:fvg.lo,eventType:e.type,eventAt:e.confirmTimestamp,status:'pending',rejectionReason:null,entryAt:null,entry:null,stop:null,tp2:null,outcome:null,grossR:null,trace:[{state:'POI_KNOWN',at:knownAt,note:`${e.type} OB∩FVG`} ]}
  // Для визуальной валидации нужен непрерывный confirmation-TF ряд уже с
  // момента известности POI. Старый HTF POI вне LTF-окна не показываем:
  // иначе график прыгает к современным свечам и выглядит случайным.
  if(!ltf.length||ltf[0]!.timestamp>knownAt)continue
  const start=ltf.findIndex(c=>c.timestamp>=knownAt);if(start<0)continue
  let touch=-1,stopping=-1
  for(let j=start;j<ltf.length;j++){const c=ltf[j]!;if(long?c.close<lo:c.close>hi){r.status='rejected';r.rejectionReason='poi-invalidated';r.trace.push({state:'POI_INVALIDATED',at:c.timestamp});break}if(c.low<=hi&&c.high>=lo){touch=j;break}}
  if(touch<0){out.push(r);continue}r.poiTouchAt=ltf[touch]!.timestamp;r.trace.push({state:'POI_TOUCH',at:r.poiTouchAt})
  for(let j=touch;j<Math.min(ltf.length,touch+20);j++){const c=ltf[j]!,prev=ltf.slice(Math.max(0,j-20),j),sma=avg(prev.map(x=>x.volume)),mx=Math.max(0,...prev.map(x=>x.volume));if(c.volume>=mx||c.volume>=1.5*sma){stopping=j;r.trace.push({state:'STOPPING',at:c.timestamp,price:long?c.low:c.high,volume:c.volume,volumeRatio:sma?c.volume/sma:0});break}}
  if(stopping<0){r.status='rejected';r.rejectionReason='no-stopping';out.push(r);continue}
  const stopLevel=long?ltf[stopping]!.low:ltf[stopping]!.high,a=atr(ltf,stopping);let stable=-1
  for(let j=stopping+1;j<Math.min(ltf.length,stopping+12);j++){const span=ltf.slice(stopping+1,j+1),broken=span.some(c=>long?c.low<stopLevel:c.high>stopLevel),rebound=long?Math.max(...span.map(c=>c.high))-stopLevel:stopLevel-Math.min(...span.map(c=>c.low));if(!broken&&j-stopping>=3&&rebound>=.5*a){stable=j;r.trace.push({state:'REBOUND',at:ltf[j]!.timestamp,price:stopLevel});break}}
  if(stable<0){r.status='rejected';r.rejectionReason='no-rebound';out.push(r);continue}
  let sweep=-1
  for(let j=stable+1;j<Math.min(ltf.length,stable+60);j++){const c=ltf[j]!;if(long?c.low<stopLevel:c.high>stopLevel){sweep=j;r.trace.push({state:'SECOND_SWEEP',at:c.timestamp,price:long?c.low:c.high});break}}
  if(sweep<0){r.status='rejected';r.rejectionReason='no-second-sweep';out.push(r);continue}
  let protect=-1
  for(let j=sweep;j<=Math.min(sweep+1,ltf.length-1);j++)if(long?ltf[j]!.close>stopLevel:ltf[j]!.close<stopLevel){protect=j;break}
  if(protect<0){r.status='rejected';r.rejectionReason='failed-protection';out.push(r);continue}r.trace.push({state:'PROTECTED',at:ltf[protect]!.timestamp,price:stopLevel})
  let impulse=-1,testEnd=-1
  for(let j=protect+1;j<Math.min(ltf.length,protect+30);j++){const c=ltf[j]!;if(long?c.low<ltf[sweep]!.low:c.high>ltf[sweep]!.high){r.status='rejected';r.rejectionReason='second-extreme-break';break}if(dirBar(c,long)){impulse=j;continue}if(impulse>=0&&c.volume<ltf[impulse]!.volume){testEnd=j;if(j+1<ltf.length&&!dirBar(ltf[j+1]!,long)&&ltf[j+1]!.volume<ltf[impulse]!.volume)testEnd=j+1;break}if(impulse>=0){r.status='rejected';r.rejectionReason='high-volume-test';break}}
  if(testEnd<0){if(r.status!=='rejected'){r.status='rejected';r.rejectionReason='no-low-volume-test'}out.push(r);continue}r.trace.push({state:'LOW_VOLUME_TEST',at:ltf[testEnd]!.timestamp,volume:ltf[testEnd]!.volume,volumeRatio:ltf[testEnd]!.volume/ltf[impulse]!.volume})
  let en=-1;for(let j=testEnd+1;j<Math.min(ltf.length,testEnd+20);j++){if(long?ltf[j]!.low<ltf[sweep]!.low:ltf[j]!.high>ltf[sweep]!.high)break;if(dirBar(ltf[j]!,long)){en=j;break}}
  if(en<0){r.status='rejected';r.rejectionReason='no-resumption';out.push(r);continue}
  r.status='entered';r.entryAt=ltf[en]!.timestamp;r.entry=ltf[en]!.close;r.stop=(long?ltf[sweep]!.low-.05*a:ltf[sweep]!.high+.05*a);const risk=Math.abs(r.entry-r.stop);r.tp2=long?r.entry+2*risk:r.entry-2*risk;r.trace.push({state:'ENTRY',at:r.entryAt,price:r.entry})
  for(let j=en+1;j<ltf.length;j++){const c=ltf[j]!,sl=long?c.low<=r.stop:c.high>=r.stop,tp=long?c.high>=r.tp2:c.low<=r.tp2;if(sl){r.outcome='stop';r.grossR=-1;r.trace.push({state:'STOP',at:c.timestamp,price:r.stop});break}if(tp){r.outcome='tp';r.grossR=2;r.trace.push({state:'TP2',at:c.timestamp,price:r.tp2});break}}if(!r.outcome)r.outcome='open'
  out.push(r)
 }
 return out.sort((a,b)=>(b.poiTouchAt??b.poiKnownAt)-(a.poiTouchAt??a.poiKnownAt))
}
