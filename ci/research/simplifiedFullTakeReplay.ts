import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import type { LiquidityPoiCandidate } from '../../src/core/confirmation/LiquidityPoiCalibration.js'
import type { StructureEvent } from '../../src/models/events/StructureEvent.js'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { detectLiquidityHeatmap, heatmapConfigForTf } from '../../src/core/liquidity/LiquidityHeatmapEngine.js'
import { detectLiquidityPoi } from '../../src/core/confirmation/LiquidityPoiCalibration.js'
import { detectSimplifiedConfirmation, SIMPLIFIED_APEX_VETO_PRESET } from '../../src/core/confirmation/SimplifiedConfirmationEngine.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const OUT = process.env.OUT_DIR ?? 'ci-results'
const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const DAY = 86_400_000
const H15 = 900_000
const SPLIT = Date.UTC(2025, 0, 1)
const FROM = Date.UTC(2020, 6, 1) // 180d warm-up before the first measured year
const UNTIL = Date.UTC(2026, 6, 30)
const SYMBOLS = ['BTC/USDT','ETH/USDT','SOL/USDT','XRP/USDT','BNB/USDT','DOGE/USDT','ADA/USDT','LINK/USDT']
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
const COST_PRICE_PCT = 0.001 // same 0.10% round-trip model as the accepted simplified study

type Family = 'baseline' | 'trail' | 'time' | 'partial2' | 'opposite-zone' | 'structure'
type Variant = { id: string; family: Family; trailAtr?: number; timeBars?: number; secondAtR?: number; oppositeZone?: boolean; structure?: boolean }
const VARIANTS: Variant[] = [
  { id: 'baseline-12R', family: 'baseline' },
  { id: 'trail-2atr', family: 'trail', trailAtr: 2 },
  { id: 'trail-4atr', family: 'trail', trailAtr: 4 },
  { id: 'trail-6atr', family: 'trail', trailAtr: 6 },
  { id: 'time-96', family: 'time', timeBars: 96 },
  { id: 'time-192', family: 'time', timeBars: 192 },
  { id: 'time-384', family: 'time', timeBars: 384 },
  { id: 'partial2-2R', family: 'partial2', secondAtR: 2 },
  { id: 'partial2-4R', family: 'partial2', secondAtR: 4 },
  { id: 'partial2-6R', family: 'partial2', secondAtR: 6 },
  { id: 'opposite-zone', family: 'opposite-zone', oppositeZone: true },
  { id: 'opposite-choch', family: 'structure', structure: true },
]

type Trade = { variant: string; family: Family; symbol: string; direction: 'long'|'short'; entryAt: number; exitAt: number; holdBars: number; grossR: number; netR: number; exit: string }
const trades: Trade[] = []

