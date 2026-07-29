import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const R=process.cwd(), rd=(p:string)=>readFileSync(join(R,p),'utf8'), wr=(p:string,s:string)=>writeFileSync(join(R,p),s)
const run=(c:string,a:string[])=>{console.log('$',c,...a);execFileSync(c,a,{cwd:R,stdio:'inherit'})}
function one(s:string,a:string,b:string,n:string){if(!s.includes(a))throw Error('не найдено: '+n);return s.replace(a,b)}

// ENGINE: source is a real input, canonical default remains hlc3.
let e=rd('src/core/signals/ApexEngine.ts')
e=one(e,"export const APEX_VERSION = 'apex-1.0-calibrated-log-alma'","export const APEX_VERSION = 'apex-1.1-tv-settings'",'version')
e=one(e,'export interface ApexParams {\n\tlookback: number','export interface ApexParams {\n\t/** Источник средней как в TradingView; канон калибровки — hlc3. */\n\tsource: \'hlc3\' | \'close\' | \'hl2\' | \'ohlc4\'\n\tlookback: number','source type')
e=one(e,'export const APEX_PARAMS: ApexParams = {\n\tlookback: 200,','export const APEX_PARAMS: ApexParams = {\n\tsource: \'hlc3\',\n\tlookback: 200,','source default')
e=one(e,"const hlc3 = (c: Candle): number => (c.high + c.low + c.close) / 3","const sourceValue = (c: Candle, source: ApexParams['source']): number => {\n\tif (source === 'close') return c.close\n\tif (source === 'hl2') return (c.high + c.low) / 2\n\tif (source === 'ohlc4') return (c.open + c.high + c.low + c.close) / 4\n\treturn (c.high + c.low + c.close) / 3\n}",'source helper')
e=one(e,'const mean = alma(candles.map(hlc3), p.lookback, p.meanOffset, p.meanSigma)','const mean = alma(candles.map((c) => sourceValue(c, p.source)), p.lookback, p.meanOffset, p.meanSigma)','source use')
wr('src/core/signals/ApexEngine.ts',e)
let et=rd('tests/apexEngine.test.ts').replace("'apex-1.0-calibrated-log-alma'","'apex-1.1-tv-settings'")
et=one(et,'assert.equal(APEX_PARAMS.lookback, 200)','assert.equal(APEX_PARAMS.source, \'hlc3\')\n\tassert.equal(APEX_PARAMS.lookback, 200)','source test')
wr('tests/apexEngine.test.ts',et)

// SERVER: validated Apex overrides, separate from general numeric engine config.
let sv=rd('tools/visualizer/server.ts')
sv=one(sv,'\tconfConfig?: string | undefined\n}',"\tconfConfig?: string | undefined\n\tapexConfig?: string | undefined\n}",'query type')
sv=one(sv,"\t\tconfConfig: params.get('confConfig') ?? undefined,\n\t}","\t\tconfConfig: params.get('confConfig') ?? undefined,\n\t\tapexConfig: params.get('apexConfig') ?? undefined,\n\t}",'query parse')
const marker='const FIXTURE_PATH = join(__dirname, \'../../tests/fixtures/btcusdt-15m-500.json\')'
sv=one(sv,marker,`function pickApexOverrides(rawJson: string | undefined): Partial<typeof APEX_PARAMS> {
\tif (!rawJson) return {}
\tlet x: unknown
\ttry { x = JSON.parse(rawJson) } catch { return {} }
\tif (x == null || typeof x !== 'object') return {}
\tconst r = x as Record<string, unknown>, out: Record<string, unknown> = {}
\tif (['hlc3', 'close', 'hl2', 'ohlc4'].includes(String(r.source))) out.source = r.source
\tfor (const k of ['lookback', 'kInner', 'kOuter']) {
\t\tconst v = r[k]
\t\tif (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
\t}
\treturn out as Partial<typeof APEX_PARAMS>
}

${marker}`,'apex validator')
sv=one(sv,'\t\t\tconst confOverrides = pickNumericOverrides(POI_CONFIRMATION_CONFIG, q.confConfig)','\t\t\tconst confOverrides = pickNumericOverrides(POI_CONFIRMATION_CONFIG, q.confConfig)\n\t\t\tconst apexOverrides = pickApexOverrides(q.apexConfig)\n\t\t\tconst apexParams = { ...APEX_PARAMS, ...apexOverrides }','apex overrides')
sv=one(sv,'const apexBands = ltfConf.length ? computeApexBands(ltfConf) : []\n\t\t\tconst reversalSignals = ltfConf.length ? detectReversals(ltfConf) : []','const apexBands = ltfConf.length ? computeApexBands(ltfConf, apexParams) : []\n\t\t\tconst reversalSignals = ltfConf.length ? detectReversals(ltfConf, apexParams) : []','compute overrides')
sv=one(sv,'params: APEX_PARAMS,\n\t\t\t\t\tbands:','params: apexParams,\n\t\t\t\t\tbands:','payload params')
wr('tools/visualizer/server.ts',sv)

