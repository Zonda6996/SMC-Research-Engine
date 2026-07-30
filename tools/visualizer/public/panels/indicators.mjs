import { S } from '../lib/state.mjs'
import { $, time } from '../lib/format.mjs'
import { apexPrim, line, lineStyle, seriesMarkers } from '../lib/chart.mjs'

const KEY = 'smc-indicator-settings-v2'
const OLD_KEY = 'smc-indicator-settings-v1'
const DEF = {
 source:'hlc3',lookback:200,kInner:5.6,kOuter:9.6,priceLabels:true,
 meanOn:true,meanColor:'#4f83ff',meanWidth:2,
 redLoOn:true,redLoColor:'#f4506a',redLoWidth:1,redHiOn:true,redHiColor:'#f4506a',redHiWidth:1,
 greenHiOn:true,greenHiColor:'#2fd08c',greenHiWidth:1,greenLoOn:true,greenLoColor:'#2fd08c',greenLoWidth:1,
 upperFillOn:true,upperFillColor:'#f4506a',lowerFillOn:true,lowerFillColor:'#2fd08c',
 buyOn:true,buyColor:'#2fd08c',sellOn:true,sellColor:'#f4506a',riskMode:'standard'
}
const ids=Object.keys(DEF)
const DOM={source:'apexSource',lookback:'apexLookback',kInner:'apexKInner',kOuter:'apexKOuter'}
const serverIds=new Set(['source','lookback','kInner','kOuter'])
const elFor=(id)=>$(DOM[id]||id)
function read(){try{return{...DEF,...JSON.parse(localStorage.getItem(KEY)||localStorage.getItem(OLD_KEY)||'{}')}}catch{return{...DEF}}}
function save(x){localStorage.setItem(KEY,JSON.stringify(x))}
const width=(x)=>Math.max(1,Math.min(4,Number(x)||1))
export function indicatorStyle(){const x=read();for(const id of ids){const el=elFor(id);if(!el)continue;if(el.type==='checkbox')x[id]=el.checked;else if(el.type==='number')x[id]=Number(el.value);else x[id]=el.value}return x}
export function indicatorServerConfig(){const x=indicatorStyle();return{source:x.source,lookback:x.lookback,kInner:x.kInner,kOuter:x.kOuter}}
function put(x){for(const id of ids){const el=elFor(id);if(!el)continue;if(el.type==='checkbox')el.checked=Boolean(x[id]);else el.value=x[id]}}
function markChanged(){for(const id of serverIds){const el=elFor(id);el?.closest('.indicator-field')?.classList.toggle('changed',String(el.value)!==String(DEF[id]))}}
export function wireIndicatorSettings(redraw){put(read());markChanged();for(const id of ids){const el=elFor(id);if(!el)continue;el.onchange=()=>{save(indicatorStyle());markChanged();if(!serverIds.has(id))redraw()}}
 $('indicatorApply').onclick=()=>{save(indicatorStyle());document.dispatchEvent(new CustomEvent('viz:reload'))}
 $('indicatorReset').onclick=()=>{save({...DEF});put(DEF);markChanged();document.dispatchEvent(new CustomEvent('viz:reload'))}
 for(const id of ['apexChk','reversalChk'])$(id).onchange=redraw
}

export function drawIndicatorLayers(from=null,to=null){
 const showApex=Boolean($('apexChk')?.checked),showReversal=Boolean($('reversalChk')?.checked)
 if(!showApex&&!showReversal)return
 const g=S.data?.apex
 if(!g?.bands?.length)return
 const style=indicatorStyle()
 const inside=(t)=>{const x=time(t);return(from==null||x>=from)&&(to==null||x<=to)}
 const bands=g.bands.filter(b=>b&&inside(b.t))
 if(bands.length<2)return
 const pick=(key)=>bands.map(b=>({time:time(b.t),value:b[key]}))
 apexPrim.setBands(showApex?bands.map(b=>({...b,t:time(b.t)})):[],{upperOn:style.upperFillOn,upperColor:style.upperFillColor,lowerOn:style.lowerFillOn,lowerColor:style.lowerFillColor})
 const labels=Boolean(style.priceLabels)
 if(showApex){
  if(style.meanOn)line(pick('mean'),{color:style.meanColor,lineWidth:width(style.meanWidth),lastValueVisible:labels})
  if(style.redLoOn)line(pick('redLo'),{color:style.redLoColor,lineWidth:width(style.redLoWidth),lineStyle:lineStyle().Dotted,lastValueVisible:labels})
  if(style.redHiOn)line(pick('redHi'),{color:style.redHiColor,lineWidth:width(style.redHiWidth),lastValueVisible:labels})
  if(style.greenHiOn)line(pick('greenHi'),{color:style.greenHiColor,lineWidth:width(style.greenHiWidth),lineStyle:lineStyle().Dotted,lastValueVisible:labels})
  if(style.greenLoOn)line(pick('greenLo'),{color:style.greenLoColor,lineWidth:width(style.greenLoWidth),lastValueVisible:labels})
 }
 const sig=showReversal?(S.data?.reversal?.signals||[]).filter(x=>inside(x.at)&&(x.direction==='long'?style.buyOn:style.sellOn)):[]
 if(sig.length){
  const anchor=line(sig.map(x=>({time:time(x.at),value:x.edge})),{color:'rgba(0,0,0,0)',lineWidth:1})
  seriesMarkers(anchor,sig.map(x=>({time:time(x.at),position:x.direction==='long'?'belowBar':'aboveBar',color:x.direction==='long'?style.buyColor:style.sellColor,shape:'circle',size:1,text:x.direction==='long'?'BUY':'SELL'})).sort((a,b)=>a.time-b.time))
 }
}
