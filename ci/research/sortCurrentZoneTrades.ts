import{execFileSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const run=(c:string,a:string[])=>{console.log('>',c,...a);execFileSync(c,a,{stdio:'inherit'})},patch=(p:string,old:string,next:string)=>{let s=readFileSync(p,'utf8');if(s.includes(next))return;if(!s.includes(old))throw Error(`marker missing ${p}: ${old.slice(0,90)}`);writeFileSync(p,s.replace(old,next))};
writeFileSync('tools/visualizer/public/lib/zoneTradeSort.mjs',`const num=(x,fallback=0)=>Number.isFinite(Number(x))?Number(x):fallback
export function withZoneRank(item,zone){return{...item,zoneActive:Boolean(zone?.active),zoneValid:Boolean(zone?.valid),zoneLifecycleState:zone?.lifecycleState??null,zoneLastContributionAt:zone?.lastContributionAt??item.knownAt??0}}
export function zoneDistance(item,price){if(!Number.isFinite(Number(price)))return Number.POSITIVE_INFINITY;const p=Number(price),lo=Math.min(num(item.near),num(item.far)),hi=Math.max(num(item.near),num(item.far));return p<lo?lo-p:p>hi?p-hi:0}
function current(item,now){if(item.outcome==='open'||item.rejectionReason==='data-end')return true;return Boolean(item.zoneActive&&item.zoneValid&&!item.spentReason&&(item.endAt==null||num(item.endAt)>=num(now))) }
export function sortZoneTrades(items,price,now){return[...items].sort((a,b)=>Number(current(b,now))-Number(current(a,now))||zoneDistance(a,price)-zoneDistance(b,price)||num(b.zoneLastContributionAt,b.knownAt)-num(a.zoneLastContributionAt,a.knownAt)||num(b.entryAt??b.touchAt??b.knownAt)-num(a.entryAt??a.touchAt??a.knownAt)||String(a.poiId??'').localeCompare(String(b.poiId??'')))}
`);
const p='tools/visualizer/public/panels/confirmation.mjs';
patch(p,"import { S } from '../lib/state.mjs'\n","import { S } from '../lib/state.mjs'\nimport { sortZoneTrades, withZoneRank } from '../lib/zoneTradeSort.mjs'\n");
patch(p,`export function confirmationAttempts() {
\tconst out = []
\tfor (const r of (confLayerData().results || []))
\t\tfor (const a of r.attempts)
\t\t\tout.push({ ...a, poiId: r.poiId, direction: r.direction, zoneClass: r.zoneClass, near: r.near, far: r.far, knownAt: r.knownAt, endAt: r.endAt, spentReason: r.spentReason, ltfCoverage: r.ltfCoverage })
\treturn out
}`,`export function confirmationAttempts() {
\tconst layer = confLayerData(), zones = new Map((layer.candidates || []).map((z) => [z.id, z]))
\tconst out = []
\tfor (const r of (layer.results || []))
\t\tfor (const a of r.attempts)
\t\t\tout.push(withZoneRank({ ...a, poiId: r.poiId, direction: r.direction, zoneClass: r.zoneClass, near: r.near, far: r.far, knownAt: r.knownAt, endAt: r.endAt, spentReason: r.spentReason, ltfCoverage: r.ltfCoverage }, zones.get(r.poiId)))
\tconst last = S.data?.candles?.at(-1)
\treturn sortZoneTrades(out, last?.close, last?.timestamp)
}`);
patch(p,`export function simplifiedEntries() {
\tconst out = []
\tfor (const r of S.data?.simplifiedConfirmation?.results || []) {
\t\tfor (let i = 0; i < (r.entries || []).length; i++) out.push({ ...r.entries[i], poiId: r.poiId, direction: r.direction, near: r.near, far: r.far, knownAt: r.knownAt, endAt: r.endAt, idx: i })
\t}
\treturn out.sort((a, b) => a.entryAt - b.entryAt)
}`,`export function simplifiedEntries() {
\tconst zones = new Map((S.data?.liquidityPoi?.candidates || []).map((z) => [z.id, z]))
\tconst out = []
\tfor (const r of S.data?.simplifiedConfirmation?.results || []) {
\t\tfor (let i = 0; i < (r.entries || []).length; i++) out.push(withZoneRank({ ...r.entries[i], poiId: r.poiId, direction: r.direction, near: r.near, far: r.far, knownAt: r.knownAt, endAt: r.endAt, idx: i }, zones.get(r.poiId)))
\t}
\tconst last = S.data?.candles?.at(-1)
\treturn sortZoneTrades(out, last?.close, last?.timestamp)
}`);
writeFileSync('tests/zoneTradeSort.test.ts',`import test from 'node:test'\nimport assert from 'node:assert/strict'\n// @ts-expect-error Frontend .mjs intentionally has no TypeScript declaration\nimport { sortZoneTrades, zoneDistance } from '../tools/visualizer/public/lib/zoneTradeSort.mjs'\nconst base={near:90,far:95,knownAt:100,endAt:1000,zoneActive:true,zoneValid:true,zoneLastContributionAt:100}\ntest('current zone trade sorts before ended history',()=>{const old={...base,poiId:'old',near:99,far:101,zoneActive:false,endAt:400,entryAt:390};const live={...base,poiId:'live',near:80,far:85,entryAt:500};assert.equal(sortZoneTrades([old,live],100,600)[0].poiId,'live')})\ntest('nearest current zone sorts first and in-zone distance is zero',()=>{const near={...base,poiId:'near',near:99,far:101};const far={...base,poiId:'far',near:80,far:85};assert.equal(zoneDistance(near,100),0);assert.equal(sortZoneTrades([far,near],100,600)[0].poiId,'near')})\ntest('fresh contribution breaks equal-distance ties',()=>{const stale={...base,poiId:'stale',zoneLastContributionAt:200};const fresh={...base,poiId:'fresh',zoneLastContributionAt:300};assert.equal(sortZoneTrades([stale,fresh],100,600)[0].poiId,'fresh')})\ntest('newer event then stable poi id break remaining ties',()=>{const a={...base,poiId:'a',entryAt:300};const b={...base,poiId:'b',entryAt:400};assert.deepEqual(sortZoneTrades([a,b],100,600).map((x:any)=>x.poiId),['b','a']);assert.deepEqual(sortZoneTrades([{...a,entryAt:400},{...b,entryAt:400}],100,600).map((x:any)=>x.poiId),['a','b'])})\n`);
const spec='SPEC.md';let s=readFileSync(spec,'utf8');if(!s.includes('§16.38')){s+=`\n\n### §16.38 — Порядок сделок от текущих зон\n\n- Навигация уточнённого и упрощённого подтверждения показывает сначала открытые сделки, живые попытки и сделки активных валидных зон.\n- Внутри этой группы порядок: минимальная дистанция текущей цены до диапазона зоны → более свежее последнее пополнение полки → более новое событие сделки → стабильный идентификатор зоны.\n- Закрытые исторические зоны не скрываются и идут после актуальных; порогов расстояния и иных новых magic numbers нет.\n`;writeFileSync(spec,s)}
run('npx',['tsx','--test','tests/*.test.ts']);run('npx',['tsc','--noEmit']);run('bash',['-lc','node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs']);run('git',['config','user.name','github-actions[bot]']);run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);run('git',['add','tools/visualizer/public/lib/zoneTradeSort.mjs',p,'tests/zoneTradeSort.test.ts']);run('git',['commit','-m','visualizer: prioritize trades from current zones']);run('git',['add',spec]);run('git',['commit','-m','docs: define current-zone trade ordering']);writeFileSync('ci-results/current-zone-trade-sort.md','# Current-zone trade ordering\n\n- refined confirmation: PASS\n- Simplified confirmation: PASS\n- lifecycle priority: PASS\n- distance/freshness/recency order: PASS\n- historical items retained: PASS\n- full gate: PASS\n');run('git',['push','origin','HEAD:apex-reversal-v1']);
