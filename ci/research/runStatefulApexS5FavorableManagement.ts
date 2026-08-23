import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import { detectStatefulApexEvents, isValidStatefulApexRow, type ApexEventSide, type StatefulApexEvent, type StatefulApexRow } from './lib/statefulApexEvents.js'

const MANIFEST_PATH = 'ci-results/stateful-apex-s1-manifest.json'
const DESIGN_PATH = 'ci-results/stateful-apex-s5-favorable-management-preregistration.md'
const JSON_OUT = 'ci-results/stateful-apex-s5-favorable-management.json'
const MD_OUT = 'ci-results/stateful-apex-s5-favorable-management.md'
const COST_BPS = 5
const RESAMPLES = 10_000
const SEED = 20260822
const EXPECTED_SYMBOLS = ['ADAUSDT', 'BTCUSDT', 'DOGEUSDT', 'ETHUSDT', 'LDOUSDT', 'XRPUSDT']
const FORBIDDEN = ['ONDOUSDT', 'VIRTUALUSDT', 'ZECUSDT', '1000PEPEUSDT', 'BOMEUSDT']

type Outcome = 'target' | 'stop' | 'be' | 'censored'
interface ManifestSeries { file: string; symbol: string; timeframe: string; market: string; split: string; sha256: string }
interface Manifest { series: ManifestSeries[] }
interface Result { outcome: Outcome; exitIndex: number | null; exitPrice: number | null; grossR: number | null; netR: number | null; activated: boolean; activationIndex: number | null; effectiveIndex: number | null }
interface Pair { id: string; symbol: string; series: string; month: string; side: ApexEventSide; baseline: Result; managed: Result; grossDelta: number; netDelta: number; favorableThenStop: boolean; saved: boolean; winnerClipped: boolean; feasibleWaypoint: boolean }
interface Ci { low: number | null; high: number | null }

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
const mean = (x: readonly number[]): number => x.length ? x.reduce((a,b)=>a+b,0)/x.length : NaN
function quantile(x: readonly number[], p: number): number | null { if(!x.length)return null;const s=[...x].sort((a,b)=>a-b),at=(s.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);return s[lo]!+(s[hi]!-s[lo]!)*(at-lo) }
function ci(x: readonly number[]): Ci { return { low: quantile(x,.025), high: quantile(x,.975) } }
function rng32(seed:number):()=>number { let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296} }
function grouped<T>(x:readonly T[], key:(v:T)=>string):Map<string,T[]> { const m=new Map<string,T[]>();for(const v of x){const k=key(v),a=m.get(k)??[];a.push(v);m.set(k,a)}return m }