function lowerBound(c: Candle[], ts: number): number {
  let lo = 0, hi = c.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (c[m]!.timestamp < ts) lo = m + 1; else hi = m }
  return lo
}
function atr(c: Candle[], i: number, n = 14): number {
  let s = 0, k = 0
  for (let j = Math.max(1, i - n + 1); j <= i; j++) { const x=c[j], p=c[j-1]; if (!x||!p) continue; s += Math.max(x.high-x.low,Math.abs(x.high-p.close),Math.abs(x.low-p.close)); k++ }
  return k ? s/k : 0
}
function touchMaps(c: Candle[], pois: LiquidityPoiCandidate[]): { long: Uint8Array; short: Uint8Array } {
  const out = { long: new Uint8Array(c.length), short: new Uint8Array(c.length) }
  for (const z of pois) {
    if (z.duplicateOf != null || z.boundarySource !== 'liquidity-cluster') continue
    const lo=Math.min(z.near,z.far), hi=Math.max(z.near,z.far)
    const target = z.direction === 'short' ? out.long : out.short // long exits at a short zone
    const a=lowerBound(c,Math.max(z.knownAt,z.geometryKnownAt)), b=lowerBound(c,z.endAt)
    for (let i=a;i<Math.min(b+1,c.length);i++) { const x=c[i]!; if(x.low<=hi&&x.high>=lo) target[i]=1 }
  }
  return out
}
function structureMaps(c: Candle[], events: StructureEvent[]): { long: Uint8Array; short: Uint8Array } {
  const out={long:new Uint8Array(c.length),short:new Uint8Array(c.length)}
  for(const e of events) if(e.type==='choch') { const i=lowerBound(c,e.confirmTimestamp); if(i<c.length) (e.direction==='down'?out.long:out.short)[i]=1 }
  return out
}
function replay(symbol:string,direction:'long'|'short',entryAt:number,entry:number,stop0:number,c:Candle[],from:number,v:Variant,zm:{long:Uint8Array;short:Uint8Array},sm:{long:Uint8Array;short:Uint8Array}):Trade {
  const long=direction==='long', risk=Math.abs(entry-stop0), part=long?entry+0.4*risk:entry-0.4*risk, full=long?entry+12*risk:entry-12*risk
  const second=v.secondAtR==null?0:(long?entry+v.secondAtR*risk:entry-v.secondAtR*risk)
  let stop=stop0, partial=false, secondTaken=false, realised=0, remaining=1, peak=entry, exitAt=c.at(-1)?.timestamp??entryAt, exit='open', k=from
  const closeRest=(price:number,why:string,idx:number)=>{ realised += remaining*(long?(price-entry)/risk:(entry-price)/risk); remaining=0; exit=why; exitAt=c[idx]!.timestamp; k=idx }
  for(k=from;k<c.length;k++){
    const x=c[k]!, hitStop=long?x.low<=stop:x.high>=stop
    if(hitStop){ closeRest(stop,partial?(stop===entry?'be':'trail'):'stop',k); break }
    if(!partial){ const hit=long?x.high>=part:x.low<=part; if(hit){ realised+=0.25*0.4;remaining=0.75;partial=true;stop=entry;peak=long?x.high:x.low;continue } }
    else {
      const hitFull=long?x.high>=full:x.low<=full
      if(hitFull){closeRest(full,'full',k);break}
      if(second && !secondTaken && (long?x.high>=second:x.low<=second)){ realised+=0.25*v.secondAtR!;remaining-=0.25;secondTaken=true;continue }
      if(v.oppositeZone && zm[direction][k]){closeRest(x.close,'opposite-zone',k);break}
      if(v.structure && sm[direction][k]){closeRest(x.close,'opposite-choch',k);break}
      if(v.timeBars!=null && k-from+1>=v.timeBars){closeRest(x.close,'time',k);break}
      if(v.trailAtr!=null){ const a=atr(c,k); if(long){peak=Math.max(peak,x.high);stop=Math.max(stop,peak-v.trailAtr*a)}else{peak=Math.min(peak,x.low);stop=Math.min(stop,peak+v.trailAtr*a)} }
    }
  }
  if(remaining>0){const idx=Math.max(from,Math.min(k,c.length-1));closeRest(c[idx]!.close,'open-mark',idx)}
  const grossR=realised, netR=grossR-COST_PRICE_PCT*entry/risk
  return{variant:v.id,family:v.family,symbol,direction,entryAt,exitAt,holdBars:Math.max(0,lowerBound(c,exitAt)-from+1),grossR,netR,exit}
}
function stats(xs:Trade[]){
  const r=xs.map(x=>x.netR), n=r.length, sum=r.reduce((a,b)=>a+b,0), wins=r.filter(x=>x>0), losses=r.filter(x=>x<0), sorted=[...r].sort((a,b)=>b-a), trim=sorted.slice(Math.ceil(n*0.01))
  let eq=0,peak=0,dd=0;for(const x of [...xs].sort((a,b)=>a.entryAt-b.entryAt)){eq+=x.netR;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq)}
  return{n,wr:n?wins.length/n:0,mean:n?sum/n:0,sum,pf:losses.length?wins.reduce((a,b)=>a+b,0)/-losses.reduce((a,b)=>a+b,0):null,maxDd:dd,meanTrim1:trim.length?trim.reduce((a,b)=>a+b,0)/trim.length:0,meanHold:n?xs.reduce((a,b)=>a+b.holdBars,0)/n:0}
}

