// Автоматический аудит реакций 141/241 по правилам, извлечённым из BTC Decision Lab.
// Не меняет battle/forward. Сначала исследовательская сетка параметров и OOS.
//
// npm run reaction-audit
// npm run reaction-audit -- --symbols BTC/USDT

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { BINGX_MAKER_RATE, BINGX_SLIP_RATE, BINGX_TAKER_RATE } from '../../src/core/analysis/entryModels.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { aggregateCandles, fetchCandlesPaginated, MAX_CANDLES_LTF, TF_MS } from '../shared/candleFetcher.js'
import { buildReactionCandidates } from '../visualizer/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE = join(__dirname, '../batch/cache/reaction-audit')
const RESULTS = join(__dirname, '../batch/results')
const DEFAULT_SYMBOLS = ['BTC/USDT','ETH/USDT','SOL/USDT','XRP/USDT','BNB/USDT','DOGE/USDT','ADA/USDT','AVAX/USDT','LINK/USDT','SUI/USDT','TON/USDT','NEAR/USDT','APT/USDT','LTC/USDT']
const PERIODS = [
	{ id: '2024', until: Date.parse('2025-01-01T00:00:00Z') },
	{ id: '2025', until: Date.parse('2026-01-01T00:00:00Z') },
	{ id: '2026', until: Date.parse('2026-07-20T00:00:00Z') },
]
const TFS = ['30m','1h','4h'] as const
const WAITS = [1,3,6,12] as const
const MIN_RRS = [0,0.5,1] as const
const BODY_FILTERS = [false,true] as const

type Status = 'tp'|'stop'|'open'|'no-confirm'|'stop-before-confirm'|'tp-before-confirm'|'invalid-geometry'|'rr-too-low'|'full-body-through'
interface Candidate { id:string; ratio:number; levelPrice:number; tradeDirection:'long'|'short'; touchLtfIndex:number|null; gridLevels:{ratio:number;price:number}[] }
export interface ReactionResult { status:Status; netR:number|null; actualRR:number|null }

function priceAt(c: Candidate, ratio: number): number | null {
	const exact=c.gridLevels.find(x=>x.ratio===ratio)?.price
	if(exact!=null)return exact
	const p0=c.gridLevels.find(x=>x.ratio===0)?.price,p100=c.gridLevels.find(x=>x.ratio===100)?.price
	return p0==null||p100==null?null:p0+(ratio/100)*(p100-p0)
}
function costR(price:number,rate:number,risk:number){return price*rate/risk}

export function evaluateReaction(candles:Candle[],c:Candidate,waitBars:number,minRR:number,rejectFullBody:boolean):ReactionResult{
	const touch=c.touchLtfIndex
	if(touch==null||!candles[touch])return{status:'invalid-geometry',netR:null,actualRR:null}
	const long=c.tradeDirection==='long',stopRatio=c.ratio===241?261:176,targetRatio=c.ratio===241?141:100
	const stop=priceAt(c,stopRatio),target=priceAt(c,targetRatio),level=c.levelPrice
	if(stop==null||target==null)return{status:'invalid-geometry',netR:null,actualRR:null}
	const first=candles[touch]!,bodyLo=Math.min(first.open,first.close),bodyHi=Math.max(first.open,first.close)
	const fullBody=long?(bodyLo<=stop&&bodyHi>=level):(bodyLo<=level&&bodyHi>=stop)
	if(rejectFullBody&&fullBody)return{status:'full-body-through',netR:null,actualRR:null}
	let confirm=-1
	for(let i=touch;i<Math.min(candles.length,touch+waitBars);i++){
		const x=candles[i]!
		if(long?x.low<=stop:x.high>=stop)return{status:'stop-before-confirm',netR:null,actualRR:null}
		if(long?x.high>=target:x.low<=target)return{status:'tp-before-confirm',netR:null,actualRR:null}
		if(long?x.close>x.open:x.close<x.open){confirm=i;break}
	}
	if(confirm<0)return{status:'no-confirm',netR:null,actualRR:null}
	const entry=candles[confirm]!.close,risk=Math.abs(entry-stop)
	if(risk<=0||(long?(stop>=entry||target<=entry):(stop<=entry||target>=entry)))return{status:'invalid-geometry',netR:null,actualRR:null}
	const rr=Math.abs(target-entry)/risk
	if(rr<minRR)return{status:'rr-too-low',netR:null,actualRR:rr}
	const entryCost=costR(entry,BINGX_TAKER_RATE+BINGX_SLIP_RATE,risk)
	for(let i=confirm+1;i<candles.length;i++){
		const x=candles[i]!,hitStop=long?x.low<=stop:x.high>=stop,hitTp=long?x.high>=target:x.low<=target
		if(hitStop)return{status:'stop',netR:-1-entryCost-costR(stop,BINGX_TAKER_RATE+BINGX_SLIP_RATE,risk),actualRR:rr}
		if(hitTp)return{status:'tp',netR:rr-entryCost-costR(target,BINGX_MAKER_RATE,risk),actualRR:rr}
	}
	return{status:'open',netR:null,actualRR:rr}
}