function parseRows(path:string):StatefulApexRow[] {
 const parsed=parseExactIndicatorCsv(readFileSync(resolve(path),'utf8'),{allowIrregularBars:true,allowInvalidBandOrder:true})
 // Parser validates shape columns as schema only; values are immediately discarded before detection/replay.
 return parsed.map(({buy:_buy,sell:_sell,...row})=>row).slice(210)
}
function prices(rows:readonly StatefulApexRow[], e:StatefulApexEvent):{entry:number;target:number;stop:number;inner:number;oneR:number}|null { if(e.entryIndex==null)return null;const er=rows[e.entryIndex],cr=rows[e.confirmationIndex];if(!er||!cr)return null;const entry=er.open,target=cr.mean,stop=e.side==='long'?cr.lowerOuter:cr.upperOuter,inner=e.side==='long'?cr.lowerInner:cr.upperInner,oneR=Math.abs(entry-stop),sign=e.side==='long'?1:-1;return oneR>0&&sign*(entry-stop)>0?{entry,target,stop,inner,oneR}:null }
function economics(entry:number, exit:number, oneR:number, gross:number):{grossR:number;netR:number}{const cost=(entry+exit)*(COST_BPS/10_000)/oneR;return{grossR:gross,netR:gross-cost}}
function replay(rows:readonly StatefulApexRow[],e:StatefulApexEvent,managed:boolean):Result|null { const p=prices(rows,e);if(!p||e.entryIndex==null)return null;const sign=e.side==='long'?1:-1,feasible=sign*(p.inner-p.entry)>0;let activationIndex:number|null=null,effectiveIndex:number|null=null
 for(let i=e.entryIndex;i<rows.length;i++){const r=rows[i]!;if(!isValidStatefulApexRow(r))break
  const targetHit=e.side==='long'?r.high>=p.target:r.low<=p.target,stopHit=e.side==='long'?r.low<=p.stop:r.high>=p.stop
  if(managed&&effectiveIndex!=null&&i>=effectiveIndex){const beHit=e.side==='long'?r.low<=p.entry:r.high>=p.entry;if(beHit||targetHit){const outcome:Outcome=beHit?'be':'target',exit=beHit?p.entry:p.target,gross=beHit?0:Math.abs(p.target-p.entry)/p.oneR;return{outcome,exitIndex:i,exitPrice:exit,...economics(p.entry,exit,p.oneR,gross),activated:true,activationIndex,effectiveIndex}}}
  if(stopHit||targetHit){const outcome:Outcome=stopHit?'stop':'target',exit=stopHit?p.stop:p.target,gross=stopHit?-1:Math.abs(p.target-p.entry)/p.oneR;return{outcome,exitIndex:i,exitPrice:exit,...economics(p.entry,exit,p.oneR,gross),activated:activationIndex!=null,activationIndex,effectiveIndex}}
  if(managed&&feasible&&activationIndex==null){const innerHit=e.side==='long'?r.high>=p.inner:r.low<=p.inner;if(innerHit){activationIndex=i;effectiveIndex=i+1}}
 }
 return{outcome:'censored',exitIndex:null,exitPrice:null,grossR:null,netR:null,activated:activationIndex!=null,activationIndex,effectiveIndex}
}
function bootstrap(pairs:readonly Pair[],mode:'hierarchical'|'series'): {gross:Ci;net:Ci} { const rng=rng32(SEED+(mode==='series'?1:0)),gross:number[]=[],net:number[]=[],symbols=grouped(pairs,p=>p.symbol),series=grouped(pairs,p=>p.series)
 for(let b=0;b<RESAMPLES;b++){const sample:Pair[]=[];if(mode==='series'){const cs=[...series.values()];for(let i=0;i<cs.length;i++)sample.push(...cs[Math.floor(rng()*cs.length)]!)}else{const ss=[...symbols.keys()];for(let i=0;i<ss.length;i++){const s=ss[Math.floor(rng()*ss.length)]!,months=[...grouped(symbols.get(s)!,p=>p.month).values()];for(let j=0;j<months.length;j++)sample.push(...months[Math.floor(rng()*months.length)]!)}}if(sample.length){gross.push(mean(sample.map(p=>p.grossDelta)));net.push(mean(sample.map(p=>p.netDelta)))}}
 return{gross:ci(gross),net:ci(net)} }