// New isolated UI state module.
wr('tools/visualizer/public/panels/indicators.mjs',`import { $ } from '../lib/format.mjs'
const KEY='smc-indicator-settings-v1'
const DEF={source:'hlc3',lookback:200,kInner:5.6,kOuter:9.6,priceLabels:true,
 meanOn:true,meanColor:'#6f8cff',redLoOn:true,redLoColor:'#e2607a',redHiOn:true,redHiColor:'#e2607a',
 greenHiOn:true,greenHiColor:'#3fb98a',greenLoOn:true,greenLoColor:'#3fb98a',upperFillOn:true,upperFillColor:'#e2607a',lowerFillOn:true,lowerFillColor:'#3fb98a',
 buyOn:true,buyColor:'#4ade80',sellOn:true,sellColor:'#f87171',riskMode:'standard'}
const ids=Object.keys(DEF)
function read(){try{return{...DEF,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return{...DEF}}}
function save(x){localStorage.setItem(KEY,JSON.stringify(x))}
export function indicatorStyle(){const x=read();for(const id of ids){const el=$(id);if(!el)continue;if(el.type==='checkbox')x[id]=el.checked;else if(el.type==='number')x[id]=Number(el.value);else x[id]=el.value}return x}
export function indicatorServerConfig(){const x=indicatorStyle();return{source:x.source,lookback:x.lookback,kInner:x.kInner,kOuter:x.kOuter}}
function put(x){for(const id of ids){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=Boolean(x[id]);else el.value=x[id]}}
export function wireIndicatorSettings(redraw){put(read());for(const id of ids){const el=$(id);if(!el)continue;el.onchange=()=>{save(indicatorStyle());if(!['source','lookback','kInner','kOuter'].includes(id))redraw()}}
 $('indicatorApply').onclick=()=>{save(indicatorStyle());document.dispatchEvent(new CustomEvent('viz:reload'))}
 $('indicatorReset').onclick=()=>{save({...DEF});put(DEF);document.dispatchEvent(new CustomEvent('viz:reload'))}
}
`)

// API and app wiring.
let api=rd('tools/visualizer/public/lib/api.mjs')
api=one(api,"import { engineOverrides } from '../panels/config.mjs'","import { engineOverrides } from '../panels/config.mjs'\nimport { indicatorServerConfig } from '../panels/indicators.mjs'",'api import')
api=one(api,'\tif (Object.keys(ov.conf).length) q.set(\'confConfig\', JSON.stringify(ov.conf))','\tif (Object.keys(ov.conf).length) q.set(\'confConfig\', JSON.stringify(ov.conf))\n\tq.set(\'apexConfig\', JSON.stringify(indicatorServerConfig()))','api apex query')
wr('tools/visualizer/public/lib/api.mjs',api)
let app=rd('tools/visualizer/public/app.mjs')
app=one(app,"import { renderConfigPanel, setEngineDefaults, wireConfigPanel } from './panels/config.mjs'","import { renderConfigPanel, setEngineDefaults, wireConfigPanel } from './panels/config.mjs'\nimport { wireIndicatorSettings } from './panels/indicators.mjs'",'app import')
app=one(app,'\twireConfigPanel()\n\twirePalette()','\twireConfigPanel()\n\twireIndicatorSettings(redraw)\n\twirePalette()','app wire')
wr('tools/visualizer/public/app.mjs',app)

