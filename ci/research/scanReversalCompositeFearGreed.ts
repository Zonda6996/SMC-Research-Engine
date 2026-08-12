import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import type { Candle } from '../../src/models/price/Candle.js'

type Obs = { id: string; status: string; expectedAt?: string; expected?: { direction: 'long' | 'short' | null; signalPresent: boolean } }
type Match = { rows: Obs[] }
const observations = (JSON.parse(readFileSync('ci-results/reversal-observation-match-2026-07-31.json', 'utf8')) as Match).rows
	.filter((x) => x.status === 'matched' && x.expectedAt && x.expected?.signalPresent && x.expected.direction)
const CACHE = process.env.CACHE_DIR ?? '.cache/binance', OUT = process.env.OUT_DIR ?? 'ci-results'
const FROM = Date.UTC(2026, 5, 25), UNTIL = Date.UTC(2026, 7, 1)
const tfById = (id: string) => id.startsWith('btc') ? (id.includes('12') || id.includes('13') ? '15m' : '1h') : id.startsWith('eth') ? '1h' : id.includes('30m') ? '30m' : '5m'
const symbolById = (id: string) => id.startsWith('btc') ? 'BTCUSDT' : id.startsWith('eth') ? 'ETHUSDT' : 'SOLUSDT'
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(mean(x.map((v) => (v - m) ** 2))) }
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
function ema(x: number[], n: number) { const out = new Array<number>(x.length).fill(NaN), a = 2 / (n + 1); let v = x[0] ?? NaN; for (let i = 0; i < x.length; i++) { v = i === 0 ? x[i]! : a * x[i]! + (1 - a) * v; out[i] = v } return out }
function rsi(c: Candle[], n: number) { const out = new Array<number>(c.length).fill(NaN); for (let i = n; i < c.length; i++) { const a = []; for (let j = i - n + 1; j <= i; j++) a.push(c[j]!.close / c[j - 1]!.close - 1); const u = mean(a.map((v) => Math.max(0, v))), d = mean(a.map((v) => Math.max(0, -v))); out[i] = d === 0 ? 100 : 100 - 100 / (1 + u / d) } return out }
function stoch(c: Candle[], n: number) { return c.map((x, i) => { if (i < n - 1) return NaN; const a = c.slice(i - n + 1, i + 1), lo = Math.min(...a.map((z) => z.low)), hi = Math.max(...a.map((z) => z.high)); return 100 * (x.close - lo) / Math.max(1e-12, hi - lo) }) }
function mfi(c: Candle[], n: number) { const t = c.map((x) => (x.high + x.low + x.close) / 3); return c.map((_, i) => { if (i < n - 1) return NaN; let p = 0, q = 0; for (let j = i - n + 2; j <= i; j++) { const f = t[j]! * c[j]!.volume; if (t[j]! >= t[j - 1]!) p += f; else q += f } return q === 0 ? 100 : 100 - 100 / (1 + p / q) }) }
function volumePressure(c: Candle[], n: number) { return c.map((x, i) => { if (i < n) return NaN; const a = c.slice(i - n, i), m = mean(a.map((z) => z.volume)), s = sd(a.map((z) => z.volume)); const signed = x.close === x.open ? 0 : x.close > x.open ? 1 : -1; return 50 + 12.5 * clamp(signed * (x.volume - m) / Math.max(1e-12, s), -4, 4) }) }
function volatilityFear(c: Candle[], n: number) { const tr = c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))); return tr.map((v, i) => { if (i < n) return NaN; const a = tr.slice(i - n, i), m = mean(a), s = sd(a); const z = clamp((v - m) / Math.max(1e-12, s), -4, 4); const dir = c[i]!.close >= c[i]!.open ? 1 : -1; return 50 + 12.5 * dir * z }) }
function rangePosition(c: Candle[], n: number) { return c.map((x, i) => { if (i < n - 1) return NaN; const a = c.slice(i - n + 1, i + 1), lo = Math.min(...a.map((z) => z.low)), hi = Math.max(...a.map((z) => z.high)); return 100 * (x.close - lo) / Math.max(1e-12, hi - lo) }) }
type Config = { weights: [number, number, number, number, number]; smooth: number; low: number; high: number; cooldown: number; cross: boolean }
const configs: Config[] = []
for (const weights of [[1,1,1,1,1],[2,2,1,1,1],[1,1,1,2,2]] as Config['weights'][]) for (const smooth of [5,8,13]) for (const low of [25,30]) for (const high of [70,75]) for (const cooldown of [16,32]) for (const cross of [true]) configs.push({weights,smooth,low,high,cooldown,cross})
const componentCache = new WeakMap<Candle[], number[][]>()
function components(c: Candle[]) {
	const cached = componentCache.get(c)
	if (cached) return cached
	const value = [rsi(c,14), stoch(c,14), mfi(c,14), volumePressure(c,20), rangePosition(c,28)]
	componentCache.set(c, value)
	return value
}
function score(c: Candle[], p: Config) {
	const parts = components(c)
	const raw = c.map((_, i) => { const vals = parts.map((a) => a[i]!); if (vals.some((v) => !Number.isFinite(v))) return NaN; const w = p.weights; return vals.reduce((s,v,j) => s + v*w[j]!,0) / w.reduce((a,b) => a+b,0) })
	const finiteStart = raw.findIndex(Number.isFinite); if (finiteStart < 0) return raw
	const padded = raw.map((v) => Number.isFinite(v) ? v : raw[finiteStart]!); return ema(padded,p.smooth).map((v,i) => i < finiteStart ? NaN : v)
}
function detect(c: Candle[], p: Config) {
	const s = score(c,p), out: Array<{at:number;dir:'long'|'short';score:number}> = []; let armedLong=false,armedShort=false,lastLong=-Infinity,lastShort=-Infinity
	for(let i=1;i<c.length;i++) { const x=c[i]!,v=s[i]!,pv=s[i-1]!; if(!Number.isFinite(v)||!Number.isFinite(pv))continue; if(v<=p.low)armedLong=true; if(v>=p.high)armedShort=true; const bull=x.close>x.open,bear=x.close<x.open; const longRelease=p.cross?pv<=p.low&&v>p.low:v>pv; const shortRelease=p.cross?pv>=p.high&&v<p.high:v<pv; if(armedLong&&bull&&longRelease&&i-lastLong>=p.cooldown){out.push({at:x.timestamp,dir:'long',score:v});lastLong=i;armedLong=false} if(armedShort&&bear&&shortRelease&&i-lastShort>=p.cooldown){out.push({at:x.timestamp,dir:'short',score:v});lastShort=i;armedShort=false} if(v>=50)armedLong=false;if(v<=50)armedShort=false }
	return out
}
const groups=new Map<string,Obs[]>();for(const o of observations){const k=`${symbolById(o.id)}|${tfById(o.id)}`;groups.set(k,[...(groups.get(k)??[]),o])}
const datasets=[] as Array<{symbol:string;tf:string;c:Candle[];obs:Obs[]}>[]
for(const [k,obs] of groups){const [symbol,tf]=k.split('|');const c=await fetchArchiveKlines(symbol!,tf!,'spot',FROM,UNTIL,{cacheDir:CACHE,parallel:10});if(c.length)datasets.push({symbol:symbol!,tf:tf!,c,obs})}
const sol=await fetchArchiveKlines('SOLUSDT','5m','spot',FROM,UNTIL,{cacheDir:CACHE,parallel:10});const neg={from:Date.parse('2026-07-19T07:00:00Z'),to:Date.parse('2026-07-20T16:00:00Z')}
const results=[] as any[]
for(const p of configs){let n=0,hit=0,total=0;for(const d of datasets){const sig=detect(d.c,p),step=d.c[1]!.timestamp-d.c[0]!.timestamp;n+=d.obs.length;total+=sig.length;for(const o of d.obs)if(sig.some((x)=>x.dir===o.expected!.direction&&Math.abs(x.at-Date.parse(o.expectedAt!))<=step))hit++}const ns=detect(sol,p).filter((x)=>x.at>=neg.from&&x.at<=neg.to).length;results.push({...p,n,hit,recall:n?hit/n:0,totalSignals:total,noSignalWindowSignals:ns,utility:hit-2*ns})}
const ranked=results.sort((a,b)=>b.utility-a.utility||b.hit-a.hit||a.noSignalWindowSignals-b.noSignalWindowSignals).slice(0,50)
const md=`# Reversal composite OHLCV Fear/Greed scan v0.1\n\n- Components: RSI14, Stochastic14, MFI14, signed volume pressure, rolling-range position.\n- All components use standard chart OHLCV only.\n- Composite is EMA-smoothed, arms in an extreme, releases on recovery/crossover, requires a directional candle and side cooldown.\n- Positive events: ${observations.length}; negative window is approximate SOL 5m visible segment.\n- Production defaults changed: **NO**.\n\n| Weights | Smooth | Low/High | Cooldown | Cross | Hits | Recall | Negative-window signals | Utility |\n|---|---:|---:|---:|---|---:|---:|---:|---:|\n${ranked.map(x=>`| ${x.weights.join('/')} | ${x.smooth} | ${x.low}/${x.high} | ${x.cooldown} | ${x.cross?'Y':'N'} | ${x.hit}/${x.n} | ${(100*x.recall).toFixed(1)}% | ${x.noSignalWindowSignals} | ${x.utility} |`).join('\n')}\n\n## Decision rule\n\nNo candidate is accepted solely by this table. A useful candidate must have materially better recall than the rejected edge/state families, near-zero signals in the confirmed no-signal window, and then survive an untouched symbol/TF.\n`
mkdirSync(OUT,{recursive:true});writeFileSync(`${OUT}/reversal-composite-fear-greed-v0.1.json`,JSON.stringify({meta:{from:FROM,until:UNTIL,negativeWindow:neg,components:['rsi14','stoch14','mfi14','volumePressure20','rangePosition28']},ranked,results},null,2));writeFileSync(`${OUT}/reversal-composite-fear-greed-v0.1.md`,md);console.log(md)