for(const symbol of SYMBOLS){
  console.log(`[full-take] fetch ${symbol}`)
  const [hAll,lAll]=await Promise.all([
    fetchArchiveKlines(symbol,'1h','futures',FROM,UNTIL,{cacheDir:CACHE,parallel:12}),
    fetchArchiveKlines(symbol,'15m','futures',FROM,UNTIL,{cacheDir:CACHE,parallel:12}),
  ])
  console.log(`[full-take] ${symbol}: 1h=${hAll.length} 15m=${lAll.length}`)
  for(const year of YEARS){
    const ys=Date.UTC(year,0,1), ye=Math.min(Date.UTC(year+1,0,1),UNTIL)
    if(ys>=ye)continue
    const ws=ys-180*DAY, lEnd=Math.min(UNTIL,ye+365*DAY)
    const h=hAll.slice(lowerBound(hAll,ws),lowerBound(hAll,ye))
    const l=lAll.slice(lowerBound(lAll,ws),lowerBound(lAll,lEnd))
    if(h.length<1000||l.length<4000)continue
    console.log(`[full-take] ${symbol} ${year}: build h=${h.length} l=${l.length}`)
    const snap=runAnalysis(h)
    const hc={...heatmapConfigForTf(3_600_000),maxPools:5_000_000}
    const pools=detectLiquidityHeatmap(h,hc)
    const pois=detectLiquidityPoi(h,snap.events,{structure:snap.structure,heatmapPools:pools})
    const confirmations=detectSimplifiedConfirmation(pois,l,SIMPLIFIED_APEX_VETO_PRESET,{events:snap.events})
    const zm=touchMaps(l,pois),sm=structureMaps(l,snap.events)
    let added=0
    for(const q of confirmations)for(const e of q.entries){
      if(e.entryAt<ys||e.entryAt>=ye)continue
      const from=lowerBound(l,e.entryAt)+1
      for(const v of VARIANTS)trades.push(replay(symbol,q.direction,e.entryAt,e.entry,e.stop,l,from,v,zm,sm))
      added++
    }
    console.log(`[full-take] ${symbol} ${year}: pools=${pools.length} pois=${pois.length} entries=${added}`)
  }
}

const rows=VARIANTS.map(v=>({variant:v.id,family:v.family,train:stats(trades.filter(x=>x.variant===v.id&&x.entryAt<SPLIT)),test:stats(trades.filter(x=>x.variant===v.id&&x.entryAt>=SPLIT))}))
const selected=[...new Set(VARIANTS.map(v=>v.family))].map(f=>rows.filter(r=>r.family===f).sort((a,b)=>b.train.meanTrim1-a.train.meanTrim1||b.train.mean-a.train.mean)[0]!)
const slices=selected.flatMap(r=>['train','test'].flatMap(period=>{
  const base=trades.filter(x=>x.variant===r.variant&&(period==='train'?x.entryAt<SPLIT:x.entryAt>=SPLIT))
  return [
    ...SYMBOLS.map(symbol=>({variant:r.variant,period,slice:`symbol:${symbol}`,stats:stats(base.filter(x=>x.symbol===symbol))})),
    ...(['long','short'] as const).map(d=>({variant:r.variant,period,slice:`direction:${d}`,stats:stats(base.filter(x=>x.direction===d))})),
    ...[2021,2022,2023,2024,2025,2026].flatMap(y=>[0,1].map(h=>{const a=Date.UTC(y,h*6,1),b=Date.UTC(y,(h+1)*6,1);return{variant:r.variant,period,slice:`half:${y}-H${h+1}`,stats:stats(base.filter(x=>x.entryAt>=a&&x.entryAt<b))}})),
  ]
}))
const result={protocol:{symbols:SYMBOLS,from:new Date(FROM).toISOString(),until:new Date(UNTIL).toISOString(),split:new Date(SPLIT).toISOString(),zoneTf:'1h',confirmationTf:'15m',costPricePct:COST_PRICE_PCT,selection:'max train mean net R after removing best 1%; test unseen',sameEntries:true,conservativeIntrabar:true},rows,selected,slices}
mkdirSync(OUT,{recursive:true});writeFileSync(join(OUT,'simplified-full-take.json'),JSON.stringify(result,null,2))
const f=(x:number)=>Number.isFinite(x)?x.toFixed(3):'n/a'
let md='# Simplified full-take replay\n\n- Identical entries/stops across variants; only post-entry exit changes.\n- Train `< 2025-01-01`; test `>= 2025-01-01`.\n- Net cost: 0.10% of entry price per trade.\n- Selection: highest train mean after removing the best 1% trades; test was not used.\n\n| variant | family | train n | train E | train E ex-top1% | test n | test E | test ex-top1% | test PF | test DD |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n'
for(const r of rows)md+=`| ${r.variant} | ${r.family} | ${r.train.n} | ${f(r.train.mean)}R | ${f(r.train.meanTrim1)}R | ${r.test.n} | ${f(r.test.mean)}R | ${f(r.test.meanTrim1)}R | ${r.test.pf==null?'n/a':f(r.test.pf)} | ${f(r.test.maxDd)}R |\n`
md+='\n## Train-selected family winners\n\n'+selected.map(r=>`- ${r.family}: **${r.variant}** — train ${f(r.train.meanTrim1)}R ex-top1%; test ${f(r.test.mean)}R, ex-top1% ${f(r.test.meanTrim1)}R.`).join('\n')+'\n'
writeFileSync(join(OUT,'simplified-full-take.md'),md)
console.log(md)