// Chart fill primitive.
let ch=rd('tools/visualizer/public/lib/chart.mjs')
ch=one(ch,'export const zonesPrim = makeZonesPrimitive()','export const zonesPrim = makeZonesPrimitive()\nexport const apexPrim = makeApexPrimitive()','primitive export')
const before='/** Зона под курсором (для hover-карточки и клика-фокуса). */'
const prim=`function makeApexPrimitive() {
\tconst p={_bands:[],_opts:{},_ctx:null,attached(x){p._ctx=x},detached(){p._ctx=null},setBands(x,o={}){p._bands=x;p._opts=o;p._ctx?.requestUpdate?.()},paneViews(){return p._views}}
\tconst renderer={draw(target){const a=p._ctx;if(!a||p._bands.length<2)return;const ts=a.chart.timeScale();target.useBitmapCoordinateSpace(({context:c,horizontalPixelRatio:h,verticalPixelRatio:v})=>{const zone=(hi,lo,color,on)=>{if(!on)return;c.beginPath();let started=false;for(const b of p._bands){const x=ts.timeToCoordinate(b.t),y=a.series.priceToCoordinate(b[hi]);if(x==null||y==null)continue;c[!started?'moveTo':'lineTo'](x*h,y*v);started=true}for(let i=p._bands.length-1;i>=0;i--){const b=p._bands[i],x=ts.timeToCoordinate(b.t),y=a.series.priceToCoordinate(b[lo]);if(x!=null&&y!=null)c.lineTo(x*h,y*v)}if(started){c.closePath();c.fillStyle=color;c.globalAlpha=.11;c.fill();c.globalAlpha=1}};zone('redHi','redLo',p._opts.upperColor,p._opts.upperOn);zone('greenHi','greenLo',p._opts.lowerColor,p._opts.lowerOn)}})};p._views=[{renderer:()=>renderer}];return p
}

`
ch=one(ch,before,prim+before,'primitive implementation')
ch=one(ch,'\tcandlesSeries.attachPrimitive(zonesPrim)','\tcandlesSeries.attachPrimitive(zonesPrim)\n\tcandlesSeries.attachPrimitive(apexPrim)','attach primitive')
ch=one(ch,'\tzonesPrim.setRects([])','\tzonesPrim.setRects([])\n\tapexPrim.setBands([])','clear primitive')
wr('tools/visualizer/public/lib/chart.mjs',ch)

