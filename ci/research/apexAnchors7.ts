// Финальная cross-symbol проверка Zonda Apex: BTC 5m/15m/4h + ETH 1h.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
const CACHE=process.env.CACHE_DIR??'.cache/binance', OUT=process.env.OUT_DIR??'ci-results'
type Tf='5m'|'15m'|'1h'|'4h'; type C={t:number,o:number,h:number,l:number,c:number};
type A={id:string,symbol:'BTCUSDT'|'ETHUSDT',tf:Tf,t:number,day:string,mean:number,up:number,dn:number}
const A:A[]=[
{id:'BTC5-20',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,20,12),day:'20.07',mean:64250.82,up:64835.88,dn:63671.03},
{id:'BTC4h-20',symbol:'BTCUSDT',tf:'4h',t:Date.UTC(2026,6,20,12),day:'20.07',mean:63533.87,up:67351.71,dn:59932.45},
{id:'BTC5-28a',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,28,8),day:'28.07',mean:63385.64,up:63764.37,dn:63009.16},
{id:'BTC4h-28a',symbol:'BTCUSDT',tf:'4h',t:Date.UTC(2026,6,28,8),day:'28.07',mean:64805.28,up:68107.36,dn:61663.29},
{id:'BTC5-28b',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,28,16),day:'28.07',mean:63400.23,up:63959.28,dn:62846.06},
{id:'BTC4h-28b',symbol:'BTCUSDT',tf:'4h',t:Date.UTC(2026,6,28,16),day:'28.07',mean:64818.43,up:68110.28,dn:61685.69},
{id:'BTC5-29a',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,29,6,40),day:'29.07',mean:63906.09,up:64394.55,dn:63421.32},
{id:'BTC5-29b',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,29,6,50),day:'29.07',mean:63912.68,up:64398.78,dn:63430.26},
{id:'BTC5-29c',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,29,6,55),day:'29.07',mean:63916.51,up:64401.12,dn:63435.55},
{id:'BTC5-29d',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,29,7),day:'29.07',mean:63920.66,up:64403.55,dn:63441.39},
{id:'BTC5-29e',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,29,7,5),day:'29.07',mean:63925.13,up:64406.18,dn:63447.67},
{id:'BTC5-29f',symbol:'BTCUSDT',tf:'5m',t:Date.UTC(2026,6,29,7,10),day:'29.07',mean:63929.92,up:64409.01,dn:63454.39},
// Скрин BTC m15: 27.07 19:30 UTC+5 = 14:30 UTC.
{id:'BTC15-cross',symbol:'BTCUSDT',tf:'15m',t:Date.UTC(2026,6,27,14,30),day:'cross',mean:65150.76,up:65836.23,dn:64472.44},
// Скрин ETH 1h: 28.07 08:00 UTC+5 = 03:00 UTC.
{id:'ETH1h-cross',symbol:'ETHUSDT',tf:'1h',t:Date.UTC(2026,6,28,3),day:'cross',mean:1899.35,up:1955.86,dn:1844.46},
]
const BASE='https://data.binance.vision/data/spot'; const months:string[]=[]
for(const m of [9,10,11,12])months.push(`2025-${String(m).padStart(2,'0')}`)
for(const m of [1,2,3,4,5,6])months.push(`2026-${String(m).padStart(2,'0')}`)
const days=Array.from({length:29},(_,i)=>`2026-07-${String(i+1).padStart(2,'0')}`)
async function cached(u:string){const f=`${CACHE}/${u.split('/').pop()!}`;if(existsSync(f))return f;const r=await fetch(u);if(!r.ok)return null;writeFileSync(f,Buffer.from(await r.arrayBuffer()));return f}
function unzip(f:string){const z=execFileSync('unzip',['-p',f],{maxBuffer:1<<28}).toString(),a:C[]=[];for(const l of z.split('\n')){const p=l.split(',');let t=Number(p[0]);if(!Number.isFinite(t)||p.length<5)continue;if(t>1e14)t=Math.floor(t/1000);a.push({t,o:Number(p[1]),h:Number(p[2]),l:Number(p[3]),c:Number(p[4])})}return a}
async function load(sym:string,tf:Tf){const all:C[]=[];for(const m of months){const f=await cached(`${BASE}/monthly/klines/${sym}/${tf}/${sym}-${tf}-${m}.zip`);if(f)all.push(...unzip(f))}for(const d of days){const f=await cached(`${BASE}/daily/klines/${sym}/${tf}/${sym}-${tf}-${d}.zip`);if(f)all.push(...unzip(f))}const q=new Map<number,C>();for(const c of all)q.set(c.t,c);return [...q.values()].sort((x,y)=>x.t-y.t)}
function weights(n:number,off:number,sig:number){const w=new Float64Array(n),m=off*(n-1),s=n/sig;let d=0;for(let j=0;j<n;j++){w[j]=Math.exp(-((j-m)**2)/(2*s*s));d+=w[j]!}for(let j=0;j<n;j++)w[j]=w[j]!/d;return w}
function dot(x:number[],i:number,w:Float64Array){if(i+1<w.length)return NaN;let s=0;for(let j=0;j<w.length;j++)s+=w[j]!*x[i-(w.length-1)+j]!;return s}
const target=(a:A)=>(Math.log(a.up/a.mean)+Math.log(a.mean/a.dn))/(2*5.6), pct=(x:number,y:number)=>(x/y-1)*100, f=(x:number)=>x.toFixed(3)
type S={c:C[],hlc3:number[],tr:number[],hl:number[]};
async function main(){mkdirSync(CACHE,{recursive:true});mkdirSync(OUT,{recursive:true});const keys=[...new Set(A.map(a=>`${a.symbol}:${a.tf}`))],ss=new Map<string,S>();for(const k of keys){const [sym,tf]=k.split(':') as [string,Tf],c=await load(sym,tf),tr=c.map((x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-c[i-1]!.c),Math.abs(x.l-c[i-1]!.c)):x.h-x.l);ss.set(k,{c,hlc3:c.map(x=>(x.h+x.l+x.c)/3),tr,hl:c.map(x=>x.h-x.l)});console.log(k,c.length)}
const ix=new Map<string,number>();for(const a of A){const i=ss.get(`${a.symbol}:${a.tf}`)!.c.findIndex(x=>x.t===a.t);if(i<0)throw new Error(`нет бара ${a.id} ${new Date(a.t).toISOString()}`);ix.set(a.id,i)}
const mw=weights(200,.85,6), seq=A.filter(a=>a.id.startsWith('BTC5-29')),trendT=pct(target(seq.at(-1)!),target(seq[0]!));let md='# Zonda Apex — финальная cross-symbol калибровка v7\n\n';md+=`- прогон ${process.env.GITHUB_RUN_ID??'local'}, ${new Date().toISOString()}\n- внешний контроль: BTC 15m + ETH 1h\n- пороги до прогона: max по всем <=3%; cross <=3%; ошибка наклона <=1 п.п.\n\n## 1. Средняя ALMA(hlc3,200) и цели\n\n| якорь | s | ошибка mean % |\n|---|---:|---:|\n`;for(const a of A){const s=ss.get(`${a.symbol}:${a.tf}`)!,i=ix.get(a.id)!;md+=`| ${a.id} | ${target(a).toFixed(6)} | ${f(pct(dot(s.hlc3,i,mw),a.mean))} |\n`}
type R={kind:string,norm:string,n:number,off:number,sig:number,max:number,cross:number,trend:number,errs:number[]};const rs:R[]=[];for(let n=80;n<=400;n+=2)for(let oi=20;oi<=40;oi++){const off=oi/40;for(let gi=4;gi<=24;gi++){const sig=gi/2,w=weights(n,off,sig);for(const kind of ['tr','hl'])for(const norm of ['close','mean','own']){let max=0,cross=0;const vals:number[]=[],errs:number[]=[];for(const a of A){const s=ss.get(`${a.symbol}:${a.tf}`)!,i=ix.get(a.id)!,abs=dot(kind==='tr'?s.tr:s.hl,i,w);let v=abs;if(norm==='close')v/=s.c[i]!.c;else if(norm==='mean')v/=dot(s.hlc3,i,mw);else{const rel=(kind==='tr'?s.tr:s.hl).map((x,j)=>x/s.c[j]!.c);v=dot(rel,i,w)}const e=pct(v,target(a));errs.push(e);vals.push(v);max=Math.max(max,Math.abs(e));if(a.day==='cross')cross=Math.max(cross,Math.abs(e))}if(max<=15){const qi=A.findIndex(a=>a.id===seq[0]!.id),qj=A.findIndex(a=>a.id===seq.at(-1)!.id),trend=pct(vals[qj]!,vals[qi]!);rs.push({kind,norm,n,off,sig,max,cross,trend,errs})}}}}
rs.sort((a,b)=>a.max-b.max);const accepted=rs.filter(r=>r.max<=3&&r.cross<=3&&Math.abs(r.trend-trendT)<=1);function table(xs:R[]){let z='|#|мера|нормировка|n|offset|sigma|max %|cross %|наклон %|ошибка наклона п.п.|\n|---:|---|---|---:|---:|---:|---:|---:|---:|---:|\n';xs.slice(0,30).forEach((r,i)=>z+=`|${i+1}|${r.kind}|${r.norm}|${r.n}|${r.off}|${r.sig}|${f(r.max)}|${f(r.cross)}|${f(r.trend)}|${f(r.trend-trendT)}|\n`);return z}md+='\n## 2. Выполнили все три порога\n\n'+(accepted.length?table(accepted):'Нет.\n');md+='\n## 3. Лучшие по всем 14 якорям\n\n'+table(rs);md+='\n## 4. Внешние ошибки лучшего\n\n';const b=rs[0];if(b){A.forEach((a,i)=>md+=`- ${a.id}: ${f(b.errs[i]!)}%\n`);md+=`\n**Вердикт:** ${b.kind}/${b.norm}/${b.n}/${b.off}/${b.sig}; max ${f(b.max)}%, cross ${f(b.cross)}%, наклон ${f(b.trend-trendT)} п.п.; ${accepted.length?'ПРИНЯТО':'НЕ ПРИНЯТО'}.\n`}writeFileSync(`${OUT}/apex-anchors7.md`,md);console.log('готово',rs.length,accepted.length)}
await main()