async function candles(symbol:string,period:{id:string;until:number}):Promise<Candle[]>{
	mkdirSync(CACHE,{recursive:true});const path=join(CACHE,`${symbol.replace('/','-')}_${period.id}_5m.json`)
	if(existsSync(path))return JSON.parse(readFileSync(path,'utf8')) as Candle[]
	const rows=await fetchCandlesPaginated(symbol,'5m',MAX_CANDLES_LTF,'futures',period.until,MAX_CANDLES_LTF)
	writeFileSync(path,JSON.stringify(rows));return rows
}
interface Summary {period:string;timeframe:string;level:number;wait:number;minRR:number;bodyFilter:boolean;candidates:number;entered:number;tp:number;stop:number;open:number;skipped:number;totalR:number;avgR:number;winRate:number;statuses:Record<string,number>}

async function main(){
	const args=process.argv.slice(2),at=args.indexOf('--symbols')
	const symbols=at>=0&&args[at+1]?args[at+1]!.split(','):DEFAULT_SYMBOLS
	const map=new Map<string,Summary>()
	for(const period of PERIODS)for(const symbol of symbols){
		const ltf=await candles(symbol,period),ltf15=aggregateCandles(ltf,'5m','15m')
		console.log(`${period.id} ${symbol}: ${ltf.length} 5m`)
		for(const tf of TFS){
			const htf=aggregateCandles(ltf,'5m',tf),snapshot=runAnalysis(htf)
			const cs=buildReactionCandidates(snapshot,ltf,ltf15,TF_MS[tf]!,`${symbol}|${tf}`,0) as unknown as Candidate[]
			for(const level of [141,241]){const pool=cs.filter(c=>c.ratio===level)
				for(const wait of WAITS)for(const minRR of MIN_RRS)for(const bodyFilter of BODY_FILTERS){
					const key=[period.id,tf,level,wait,minRR,bodyFilter].join('|'),s=map.get(key)??{period:period.id,timeframe:tf,level,wait,minRR,bodyFilter,candidates:0,entered:0,tp:0,stop:0,open:0,skipped:0,totalR:0,avgR:0,winRate:0,statuses:{}}
					for(const c of pool){const r=evaluateReaction(ltf,c,wait,minRR,bodyFilter);s.candidates++;s.statuses[r.status]=(s.statuses[r.status]??0)+1;if(r.status==='tp'||r.status==='stop'){s.entered++;s[r.status]++;s.totalR+=r.netR!}else if(r.status==='open')s.open++;else s.skipped++}
					map.set(key,s)
				}
			}
		}
	}
	for(const s of map.values()){s.avgR=s.entered?s.totalR/s.entered:0;s.winRate=s.entered?s.tp/s.entered:0}
	mkdirSync(RESULTS,{recursive:true});const stamp=new Date().toISOString().replaceAll(':','-'),base=join(RESULTS,`reaction-audit-${stamp}`),rows=[...map.values()]
	const cols=['period','timeframe','level','wait','minRR','bodyFilter','candidates','entered','tp','stop','open','skipped','totalR','avgR','winRate','statuses'] as const
	const csvCell=(value:unknown)=>`"${(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll('"','""')}"`
	writeFileSync(`${base}.csv`,[cols.join(','),...rows.map(r=>cols.map(k=>csvCell(k==='statuses'?r.statuses:r[k])).join(','))].join('\n'))
	const consistent=[] as {tf:string;level:number;wait:number;rr:number;body:boolean;minAvg:number;meanAvg:number;totalN:number}[]
	for(const tf of TFS)for(const level of [141,241])for(const wait of WAITS)for(const rr of MIN_RRS)for(const body of BODY_FILTERS){const x=rows.filter(r=>r.timeframe===tf&&r.level===level&&r.wait===wait&&r.minRR===rr&&r.bodyFilter===body);if(x.length===3&&x.every(r=>r.entered>=10&&r.avgR>0))consistent.push({tf,level,wait,rr,body,minAvg:Math.min(...x.map(r=>r.avgR)),meanAvg:x.reduce((a,r)=>a+r.avgR,0)/3,totalN:x.reduce((a,r)=>a+r.entered,0)})}
	consistent.sort((a,b)=>b.minAvg-a.minAvg)
	const baseline=rows.filter(r=>r.wait===3&&r.minRR===0&&r.bodyFilter===false)
		.sort((a,b)=>a.timeframe.localeCompare(b.timeframe)||a.level-b.level||a.period.localeCompare(b.period))
	const text=['=== REACTION 141/241 AUDIT ===',`symbols ${symbols.length}; periods 2024/2025/2026; TF ${TFS.join('/')}`,'entry: first opposite 5m candle close; costs: BingX taker+slip entry/stop, maker TP','No oversold/RSI layer. Prior-touched and structurally superseded grids excluded.','','BASELINE wait=3 / minRR=0 / body=false:',...baseline.map(r=>`${r.period} ${r.timeframe} L${r.level}: candidates=${r.candidates} entered=${r.entered} TP/SL=${r.tp}/${r.stop} total=${r.totalR.toFixed(2)}R avg=${r.avgR.toFixed(3)}R`),'',`consistent positive variants (each period n>=10): ${consistent.length}`,...consistent.slice(0,30).map(x=>`${x.tf} L${x.level} wait${x.wait} minRR${x.rr} body=${x.body} n=${x.totalN} mean=${x.meanAvg.toFixed(3)} minPeriod=${x.minAvg.toFixed(3)}`),'',`CSV: ${base}.csv`].join('\n')
	writeFileSync(`${base}.txt`,text+'\n');console.log('\n'+text+`\nTXT: ${base}.txt`)
}
const isMain=process.argv[1]!=null&&resolve(process.argv[1])===fileURLToPath(import.meta.url)
if(isMain)main().catch(e=>{console.error(e);process.exit(1)})