// Confirmation rendering from style state.
let cp=rd('tools/visualizer/public/panels/confirmation.mjs')
cp=one(cp,"import { zonesPrim, line,","import { zonesPrim, apexPrim, line,",'panel primitive import')
cp=one(cp,"import { S } from '../lib/state.mjs'","import { S } from '../lib/state.mjs'\nimport { indicatorStyle } from './indicators.mjs'",'panel style import')
cp=one(cp,"\tconst showApex = Boolean($('apexChk')?.checked)","\tconst style = indicatorStyle()\n\tconst showApex = Boolean($('apexChk')?.checked)",'style read')
const old=`\tif (showApex) {
\t\tline(mean, { color: '#6f8cff', lineWidth: 2 })
\t\tline(pick('redLo'), { color: '#e2607a', lineWidth: 1, lineStyle: lineStyle().Dotted })
\t\tline(pick('redHi'), { color: '#e2607a', lineWidth: 1 })
\t\tline(pick('greenHi'), { color: '#3fb98a', lineWidth: 1, lineStyle: lineStyle().Dotted })
\t\tline(pick('greenLo'), { color: '#3fb98a', lineWidth: 1 })
\t}
\tconst sig = showReversal ? (S.data?.reversal?.signals || []).filter((x) => inRange(time(x.at))) : []`
const neu=`\tconst visibleBands = g.bands.filter((b) => b && inRange(time(b.t))).map((b) => ({ ...b, t: time(b.t) }))
\tapexPrim.setBands(showApex ? visibleBands : [], { upperOn: style.upperFillOn, upperColor: style.upperFillColor, lowerOn: style.lowerFillOn, lowerColor: style.lowerFillColor })
\tconst labels = Boolean(style.priceLabels)
\tif (showApex) {
\t\tif (style.meanOn) line(mean, { color: style.meanColor, lineWidth: 2, lastValueVisible: labels })
\t\tif (style.redLoOn) line(pick('redLo'), { color: style.redLoColor, lineWidth: 1, lineStyle: lineStyle().Dotted, lastValueVisible: labels })
\t\tif (style.redHiOn) line(pick('redHi'), { color: style.redHiColor, lineWidth: 1, lastValueVisible: labels })
\t\tif (style.greenHiOn) line(pick('greenHi'), { color: style.greenHiColor, lineWidth: 1, lineStyle: lineStyle().Dotted, lastValueVisible: labels })
\t\tif (style.greenLoOn) line(pick('greenLo'), { color: style.greenLoColor, lineWidth: 1, lastValueVisible: labels })
\t}
\tconst sig = showReversal ? (S.data?.reversal?.signals || []).filter((x) => inRange(time(x.at)) && (x.direction === 'long' ? style.buyOn : style.sellOn)) : []`
cp=one(cp,old,neu,'styled lines')
cp=one(cp,"color: '#c9a227', shape: 'circle', size: 1,","color: x.direction === 'long' ? style.buyColor : style.sellColor, shape: 'circle', size: 1,",'signal colors')
wr('tools/visualizer/public/panels/confirmation.mjs',cp)

// HTML settings block.
let h=rd('tools/visualizer/public/index.html')
const anchor='\t\t\t\t\t\t<div class="status" id="confStatusText">—</div>'
const block=`\t\t\t\t\t\t<div class="indicator-settings">
\t\t\t\t\t\t\t<details><summary>Zonda Apex · настройки</summary><div class="indicator-body">
\t\t\t\t\t\t\t\t<div class="indicator-grid"><label>Источник<select class="input" id="source"><option value="hlc3">(H+L+C)/3</option><option value="close">Close</option><option value="hl2">(H+L)/2</option><option value="ohlc4">OHLC/4</option></select></label><label>Lookback<input class="input" id="lookback" type="number" min="20" max="1000" value="200" /></label><label>Inner<input class="input" id="kInner" type="number" step="0.1" value="5.6" /></label><label>Outer<input class="input" id="kOuter" type="number" step="0.1" value="9.6" /></label></div>
\t\t\t\t\t\t\t\t<div class="style-list">
\t\t\t\t\t\t\t\t\t<label><input type="checkbox" id="meanOn" checked> Mean <input type="color" id="meanColor" value="#6f8cff"></label><label><input type="checkbox" id="redLoOn" checked> Upper inner <input type="color" id="redLoColor" value="#e2607a"></label><label><input type="checkbox" id="redHiOn" checked> Upper outer <input type="color" id="redHiColor" value="#e2607a"></label><label><input type="checkbox" id="greenHiOn" checked> Lower inner <input type="color" id="greenHiColor" value="#3fb98a"></label><label><input type="checkbox" id="greenLoOn" checked> Lower outer <input type="color" id="greenLoColor" value="#3fb98a"></label><label><input type="checkbox" id="upperFillOn" checked> Upper fill <input type="color" id="upperFillColor" value="#e2607a"></label><label><input type="checkbox" id="lowerFillOn" checked> Lower fill <input type="color" id="lowerFillColor" value="#3fb98a"></label><label><input type="checkbox" id="priceLabels" checked> Метки на шкале</label>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t</div></details>
\t\t\t\t\t\t\t<details><summary>Zonda Reversal · настройки</summary><div class="indicator-body"><div class="indicator-grid"><label>Режим<select class="input" id="riskMode"><option value="safe">Safe</option><option value="standard" selected>Standard</option><option value="risk">Risk</option></select></label></div><div class="style-list"><label><input type="checkbox" id="buyOn" checked> BUY <input type="color" id="buyColor" value="#4ade80"></label><label><input type="checkbox" id="sellOn" checked> SELL <input type="color" id="sellColor" value="#f87171"></label></div><p class="indicator-note">Режим сохранён для калибровки сопровождения; триггеры пока одинаковые и не подгоняются.</p></div></details>
\t\t\t\t\t\t\t<div class="btn-row"><button class="btn btn-primary sm" id="indicatorApply">Применить</button><button class="btn btn-ghost sm" id="indicatorReset">Сбросить</button></div>
\t\t\t\t\t\t</div>
${anchor}`
h=one(h,anchor,block,'settings html')
wr('tools/visualizer/public/index.html',h)

