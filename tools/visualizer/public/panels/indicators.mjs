import { $ } from '../lib/format.mjs'
const KEY='smc-indicator-settings-v1'
const DEF={source:'hlc3',lookback:200,kInner:5.6,kOuter:9.6,priceLabels:true,
 meanOn:true,meanColor:'#6f8cff',redLoOn:true,redLoColor:'#e2607a',redHiOn:true,redHiColor:'#e2607a',
 greenHiOn:true,greenHiColor:'#3fb98a',greenLoOn:true,greenLoColor:'#3fb98a',upperFillOn:true,upperFillColor:'#e2607a',lowerFillOn:true,lowerFillColor:'#3fb98a',
 buyOn:true,buyColor:'#4ade80',sellOn:true,sellColor:'#f87171',riskMode:'standard'}
const ids=Object.keys(DEF)
const DOM={source:'apexSource',lookback:'apexLookback',kInner:'apexKInner',kOuter:'apexKOuter'}
const elFor=(id)=>$(DOM[id]||id)
function read(){try{return{...DEF,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return{...DEF}}}
function save(x){localStorage.setItem(KEY,JSON.stringify(x))}
export function indicatorStyle(){const x=read();for(const id of ids){const el=elFor(id);if(!el)continue;if(el.type==='checkbox')x[id]=el.checked;else if(el.type==='number')x[id]=Number(el.value);else x[id]=el.value}return x}
export function indicatorServerConfig(){const x=indicatorStyle();return{source:x.source,lookback:x.lookback,kInner:x.kInner,kOuter:x.kOuter}}
function put(x){for(const id of ids){const el=elFor(id);if(!el)continue;if(el.type==='checkbox')el.checked=Boolean(x[id]);else el.value=x[id]}}
export function wireIndicatorSettings(redraw){put(read());for(const id of ids){const el=elFor(id);if(!el)continue;el.onchange=()=>{save(indicatorStyle());if(!['source','lookback','kInner','kOuter'].includes(id))redraw()}}
 $('indicatorApply').onclick=()=>{save(indicatorStyle());document.dispatchEvent(new CustomEvent('viz:reload'))}
 $('indicatorReset').onclick=()=>{save({...DEF});put(DEF);document.dispatchEvent(new CustomEvent('viz:reload'))}
}