function breadth(pairs:readonly Pair[],key:(p:Pair)=>string):{estimable:number;positive:number;rate:number|null}{const xs=[...grouped(pairs,key).values()].map(x=>mean(x.map(p=>p.netDelta))).filter(Number.isFinite);const positive=xs.filter(x=>x>0).length;return{estimable:xs.length,positive,rate:xs.length?positive/xs.length:null}}
function wilsonLower(k:number,n:number):number|null{if(!n)return null;const z=1.959963984540054,p=k/n,d=1+z*z/n;return(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/d}

function main():void{
 const manifest=JSON.parse(readFileSync(resolve(MANIFEST_PATH),'utf8')) as Manifest,allowed=manifest.series.filter(s=>s.split==='train'&&/^\d+$/.test(s.timeframe)&&Number(s.timeframe)>=15&&!FORBIDDEN.includes(s.symbol));const symbols=[...new Set(allowed.map(s=>s.symbol))].sort();if(allowed.length!==15||JSON.stringify(symbols)!==JSON.stringify(EXPECTED_SYMBOLS))throw new Error(`development inventory mismatch: ${allowed.length}, ${symbols}`)
 if(allowed.some(s=>FORBIDDEN.includes(s.symbol)||s.split!=='train'))throw new Error('forbidden inventory selected')
 const pairs:Pair[]=[];let rowsParsed=0,eventsDetected=0,invalid=0
 for(const s of allowed){if(sha256(s.file)!==s.sha256)throw new Error(`${s.file}: hash mismatch`);const rows=parseRows(s.file);rowsParsed+=rows.length;const events=detectStatefulApexEvents(rows).events;eventsDetected+=events.length
  for(const e of events){const b=replay(rows,e,false),m=replay(rows,e,true),p=prices(rows,e);if(!b||!m||!p||b.netR==null||m.netR==null||b.grossR==null||m.grossR==null){invalid++;continue}const favorableThenStop=b.outcome==='stop'&&m.activationIndex!=null;const saved=favorableThenStop&&m.netR>b.netR;const winnerClipped=b.outcome==='target'&&m.outcome==='be';pairs.push({id:`${s.file}:${e.id}`,symbol:s.symbol,series:s.file,month:new Date(e.confirmationTimestamp).toISOString().slice(0,7),side:e.side,baseline:b,managed:m,grossDelta:m.grossR-b.grossR,netDelta:m.netR-b.netR,favorableThenStop,saved,winnerClipped,feasibleWaypoint:(e.side==='long'?1:-1)*(p.inner-p.entry)>0}) }
 }
 const primary=bootstrap(pairs,'hierarchical'),sensitivity=bootstrap(pairs,'series'),symbolBreadth=breadth(pairs,p=>p.symbol),seriesBreadth=breadth(pairs,p=>p.series),fts=pairs.filter(p=>p.favorableThenStop).length,saved=pairs.filter(p=>p.saved).length,clipped=pairs.filter(p=>p.winnerClipped).length,activated=pairs.filter(p=>p.managed.activated).length,activationSymbols=new Set(pairs.filter(p=>p.managed.activated).map(p=>p.symbol)).size,activationSeries=new Set(pairs.filter(p=>p.managed.activated).map(p=>p.series)).size,meanGrossDelta=mean(pairs.map(p=>p.grossDelta)),meanNetDelta=mean(pairs.map(p=>p.netDelta)),savedWilsonLow=wilsonLower(saved,fts)
 const screens={netDeltaPositiveCi:meanNetDelta>0&&(primary.net.low??-Infinity)>0,grossDeltaPositiveCi:meanGrossDelta>0&&(primary.gross.low??-Infinity)>0,breadth:(symbolBreadth.rate??0)>=.6&&(seriesBreadth.rate??0)>=.6,attribution:saved>clipped&&(savedWilsonLow??0)>0,pathFeasibility:activationSymbols>=3&&activationSeries>=5,integrity:true};const passes=Object.values(screens).every(Boolean),decision=passes?'CANDIDATE_FOR_FREEZE':'NO_CANDIDATE'
 const output={schemaVersion:1,generatedAt:new Date().toISOString(),decision,candidate:passes?'INNER_TOUCH_THEN_BE_NEXT_BAR':null,protocol:{stage:'DEVELOPMENT_ONLY',designArtifact:DESIGN_PATH,designSha256:sha256(DESIGN_PATH),manifest:MANIFEST_PATH,manifestSha256:sha256(MANIFEST_PATH),runnerSha256:sha256('ci/research/runStatefulApexS5FavorableManagement.ts'),costBpsPerSide:COST_BPS,resamples:RESAMPLES,seed:SEED,noPnlGrid:true,noSrcCoreChanges:true,vendorShapesUsed:false},integrity:{passed:true,allowedSeries:allowed.length,allowedSymbols:symbols,rowsParsed,eventsDetected,validPairedEvents:pairs.length,invalidEvents:invalid,s1UntouchedOosFilesRead:0,ondoVirtualFilesRead:0,s4HoldoutFilesRead:0,vendorShapeUses:0,vendorShapeRowsValidatedThenDiscarded:rowsParsed+allowed.length*210},attribution:{baselineFavorableThenStop:fts,saved,savedRate:fts?saved/fts:null,savedWilson95Lower:savedWilsonLow,baselineWinners:pairs.filter(p=>p.baseline.outcome==='target').length,winnerClipped:clipped,activated,activationRate:activated/pairs.length,activationToBe:pairs.filter(p=>p.managed.outcome==='be').length,activationToTarget:pairs.filter(p=>p.managed.activated&&p.managed.outcome==='target').length,activationSymbols,activationSeries},economics:{meanGrossDelta,meanNetDelta,totalGrossDelta:pairs.reduce((a,p)=>a+p.grossDelta,0),totalNetDelta:pairs.reduce((a,p)=>a+p.netDelta,0),primaryHierarchicalCi95:primary,seriesClusterSensitivityCi95:sensitivity},breadth:{symbols:symbolBreadth,series:seriesBreadth},screens,pathFeasibility:{rule:'Inner touch observed on completed bar; BE effective only from next bar; activation-bar target/stop resolved before activation; post-activation collision BE-first.',sameBarActivationsUsed:0,feasibleWaypointEvents:pairs.filter(p=>p.feasibleWaypoint).length},perSymbol:[...grouped(pairs,p=>p.symbol)].map(([key,x])=>({symbol:key,n:x.length,meanNetDelta:mean(x.map(p=>p.netDelta)),saved:x.filter(p=>p.saved).length,clipped:x.filter(p=>p.winnerClipped).length})),perSeries:[...grouped(pairs,p=>p.series)].map(([key,x])=>({series:key,n:x.length,meanNetDelta:mean(x.map(p=>p.netDelta)),saved:x.filter(p=>p.saved).length,clipped:x.filter(p=>p.winnerClipped).length}))}
 writeFileSync(resolve(JSON_OUT),JSON.stringify(output,null,2)+'\n')
 const f=(x:number|null)=>x==null?'n/a':x.toFixed(4),md=[`# Stateful Apex S5 — favorable-excursion management diagnostic`,'',`- Decision: **${decision}**; candidate: **${output.candidate??'none'}**.`,'- Development only: 15 series / 6 symbols. S1 OOS, ONDO/VIRTUAL, S4 holdout, Vendor Shapes: **0 uses**.','- Mechanism: frozen Inner touch on a completed bar → BE effective from next bar; no entry/target change, no grid.','',`## Attribution`,``,`- Baseline favorable-then-stop: **${fts}**; saved: **${saved}** (${f(fts?saved/fts:null)}); winner clipped: **${clipped}**.`,`- Activated: **${activated}/${pairs.length}**; activation breadth ${activationSymbols} symbols / ${activationSeries} series.`,`- Path feasibility: no same-bar activation; activation-bar baseline exits precede activation; later BE/target collision is BE-first.`,'',`## Economics and uncertainty`,``,`- Gross delta: mean **${f(meanGrossDelta)}R**, total **${f(output.economics.totalGrossDelta)}R**, CI95 **[${f(primary.gross.low)}, ${f(primary.gross.high)}]**.` ,`- Net delta @5 bps/side: mean **${f(meanNetDelta)}R**, total **${f(output.economics.totalNetDelta)}R**, CI95 **[${f(primary.net.low)}, ${f(primary.net.high)}]**.`,`- Positive breadth: symbols **${symbolBreadth.positive}/${symbolBreadth.estimable}**, series **${seriesBreadth.positive}/${seriesBreadth.estimable}**.`,'',`## Conservative screens`,``,...Object.entries(screens).map(([k,v])=>`- ${v?'PASS':'FAIL'}: ${k}`),'',passes?'Development screens passed for exactly one candidate. A separate freeze is required before any independent holdout.':'At least one preregistered screen failed; no mechanism is selected for freeze.','',`Artifacts: \`${JSON_OUT}\`; design: \`${DESIGN_PATH}\`.`]
 writeFileSync(resolve(MD_OUT),md.join('\n')+'\n');console.log(`${decision}: wrote ${JSON_OUT} and ${MD_OUT}`)
}
main()