// CSS: min 400, settings styling.
let css=rd('tools/visualizer/public/styles.css').replace('grid-template-columns: minmax(0, 1fr) 360px;','grid-template-columns: minmax(0, 1fr) 400px;')
css += `
.indicator-settings{display:flex;flex-direction:column;gap:8px}.indicator-settings details{border:1px solid var(--border);border-radius:var(--r);background:var(--surface)}.indicator-settings summary{cursor:pointer;padding:9px 11px;color:var(--fg-soft);font-weight:600;list-style:none}.indicator-settings summary::-webkit-details-marker{display:none}.indicator-body{padding:0 11px 11px;display:flex;flex-direction:column;gap:9px}.indicator-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.indicator-grid label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:11px}.style-list{display:grid;grid-template-columns:1fr 1fr;gap:6px}.style-list label{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11px}.style-list input[type=color]{margin-left:auto;width:27px;height:20px;border:0;background:transparent;padding:0}.indicator-note{margin:0;color:var(--dim);font-size:10.5px;line-height:1.5}
`
wr('tools/visualizer/public/styles.css',css)

// SPEC.
const sp='SPEC.md', mark='## 16.34 TV-настройки Zonda Apex / Reversal'
if(!rd(sp).includes(mark))appendFileSync(join(R,sp),`\n\n${mark} (29.07.2026)\n\nApex и Reversal имеют независимые слои. Apex получает реальные server-side входы source/lookback/kInner/kOuter; канон остаётся hlc3/200/5.6/9.6. Стиль каждой из пяти линий, двух заливок и меток ценовой шкалы меняется без пересчёта и хранится локально. Reversal отдельно управляет BUY/SELL и режимом Safe/Standard/Risk; режим пока не меняет триггер до отдельной калибровки. Боковая панель 420 px, при узком desktop не меньше 400 px.\n`)

// Gate and commits.
run('bash',['-lc','npx tsx --test tests/*.test.ts'])
run('npx',['tsc','--noEmit'])
run('bash',['-lc','node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs'])
run('git',['config','user.name','github-actions[bot]']);run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com'])
run('git',['add','src/core/signals/ApexEngine.ts','tests/apexEngine.test.ts']);run('git',['commit','-m','engine: add configurable Apex price source'])
run('git',['add','tools/visualizer']);run('git',['commit','-m','visualizer: add TradingView-style Apex and Reversal settings'])
run('git',['add','SPEC.md']);run('git',['commit','-m','docs: specify indicator settings and immutable defaults'])
run('git',['push','origin','HEAD:apex-reversal-v1'])
if(!existsSync(join(R,'ci-results')))run('mkdir',['-p','ci-results'])
wr('ci-results/indicator-settings.md','# Indicator settings\n\n- gate: PASS\n- Apex server inputs: source/lookback/inner/outer\n- styles: 5 lines + 2 fills + price labels\n- Reversal: BUY/SELL + mode\n- sidebar: 400–420 px\n')
