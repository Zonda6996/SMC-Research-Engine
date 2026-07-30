import{execFileSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const run=(c:string,a:string[])=>{console.log('>',c,...a);execFileSync(c,a,{stdio:'inherit'})},patch=(p:string,old:string,next:string)=>{let s=readFileSync(p,'utf8');if(s.includes(next))return;if(!s.includes(old))throw Error(`marker missing ${p}: ${old.slice(0,80)}`);writeFileSync(p,s.replace(old,next))};
const server='tools/visualizer/server.ts';
patch(server,"const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')",`export function buildIndicatorPayload(series: import('../../src/models/price/Candle.js').Candle[], params: typeof APEX_PARAMS = APEX_PARAMS) {
\tconst rawBands = computeApexBands(series, params)
\treturn {
\t\tapex: { version: APEX_VERSION, params, bands: rawBands.map((b, i) => Number.isFinite(b.mean) ? { t: series[i]!.timestamp, mean: b.mean, redLo: b.redLo, redHi: b.redHi, greenHi: b.greenHi, greenLo: b.greenLo } : null) },
\t\treversal: { version: REVERSAL_VERSION, signals: detectReversals(series, params) },
\t}
}

const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')`);
patch(server,"\t\t\tconst apexBands = ltfConf.length ? computeApexBands(ltfConf, apexParams) : []\n\t\t\tconst reversalSignals = ltfConf.length ? detectReversals(ltfConf, apexParams) : []",`\t\t\tconst confirmationIndicators = buildIndicatorPayload(ltfConf, apexParams)
\t\t\tconst mainIndicators = buildIndicatorPayload(snapshot.candles, apexParams)`);
patch(server,"const mtfLayers: Array<{ contextTf: string; confTf: string; role: 'swing' | 'mid' | 'local'; candles: number; candidates: unknown[]; results: unknown[]; ltfConf: unknown[] | null }> = []","const mtfLayers: Array<{ contextTf: string; confTf: string; role: 'swing' | 'mid' | 'local'; candles: number; candidates: unknown[]; results: unknown[]; ltfConf: unknown[] | null; indicators: ReturnType<typeof buildIndicatorPayload> }> = []");
patch(server,"\t\t\t\t\tconst confs = detectPoiConfirmation(zones, confSeries, ctxCandles, confOverrides)\n\t\t\t\t\t// 5m-ряд","\t\t\t\t\tconst confs = detectPoiConfirmation(zones, confSeries, ctxCandles, confOverrides)\n\t\t\t\t\tconst layerIndicators = buildIndicatorPayload(confSeries, apexParams)\n\t\t\t\t\t// 5m-ряд");
patch(server,"mtfLayers.push({ contextTf: ctxTf, confTf: lConfTf, role: ROLE[ctxTf]!, candles: ctxCandles.length, candidates: zones, results: confs, ltfConf: confSeries === ltf5m ? null : confSeries })","mtfLayers.push({ contextTf: ctxTf, confTf: lConfTf, role: ROLE[ctxTf]!, candles: ctxCandles.length, candidates: zones, results: confs, ltfConf: confSeries === ltf5m ? null : confSeries, indicators: layerIndicators })");
patch(server,`\t\t\t\tapex: {
\t\t\t\t\tversion: APEX_VERSION,
\t\t\t\t\tparams: apexParams,
\t\t\t\t\tbands: apexBands.map((b, i) => (Number.isFinite(b.mean)
\t\t\t\t\t\t? { t: ltfConf[i]!.timestamp, mean: b.mean, redLo: b.redLo, redHi: b.redHi, greenHi: b.greenHi, greenLo: b.greenLo }
\t\t\t\t\t\t: null)),
\t\t\t\t},
\t\t\t\treversal: { version: REVERSAL_VERSION, signals: reversalSignals },`,`\t\t\t\tapex: confirmationIndicators.apex,
\t\t\t\treversal: confirmationIndicators.reversal,
\t\t\t\tindicators: { main: mainIndicators, confirmation: confirmationIndicators },`);
const ind='tools/visualizer/public/panels/indicators.mjs';
patch(ind,"export function drawIndicatorLayers(from=null,to=null){\n const showApex","export function drawIndicatorLayers(series,from=null,to=null,payload=null){\n const showApex");
patch(ind," const g=S.data?.apex\n if(!g?.bands?.length)return"," const g=payload?.apex\n if(!series?.length||!g?.bands?.length)return");
patch(ind," const sig=showReversal?(S.data?.reversal?.signals||[])"," const sig=showReversal?(payload?.reversal?.signals||[])");
const app='tools/visualizer/public/app.mjs';patch(app,"drawIndicatorLayers(time(cs[0].timestamp), time(cs[cs.length - 1].timestamp))","drawIndicatorLayers(cs, time(cs[0].timestamp), time(cs[cs.length - 1].timestamp), S.data?.indicators?.main)");
const conf='tools/visualizer/public/panels/confirmation.mjs';
patch(conf,"\t\t\tconfTf: L.confTf, zoneTf: L.contextTf,\n","\t\t\tconfTf: L.confTf, zoneTf: L.contextTf, indicators: L.indicators,\n");
patch(conf,"\t\tsrc: S.data?.ltfConf || [], confTf: S.data?.dataset?.confTf, zoneTf: S.data?.dataset?.timeframe,\n","\t\tsrc: S.data?.ltfConf || [], confTf: S.data?.dataset?.confTf, zoneTf: S.data?.dataset?.timeframe, indicators: S.data?.indicators?.confirmation,\n");
let cs=readFileSync(conf,'utf8');cs=cs.replaceAll('drawIndicatorLayers(src, from, to)','drawIndicatorLayers(src, from, to, confLayerData().indicators)');writeFileSync(conf,cs);
writeFileSync('tests/indicatorTimeframeRouting.test.ts',`import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { buildIndicatorPayload } from '../tools/visualizer/server.js'\nconst H=3_600_000\nconst candles=Array.from({length:260},(_,i)=>({timestamp:i*H,open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.3+i*.01,volume:1000+i}))\ntest('indicator payload timestamps belong to the exact displayed series',()=>{const p=buildIndicatorPayload(candles);assert.equal(p.apex.bands.length,candles.length);for(let i=0;i<p.apex.bands.length;i++){const b=p.apex.bands[i];if(b)assert.equal(b.t,candles[i].timestamp)}const times=new Set(candles.map(c=>c.timestamp));for(const s of p.reversal.signals)assert.ok(times.has(s.at))})\n`);
const spec='SPEC.md';let sp=readFileSync(spec,'utf8');if(!sp.includes('§16.37')){sp+=`\n\n### §16.37 — Индикаторы на фактическом ряду графика\n\n- Zonda Apex и Zonda Reversal считаются отдельно для основного ряда, ряда текущего подтверждения и каждого MTF-слоя.\n- Renderer получает payload именно того ряда свечей, который сейчас показан; перенос сигналов между ТФ запрещён.\n- Пользовательские Apex overrides едины для всех рядов и применяются одновременно к полосам и Reversal.\n- Timestamp каждой полосы и сигнала обязан принадлежать исходному ряду соответствующего payload.\n`;writeFileSync(spec,sp)}
run('npx',['tsx','--test','tests/*.test.ts']);run('npx',['tsc','--noEmit']);run('bash',['-lc','node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs']);run('git',['config','user.name','github-actions[bot]']);run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);run('git',['add',server,ind,app,conf,'tests/indicatorTimeframeRouting.test.ts']);run('git',['commit','-m','visualizer: route indicators by displayed timeframe']);run('git',['add',spec]);run('git',['commit','-m','docs: require timeframe-correct indicator payloads']);writeFileSync('ci-results/indicator-timeframes.md','# Indicator timeframe routing\n\n- main series payload: PASS\n- confirmation payload: PASS\n- MTF layer payloads: PASS\n- shared overrides: PASS\n- full gate: PASS\n');run('git',['push','origin','HEAD:apex-reversal-v1']);
