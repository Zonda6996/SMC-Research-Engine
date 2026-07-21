let chart, candlesSeries, markersPlugin, data
let overlays = []
let selectedId = null
let filtered = []
let labMode = false
let refinedMode = false
let refinedIndex = 0
let liqMode = false
let liqIndex = 0
let liqReviewRange = null
let hmOn = false
const LIQ_REVIEW_KEY='smc-liquidity-poi-reviews-v1'
let labIndex = 0
let labCursorAt = 0
let labRevealed = false
let labOrder = []
let labStartedAt = 0
let labLastContext = '5m'
const LAB_KEY = 'smc-141-decisions-v8'
const LAB_TF_MS={"5m":300000,"15m":900000,"30m":1800000,"45m":2700000,"1h":3600000,"2h":7200000,"3h":10800000,"4h":14400000}

const C={green:'#35c59a',red:'#ff6675',amber:'#ffbd5b',blue:'#5b8cff',purple:'#a98bff',dim:'#8290a8',text:'#e5eaf2',grid:'#171f2e'}
const $=(id)=>document.getElementById(id)
const time=(ms)=>ms/1000
const fmtR=(v)=>v==null?'—':`${v>=0?'+':''}${v.toFixed(2)}R`
const fmtP=(v)=>{if(v==null)return'—';const a=Math.abs(v);return v.toFixed(a>=1000?2:a>=10?4:a>=1?5:7)}
const cls=(v)=>v>0?'pos':v<0?'neg':''

function initChart(){
	if(chart)chart.remove()
	const el=$('chart')
	chart=LightweightCharts.createChart(el,{width:el.clientWidth,height:el.clientHeight,layout:{background:{color:'#0b0f17'},textColor:C.text},grid:{vertLines:{color:C.grid},horzLines:{color:C.grid}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#263247'},rightPriceScale:{borderColor:'#263247',scaleMargins:{top:.08,bottom:.08}}})
	candlesSeries=chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:C.green,downColor:C.red,borderUpColor:C.green,borderDownColor:C.red,wickUpColor:C.green,wickDownColor:C.red})
	markersPlugin=LightweightCharts.createSeriesMarkers(candlesSeries,[])
	chart.subscribeCrosshairMove(showTooltip)
	new ResizeObserver(()=>chart?.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el)
}
function line(points,opts){const s=chart.addSeries(LightweightCharts.LineSeries,{lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,...opts});s.setData(points);overlays.push(s);return s}
function clearOverlays(){for(const s of overlays){try{chart.removeSeries(s)}catch{}}overlays=[]}
function candleAt(i){return data?.candles?.[i]}

function getFiltered(){
	if(!data)return[]
	const stream=$('fStream').value,dir=$('fDirection').value,result=$('fResult').value,trigger=$('fTrigger').value
	const showSkipped=$('showSkipped').checked||result==='first5-skip'||result==='cost-skip'
	return data.trades.filter(t=>{
		if((t.first5Skipped||t.executionCostSkipped)&&!showSkipped)return false
		if(stream!=='all'&&t.stream!==stream)return false
		if(dir!=='all'&&t.direction!==dir)return false
		if(result!=='all'&&t.result!==result)return false
		if(trigger!=='all'&&t.trigger!==trigger)return false
		if($('bigbarOnly').checked&&!t.bigbarDiagnostic)return false
		return true
	}).sort((a,b)=>b.entryIndex-a.entryIndex)
}

function stats(rows){const done=rows.filter(x=>x.netR!=null),total=done.reduce((s,x)=>s+x.netR,0),wins=done.filter(x=>x.netR>0).length;return{n:done.length,total,avg:done.length?total/done.length:0,wr:done.length?100*wins/done.length:0}}
function card(name,s,extra='',tone=''){return`<div class="card"><div class="name">${name}</div><div class="value ${tone||cls(s.avg)}">${fmtR(s.avg)}</div><div class="sub">n ${s.n} · Σ ${fmtR(s.total)} · WR ${s.wr.toFixed(1)}%${extra}</div></div>`}
function renderCards(){
	const skipped=data.trades.filter(t=>t.first5Skipped),costSkipped=data.trades.filter(t=>t.executionCostSkipped&&!t.first5Skipped),canon=data.trades.filter(t=>!t.first5Skipped&&!t.executionCostSkipped),deep=canon.filter(t=>t.stream==='deep'),ote=canon.filter(t=>t.stream==='ote'),bb=canon.filter(t=>t.bigbarDiagnostic)
	$('cards').innerHTML=card('Canon after gates',stats(canon),'','')+card('Deep',stats(deep),` · bench ${data.strategy.benchmarks.deep}`)+card('OTE',stats(ote),` · bench ${data.strategy.benchmarks.ote}`)+card('First-5 skipped (cf)',stats(skipped),'','neg')+card('Cost skipped (cf)',stats(costSkipped),'','amber')+card('Bigbar diagnostic',stats(bb),'','amber')
}

function renderEvents(){
	if(!$('showEvents').checked)return
	for(const e of data.events){
		const a=candleAt(e.levelIndex),b=candleAt(e.confirmIndex)
		if(!a||!b||e.levelIndex>=e.confirmIndex)continue
		const color=e.type==='bos'?C.blue:e.type==='choch'?C.red:C.dim
		const series=line([{time:time(a.timestamp),value:e.levelPrice},{time:time(b.timestamp),value:e.levelPrice}],{color,lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed})
		if(e.type!=='unlabeled'){
			const mid=candleAt(Math.floor((e.levelIndex+e.confirmIndex)/2))||b
			LightweightCharts.createSeriesMarkers(series,[{time:time(mid.timestamp),position:e.levelType==='high'?'aboveBar':'belowBar',color,shape:'circle',size:0,text:`${e.type.toUpperCase()} ${e.direction==='up'?'↑':'↓'}`}])
		}
	}
}
function renderProtected(){if(!$('showProtected').checked)return;for(const x of data.protectedSegments){const a=candleAt(x.startIndex),b=candleAt(x.endIndex);if(a&&b)line([{time:time(a.timestamp),value:x.price},{time:time(b.timestamp),value:x.price}],{color:C.amber,lineWidth:1,lineStyle:LightweightCharts.LineStyle.SparseDotted})}}
function renderMarkers(){
	const m=[]
	for(const t of filtered){const en=candleAt(t.entryIndex),ex=t.exitIndex!=null?candleAt(t.exitIndex):null;if(en){const skipped=t.first5Skipped||t.executionCostSkipped;m.push({time:time(en.timestamp),position:t.direction==='long'?'belowBar':'aboveBar',color:skipped?C.dim:t.direction==='long'?C.green:C.red,shape:t.direction==='long'?'arrowUp':'arrowDown',size:skipped?0:1,text:t.first5Skipped?'FIRST5 SKIP':t.executionCostSkipped?'COST SKIP':t.stream+(t.bigbarDiagnostic?' BB':'')})}if(ex&&!t.first5Skipped&&!t.executionCostSkipped)m.push({time:time(ex.timestamp),position:t.direction==='long'?'aboveBar':'belowBar',color:t.result==='tp'?C.green:t.result==='timestop'?C.amber:C.red,shape:'circle',size:1,text:fmtR(t.netR)})}
	m.sort((a,b)=>a.time-b.time);markersPlugin.setMarkers(m)
}
function renderSelected(){
	const t=data.trades.find(x=>x.id===selectedId);if(!t)return
	const created=candleAt(t.createdAtIndex),end=candleAt(Math.min(data.candles.length-1,(t.exitIndex??t.entryIndex)+18)),legA=candleAt(t.legStart.index),legB=candleAt(t.legEnd.index),entryCandle=candleAt(t.entryIndex)
	if(!created||!end||!entryCandle)return
	const until=time(end.timestamp)
	const earliest=[created,legA,legB].filter(Boolean).sort((a,b)=>a.timestamp-b.timestamp)[0]
	const gridFrom=time(earliest.timestamp)

	// Диагональ показывает, от какого экстремума (0%) до какого event-level
	// (100%) натянута сетка. Подписи якорей не дают потерять начало движения.
	if(legA&&legB){
		const pts=[{time:time(legA.timestamp),value:t.legStart.price},{time:time(legB.timestamp),value:t.legEnd.price}].sort((a,b)=>a.time-b.time)
		const leg=line(pts,{color:C.amber,lineWidth:3,lineStyle:LightweightCharts.LineStyle.Dashed})
		LightweightCharts.createSeriesMarkers(leg,[
			{time:time(legA.timestamp),position:'inBar',color:C.amber,shape:'circle',size:1,text:`0% START ${fmtP(t.legStart.price)}`},
			{time:time(legB.timestamp),position:'inBar',color:C.blue,shape:'circle',size:1,text:`100% EVENT ${fmtP(t.legEnd.price)}`},
		].sort((a,b)=>a.time-b.time))
	}

	const shown=new Set([0,23.6,38.2,50,61.8,78.6,100,141,161])
	for(const x of t.gridLevels.filter(x=>shown.has(x.ratio))){
		const key=x.ratio===0||x.ratio===100
		const s=line([{time:gridFrom,value:x.price},{time:until,value:x.price}],{color:key?C.text:x.ratio>100?C.purple:'#49699d',lineWidth:key?2:1,lineStyle:key?LightweightCharts.LineStyle.Solid:LightweightCharts.LineStyle.Dotted})
		LightweightCharts.createSeriesMarkers(s,[{time:time(created.timestamp),position:'inBar',color:key?C.text:C.dim,shape:'circle',size:0,text:`${x.ratio}%  ${fmtP(x.price)}`}])
	}

	const tradeLine=(price,color,text)=>{const s=line([{time:time(entryCandle.timestamp),value:price},{time:until,value:price}],{color,lineWidth:3});LightweightCharts.createSeriesMarkers(s,[{time:time(entryCandle.timestamp),position:'inBar',color,shape:'circle',size:0,text}])}
	tradeLine(t.entry,C.blue,`ENTRY ${t.entryRatio}% · ${fmtP(t.entry)}`)
	tradeLine(t.stop,C.red,`SL ${t.stopRatio}% · ${fmtP(t.stop)}`)
	tradeLine(t.take,C.green,`TP ${t.takeRatio}% · ${fmtP(t.take)}`)
}

function renderList(){
	filtered=getFiltered();$('count').textContent=`${filtered.length}`
	const box=$('tradeList');box.innerHTML=''
	if(!filtered.length){box.innerHTML='<div class="empty">Нет сделок по фильтрам</div>';return}
	for(const t of filtered){const el=document.createElement('div');el.className='trade'+(t.id===selectedId?' selected':'');el.innerHTML=`<span class="pill ${t.direction}">${t.direction.toUpperCase()}</span><span class="stream">${t.stream.toUpperCase()}</span><span><span class="meta">${new Date(candleAt(t.entryIndex).timestamp).toLocaleString('ru-RU')}</span>${t.bigbarDiagnostic?'<span class="badge bb">BIGBAR</span>':''}${t.first5Skipped?'<span class="badge skip">FIRST5 SKIP</span>':t.executionCostSkipped?'<span class="badge skip">COST SKIP</span>':''}</span><span class="result ${cls(t.netR)}">${t.first5Skipped||t.executionCostSkipped?'cf '+fmtR(t.netR):fmtR(t.netR)}</span>`;el.onclick=()=>selectTrade(t.id);box.appendChild(el)}
}
function renderDetail(){
	const t=data?.trades.find(x=>x.id===selectedId);if(!t){$('detail').innerHTML='<div class="empty">Выберите сделку из списка</div>';return}
	$('detail').innerHTML=`<div class="detail-grid"><div><span class="label">Поток:</span> ${t.stream.toUpperCase()}${t.first5Skipped?' · FIRST5 SKIP':t.executionCostSkipped?' · COST SKIP':''}</div><div><span class="label">Исход:</span> <b class="${cls(t.netR)}">${t.result} ${fmtR(t.netR)}</b></div><div><span class="label">Направление:</span> ${t.direction}</div><div><span class="label">Триггер:</span> ${t.trigger.toUpperCase()}</div><div><span class="label">Entry:</span> ${fmtP(t.entry)}</div><div><span class="label">Stop:</span> ${fmtP(t.stop)}</div><div><span class="label">Take:</span> ${fmtP(t.take)}</div><div><span class="label">Exit:</span> ${fmtP(t.exitPrice)}</div><div><span class="label">Stop distance:</span> ${t.stopPct?.toFixed(4)}%</div><div><span class="label">Плановый full stop:</span> <b class="${cls(t.fullStopNetR)}">${fmtR(t.fullStopNetR)}</b> (${fmtR(-t.costRAtStop)} costs)</div><div><span class="label">Fresh:</span> ${t.freshBars} бар.</div><div><span class="label">Hold:</span> ${t.holdBars??'open'} бар.</div><div><span class="label">Risk:</span> ${t.first5Skipped||t.executionCostSkipped?'0 (skipped)':`x${t.riskMult}`}</div><div><span class="label">Bigbar:</span> ${t.bigbarDiagnostic?'ДА, диагностический':'нет'}</div><div><span class="label">Fib 0%:</span> ${fmtP(t.legStart.price)}</div><div><span class="label">Fib 100%:</span> ${fmtP(t.legEnd.price)}</div></div>${t.first5Skipped?'<div class="notice">Touch случился в первой 5m-свече HTF-бара. Сделка пропущена; показанный R — counterfactual.</div>':t.executionCostSkipped?`<div class="notice">Лимитка не выставлялась: плановый полный stop ${fmtR(t.fullStopNetR)} хуже cap −${data.strategy.executionCostGate.maxFullStopLossR.toFixed(2)}R.</div>`:''}`
}
function selectTrade(id){selectedId=selectedId===id?null:id;redraw();const t=data.trades.find(x=>x.id===selectedId);if(t){const a=Math.max(0,t.createdAtIndex-15),b=Math.min(data.candles.length-1,(t.exitIndex??t.entryIndex)+20);chart.timeScale().setVisibleRange({from:time(candleAt(a).timestamp),to:time(candleAt(b).timestamp)})}}
function navigate(step){if(!filtered.length)return;let i=filtered.findIndex(x=>x.id===selectedId);i=i<0?0:(i+step+filtered.length)%filtered.length;selectTrade(filtered[i].id)}

function labDecisions(){try{return JSON.parse(localStorage.getItem(LAB_KEY)||'{}')}catch{return{}}}
function saveLabDecisions(x){localStorage.setItem(LAB_KEY,JSON.stringify(x))}
function labTags(){return [...document.querySelectorAll('[data-lab-tag]:checked')].map(x=>x.dataset.labTag)}
function seedHash(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function seededRandom(seed){let x=seedHash(seed);return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function baseLabCandidates(){
	if(!data?.reactionCandidates)return[]
	const level=$('labLevel')?.value||'all',exact=$('labExact')?.checked,age=$('labAge')?.value||'200',saved=labDecisions()
	return data.reactionCandidates.filter(x=>!saved[x.id]?.revealedAt&&(level==='all'||String(x.ratio)===level)&&(!exact||x.resolution==='5m')&&(age==='all'||x.ageBars<=Number(age)))
}
function rebuildLabOrder(){
	const base=baseLabCandidates(),rand=seededRandom(`${$('labSeed').value}|${data?.dataset?.symbol}|${data?.dataset?.timeframe}|${$('labLevel').value}`)
	labOrder=base.map(x=>x.id)
	if($('labRandom').checked)for(let i=labOrder.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[labOrder[i],labOrder[j]]=[labOrder[j],labOrder[i]]}
	labIndex=0;setLabCursor(currentLab())
}
function labCandidates(){const map=new Map((data?.reactionCandidates||[]).map(x=>[x.id,x]));return labOrder.map(id=>map.get(id)).filter(Boolean)}
function currentLab(){const xs=labCandidates();if(!xs.length)return null;labIndex=Math.max(0,Math.min(labIndex,xs.length-1));return xs[labIndex]}
function setLabCursor(c){if(!c){labCursorAt=0;return}const d=labDecisions()[c.id];labCursorAt=d?.replayCursorAt||c.touchAt+LAB_TF_MS['5m'];labRevealed=!!d?.revealedAt;labStartedAt=Date.now();labLastContext=$('labContext').value}
function aggregateKnown(base,tf,cursor){
	const ms=LAB_TF_MS[tf],known=base.filter(c=>c.timestamp<cursor)
	if(tf==='5m')return known
	const groups=new Map()
	for(const c of known){const bucket=Math.floor(c.timestamp/ms)*ms;(groups.get(bucket)||groups.set(bucket,[]).get(bucket)).push(c)}
	return[...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([timestamp,g])=>({timestamp,open:g[0].open,high:Math.max(...g.map(x=>x.high)),low:Math.min(...g.map(x=>x.low)),close:g.at(-1).close,volume:g.reduce((s,x)=>s+x.volume,0),partial:g.at(-1).timestamp+LAB_TF_MS['5m']<timestamp+ms}))
}
function labView(c,reveal=false){
	const tf=$('labContext').value
	if(c.resolution==='5m'&&data.ltf5m?.length){
		const saved=labDecisions()[c.id],exitAt=saved?.outcome?.exitAt
		const revealUntil=exitAt!=null?Math.max(c.touchAt+101*LAB_TF_MS['5m'],exitAt+5*LAB_TF_MS['5m']):c.touchAt+101*LAB_TF_MS['5m']
		const cursor=reveal?Math.min(data.ltf5m.at(-1).timestamp+LAB_TF_MS['5m'],revealUntil):labCursorAt
		const source=aggregateKnown(data.ltf5m,tf,cursor)
		const ms=LAB_TF_MS[tf],touchIndex=source.findIndex(x=>c.touchAt>=x.timestamp&&c.touchAt<x.timestamp+ms)
		return{source,touchIndex,context:tf,cursor}
	}
	const source=data.candles.slice(0,reveal?Math.min(data.candles.length,c.touchHtfIndex+101):c.touchHtfIndex+1)
	return{source,touchIndex:c.touchHtfIndex,context:data.dataset.timeframe,cursor:c.touchAt}
}
function levelPrice(c,ratio){const z=c.gridLevels.find(x=>x.ratio===Number(ratio));if(z)return z.price;const p0=c.gridLevels.find(x=>x.ratio===0)?.price,p100=c.gridLevels.find(x=>x.ratio===100)?.price;return p0==null||p100==null?null:p0+(Number(ratio)/100)*(p100-p0)}
function simulateLabOutcome(c,d){
	if(!data.ltf5m?.length||d.entryStyle==='manual'||d.targetRatio==='manual'||d.stopRatio==='manual')return null
	const direction=c.tradeDirection,long=direction==='long',entry=d.entryStyle==='touch'?c.levelPrice:d.decisionPrice,stop=levelPrice(c,d.stopRatio),target=levelPrice(c,d.targetRatio)
	if(entry==null||stop==null||target==null||(long?(stop>=entry||target<=entry):(stop<=entry||target>=entry)))return{status:'invalid-geometry'}
	const risk=Math.abs(entry-stop),startAt=d.entryStyle==='touch'?c.touchAt:d.decisionAt,start=data.ltf5m.findIndex(x=>x.timestamp>=startAt)
	if(start<0)return{status:'no-data'}
	for(let i=start;i<data.ltf5m.length;i++){const x=data.ltf5m[i],hitStop=long?x.low<=stop:x.high>=stop,hitTp=long?x.high>=target:x.low<=target;if(hitStop)return{status:'stop',grossR:-1,entry,stop,target,exitAt:x.timestamp,bars:i-start};if(hitTp)return{status:'tp',grossR:Math.abs(target-entry)/risk,entry,stop,target,exitAt:x.timestamp,bars:i-start}}
	return{status:'open',entry,stop,target}
}
function labSource(c){return labView(c,false)}
function applyLabDecision(decision){
	const c=currentLab();if(!c||labRevealed)return
	const view=labView(c,false),decisionBar=view.source.at(-1),all=labDecisions(),previous=all[c.id]||{},now=new Date().toISOString()
	if(previous.revealedAt)return
	all[c.id]={...previous,id:c.id,decision,entryStyle:$('labEntryStyle').value,targetRatio:$('labTarget').value,stopRatio:$('labStop').value,tags:labTags(),note:$('labNote').value.trim(),symbol:data.dataset.symbol,timeframe:data.dataset.timeframe,datasetUntil:data.dataset.until,level:c.ratio,gridCreatedAt:c.createdAt,gridKnownAt:c.knownAt,gridAgeBars:c.ageBars,touchAt:c.touchAt,decisionAt:view.cursor,decisionPrice:decisionBar?.close??c.levelPrice,barsWaited5m:Math.max(0,Math.round((view.cursor-(c.touchAt+LAB_TF_MS['5m']))/LAB_TF_MS['5m'])),decisionContext:view.context,contextMode:$('labContext').value,tradeDirection:c.tradeDirection,trigger:c.trigger,oppositeSweptBefore:c.oppositeSweptBefore,replayCursorAt:view.cursor,decisionDurationMs:Date.now()-labStartedAt,actions:[...(previous.actions||[]),{action:decision,cursorAt:view.cursor,context:view.context,recordedAt:now}],recordedAt:now};saveLabDecisions(all);renderLab()
}
function loadLabForm(c){const d=labDecisions()[c.id];document.querySelectorAll('[data-lab-tag]').forEach(x=>x.checked=!!d?.tags?.includes(x.dataset.labTag));$('labNote').value=d?.note||'';$('labEntryStyle').value=d?.entryStyle||'reaction-close';$('labTarget').value=d?.targetRatio||(c.ratio===241?'141':c.ratio===200?'141':'100');$('labStop').value=d?.stopRatio||(c.ratio===241?'261':c.ratio===200?'241':'176');$('labTake').classList.toggle('active',d?.decision==='TAKE');$('labSkip').classList.toggle('active',d?.decision==='SKIP')}
function renderLabAnalytics(){const ds=Object.values(labDecisions()),final=ds.filter(x=>x.decision==='TAKE'||x.decision==='SKIP'),takes=final.filter(x=>x.decision==='TAKE'),resolved=takes.filter(x=>x.outcome?.grossR!=null),avg=resolved.length?resolved.reduce((s,x)=>s+x.outcome.grossR,0)/resolved.length:0;$('labAnalytics').textContent=`TAKE ${takes.length} · SKIP ${final.length-takes.length} · resolved ${resolved.length} · TAKE avg ${fmtR(avg)}`}
function renderLabOutcome(d){
	const el=$('labOutcome'),o=d?.outcome
	if(!labRevealed){el.style.display='none';el.textContent='';return}
	if(!o){el.className='lab-outcome neutral';el.style.display='block';el.textContent='REVEALED · автоматический исход недоступен для manual-геометрии';return}
	const r=o.grossR,kind=r>0?'win':r<0?'loss':'neutral',label=o.status==='tp'?'TAKE PROFIT':o.status==='stop'?'STOP LOSS':o.status==='open'?'OPEN':o.status.toUpperCase()
	el.className=`lab-outcome ${kind}`;el.style.display='block'
	el.innerHTML=`<b>${d.decision==='SKIP'?'SKIP · counterfactual':'TAKE'}: ${label}${r!=null?` · ${fmtR(r)}`:''}</b>${o.entry!=null?`<br><span class="muted">entry ${fmtP(o.entry)} · stop ${fmtP(o.stop)} · target ${fmtP(o.target)}${o.bars!=null?` · ${o.bars}×5m`:''}</span>`:''}`
}
function switchLabContext(){
	const to=$('labContext').value,c=currentLab(),from=labLastContext
	labLastContext=to
	if(!c||to===from||labRevealed){renderLab();return}
	const all=labDecisions(),previous=all[c.id]||{},now=new Date().toISOString()
	all[c.id]={...previous,id:c.id,decision:previous.decision??null,symbol:data.dataset.symbol,timeframe:data.dataset.timeframe,datasetUntil:data.dataset.until,level:c.ratio,gridCreatedAt:c.createdAt,gridKnownAt:c.knownAt,gridAgeBars:c.ageBars,touchAt:c.touchAt,tradeDirection:c.tradeDirection,trigger:c.trigger,oppositeSweptBefore:c.oppositeSweptBefore,actions:[...(previous.actions||[]),{action:'TF_SWITCH',from,to,cursorAt:labCursorAt,recordedAt:now}],replayCursorAt:labCursorAt,lastObservedAt:labCursorAt}
	saveLabDecisions(all);renderLab()
}
function renderLab(){
	if(!data||!labMode)return
	clearOverlays();markersPlugin.setMarkers([])
	const c=currentLab(),xs=labCandidates();if(!c){$('labStatus').textContent='Нет новых structurally-active exact-LTF касаний по уровню/возрасту';$('labOutcome').style.display='none';return}
	loadLabForm(c);document.body.classList.toggle('lab-blind',$('labBlind').checked&&!labRevealed);chart.applyOptions({timeScale:{visible:!$('labBlind').checked||labRevealed},rightPriceScale:{visible:!$('labBlind').checked||labRevealed}})
	const view=labView(c,labRevealed),source=view.source,touchIndex=view.touchIndex,left=Number($('labHistory').value)||250
	const shown=source.slice(Math.max(0,touchIndex-left),source.length)
	candlesSeries.setData(shown.map(x=>({time:time(x.timestamp),open:x.open,high:x.high,low:x.low,close:x.close})))
	const first=shown[0],last=shown.at(-1);if(!first||!last)return
	const from=time(first.timestamp),to=time(last.timestamp),blind=$('labBlind').checked&&!labRevealed
	const startBefore=time(c.legStart.timestamp)<from,endBefore=time(c.legEnd.timestamp)<from,startTime=Math.max(from,time(c.legStart.timestamp)),endTime=Math.max(from,time(c.legEnd.timestamp))
	const leg=line([{time:startTime,value:c.legStart.price},{time:endTime,value:c.legEnd.price}].sort((a,b)=>a.time-b.time),{color:C.amber,lineWidth:3,lineStyle:LightweightCharts.LineStyle.Dashed})
	LightweightCharts.createSeriesMarkers(leg,[{time:startTime,position:'inBar',color:C.amber,shape:'circle',size:1,text:startBefore?'← 0% ДО ОКНА':'0% START'},{time:endTime,position:'inBar',color:C.blue,shape:'circle',size:1,text:endBefore?'← 100% ДО ОКНА':'100% EVENT'}].sort((a,b)=>a.time-b.time))
	for(const x of c.gridLevels.filter(x=>[0,61.8,78.6,100,141,161,200,241,261].includes(x.ratio))){const key=x.ratio===c.ratio,s=line([{time:from,value:x.price},{time:to,value:x.price}],{color:key?C.purple:x.ratio>100?'#7059a8':'#49699d',lineWidth:key?3:1,lineStyle:key?LightweightCharts.LineStyle.Solid:LightweightCharts.LineStyle.Dotted});LightweightCharts.createSeriesMarkers(s,[{time:Math.max(from,time(c.touchAt)),position:'inBar',color:key?C.purple:C.dim,shape:'circle',size:0,text:blind?`${x.ratio}%`:`${x.ratio}% ${fmtP(x.price)}`}])}
	const decisions=labDecisions(),d=decisions[c.id],done=Object.values(decisions).filter(x=>x.decision==='TAKE'||x.decision==='SKIP').length,wait=Math.max(0,Math.round((view.cursor-(c.touchAt+LAB_TF_MS['5m']))/LAB_TF_MS['5m']))
	const marks=[{time:time(c.touchAt),position:c.tradeDirection==='long'?'belowBar':'aboveBar',color:C.purple,shape:c.tradeDirection==='long'?'arrowUp':'arrowDown',size:1,text:`DECIDE ${c.ratio}`}]
	if(labRevealed&&d?.outcome?.exitAt!=null){const ms=LAB_TF_MS[view.context]||LAB_TF_MS['5m'],exitBar=source.find(x=>d.outcome.exitAt>=x.timestamp&&d.outcome.exitAt<x.timestamp+ms);if(exitBar)marks.push({time:time(exitBar.timestamp),position:d.outcome.status==='stop'?'belowBar':'aboveBar',color:d.outcome.status==='stop'?C.red:C.green,shape:'circle',size:1,text:d.outcome.status==='stop'?'STOP':`TP ${fmtR(d.outcome.grossR)}`})}
	markersPlugin.setMarkers(marks.sort((a,b)=>a.time-b.time))
	const origin=blind?`сетка создана ${c.ageBars} HTF-баров до касания`:`сетка известна ${new Date(c.knownAt).toLocaleString('ru-RU')} → касание ${new Date(c.touchAt).toLocaleString('ru-RU')} · возраст ${c.ageBars} ${data.dataset.timeframe}-бар.`
	$('labStatus').innerHTML=`${labIndex+1}/${xs.length} · <b>${c.ratio}%</b> · ${c.tradeDirection.toUpperCase()} · ${view.context} · +${wait}×5m · ${d?.decision||'НЕ РЕШЕНО'} · решений ${done}${labRevealed?' · REVEALED':''}<br><span class="muted">${origin} · структура active-at-touch</span>`
	renderLabOutcome(d);renderLabAnalytics();chart.timeScale().fitContent()
}
function moveLab(step){const xs=labCandidates();if(!xs.length)return;labIndex=(labIndex+step+xs.length)%xs.length;setLabCursor(currentLab());renderLab()}
function advanceLab(action){const c=currentLab();if(!c||labRevealed||c.resolution!=='5m')return;const max=data.ltf5m.at(-1).timestamp+LAB_TF_MS['5m'];if(labCursorAt+LAB_TF_MS['5m']>max)return;labCursorAt+=LAB_TF_MS['5m'];const all=labDecisions(),previous=all[c.id]||{},now=new Date().toISOString();all[c.id]={...previous,id:c.id,decision:previous.decision??null,symbol:data.dataset.symbol,timeframe:data.dataset.timeframe,datasetUntil:data.dataset.until,level:c.ratio,gridCreatedAt:c.createdAt,gridKnownAt:c.knownAt,gridAgeBars:c.ageBars,touchAt:c.touchAt,tradeDirection:c.tradeDirection,trigger:c.trigger,oppositeSweptBefore:c.oppositeSweptBefore,actions:[...(previous.actions||[]),{action,cursorAt:labCursorAt,context:$('labContext').value,recordedAt:now}],replayCursorAt:labCursorAt,lastObservedAt:labCursorAt};saveLabDecisions(all);renderLab()}
function toggleLab(){labMode=!labMode;$('labControls').style.display=labMode?'block':'none';$('labToggle').textContent=labMode?'Выключить':'Включить';$('labToggle').classList.toggle('active',labMode);if(labMode){selectedId=null;rebuildLabOrder();setLabCursor(currentLab());renderLab()}else{document.body.classList.remove('lab-blind');chart.applyOptions({timeScale:{visible:true},rightPriceScale:{visible:true}});restoreMainCandles();redraw();chart.timeScale().fitContent()}}
function revealLab(){const c=currentLab();if(!c||labRevealed)return;const all=labDecisions(),d=all[c.id];if(d?.decision!=='TAKE'&&d?.decision!=='SKIP'){alert('Сначала выберите TAKE или SKIP');return}const revealedAt=new Date().toISOString();labRevealed=true;all[c.id]={...d,revealedAt,outcome:simulateLabOutcome(c,d),actions:[...(d.actions||[]),{action:'REVEAL',cursorAt:labCursorAt,context:$('labContext').value,recordedAt:revealedAt}]};saveLabDecisions(all);renderLab()}
function exportLab(){const blob=new Blob([JSON.stringify(Object.values(labDecisions()),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`decision-lab-session-${Date.now()}.json`;a.click();URL.revokeObjectURL(a.href)}
function clearLab(){const c=currentLab();if(!c)return;const all=labDecisions();delete all[c.id];saveLabDecisions(all);setLabCursor(c);renderLab()}

function liqReviews(){try{return JSON.parse(localStorage.getItem(LIQ_REVIEW_KEY)||'{}')}catch{return{}}}
function liqCandidates(){const d=$('liqDirection').value,life=$('liqLifecycle').value;return(data?.liquidityPoi?.candidates||[]).filter(x=>{if(d!=='all'&&x.direction!==d)return false;if(life==='active')return x.active;if(life==='visible'&&liqReviewRange){const from=Number(liqReviewRange.from)*1000,to=Number(liqReviewRange.to)*1000;return x.originAt<=to&&x.endAt>=from}return true})}
function currentLiq(){const xs=liqCandidates();if(!xs.length)return null;liqIndex=Math.max(0,Math.min(liqIndex,xs.length-1));return xs[liqIndex]}
function renderLiquidity(){if(!data||!liqMode)return;clearOverlays();restoreMainCandles();markersPlugin.setMarkers([]);const c=currentLiq(),xs=liqCandidates();if(!c){$('liqStatus').textContent='Liquidity POI candidates: 0';return}const end=time(c.endAt),from=time(c.originAt),color=c.direction==='long'?C.green:C.red;line([{time:from,value:c.near},{time:end,value:c.near}],{color,lineWidth:3});line([{time:from,value:c.far},{time:end,value:c.far}],{color:C.purple,lineWidth:3,lineStyle:LightweightCharts.LineStyle.Dashed});markersPlugin.setMarkers(c.pivotTimes.map((at,i)=>({time:time(at),position:c.direction==='long'?'belowBar':'aboveBar',color:C.purple,shape:'circle',size:1,text:`P${i+1}`})));const old=liqReviews()[c.id];$('liqNote').value=old?.note||'';document.querySelectorAll('[data-liq-choice]').forEach(b=>b.classList.toggle('active',b.dataset.liqChoice===old?.choice));$('liqStatus').textContent=`${liqIndex+1}/${xs.length} · ${c.direction.toUpperCase()} · ${c.zoneClass.toUpperCase()} · pivots ${c.pivotCount} · ${`${c.lifecycleState.toUpperCase()} · ${c.priority.toUpperCase()}`}`;$('liqDetail').innerHTML=`<div><b>Зона:</b> ${fmtP(c.near)} → ${fmtP(c.far)}</div><div>Ширина: ${(Math.abs(c.far-c.near)/c.atr).toFixed(2)} ATR · event ${c.eventType||'EQ cluster'}</div><div>Жизнь зоны: ${new Date(c.knownAt).toLocaleString('ru-RU')} → ${new Date(c.endAt).toLocaleString('ru-RU')}</div><div>Components: ${c.componentAnchorIds?.length||1} · absorbed: ${c.suppressedCount||0} · pivots: ${c.pivotCount}</div><div>P/D: ${c.pdZone||'none'} · aligned: ${c.pdAligned==null?'unknown':c.pdAligned?'yes':'no'} · boundary: ${c.boundarySource}</div><div>Lifecycle: ${c.lifecycleState} · priority: ${c.priority} · interaction: ${c.interaction} (${c.touchCount||0})</div><div>Armed: ${c.armedAt?new Date(c.armedAt).toLocaleString('ru-RU'):'—'} · consumed: ${c.consumedAt?new Date(c.consumedAt).toLocaleString('ru-RU'):'—'} · failed: ${c.failedAt?new Date(c.failedAt).toLocaleString('ru-RU'):'—'} · retired: ${c.retiredAt?new Date(c.retiredAt).toLocaleString('ru-RU'):'—'}</div>`;chart.timeScale().setVisibleRange({from:time(c.originAt-20*14_400_000),to:time(c.originAt+80*14_400_000)})}
function toggleLiquidity(){if(!liqMode)liqReviewRange=chart.timeScale().getVisibleRange();liqMode=!liqMode;$('liqControls').style.display=liqMode?'block':'none';$('liqToggle').textContent=liqMode?'Закрыть':'Открыть';if(liqMode){refinedMode=false;labMode=false;liqIndex=0;renderLiquidity()}else{restoreMainCandles();redraw()}}
function moveLiq(n){const xs=liqCandidates();if(!xs.length)return;liqIndex=(liqIndex+n+xs.length)%xs.length;renderLiquidity()}
function saveLiq(choice){const c=currentLiq();if(!c)return;const x=liqReviews();x[c.id]={id:c.id,version:c.version,symbol:data.dataset.symbol,direction:c.direction,zoneClass:c.zoneClass,choice,note:$('liqNote').value.trim(),near:c.near,far:c.far,atr:c.atr,pivotCount:c.pivotCount,eventType:c.eventType,active:c.active,supersededAt:c.supersededAt,invalidatedAt:c.invalidatedAt,boundarySource:c.boundarySource,pdZone:c.pdZone,pdAligned:c.pdAligned,componentAnchorIds:c.componentAnchorIds,componentClasses:c.componentClasses,suppressedCount:c.suppressedCount,valid:c.valid,priority:c.priority,interaction:c.interaction,touchCount:c.touchCount,lineageSupersededAt:c.lineageSupersededAt,lifecycleState:c.lifecycleState,armedAt:c.armedAt,firstTouchAt:c.firstTouchAt,consumedAt:c.consumedAt,failedAt:c.failedAt,retiredAt:c.retiredAt,recordedAt:new Date().toISOString()};localStorage.setItem(LIQ_REVIEW_KEY,JSON.stringify(x));moveLiq(1)}
function exportLiq(){const blob=new Blob([JSON.stringify(Object.values(liqReviews()),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`liquidity-poi-reviews-${Date.now()}.json`;a.click();URL.revokeObjectURL(a.href)}
function closeLiq(){liqMode=false;$('liqControls').style.display='none';$('liqToggle').textContent='Открыть';restoreMainCandles();redraw();chart.timeScale().fitContent()}
function restoreMainCandles(){if(data)candlesSeries.setData(data.candles.map(c=>({time:time(c.timestamp),open:c.open,high:c.high,low:c.low,close:c.close})))}
function refinedCandidates(){const xs=data?.refinedPoi?.candidates||[],st=$('refinedStatus').value,reason=$('refinedReason').value;return xs.filter(x=>{const stateOk=st==='all'||(st==='touched'?x.poiTouchAt!=null:x.status===st);return stateOk&&(reason==='all'||x.rejectionReason===reason)})}
function currentRefined(){const xs=refinedCandidates();if(!xs.length)return null;refinedIndex=Math.max(0,Math.min(refinedIndex,xs.length-1));return xs[refinedIndex]}
function renderRefined(){if(!data||!refinedMode)return;clearOverlays();const c=currentRefined(),xs=refinedCandidates();markersPlugin.setMarkers([]);if(!c){const total=data?.refinedPoi?.candidates?.length||0;$('refinedStatusText').textContent=total?`Всего детекций ${total}, но по текущему фильтру 0 — выберите «Все состояния» или Pending`:'Детектор не нашёл ни одной 4h OB, подтверждённой FVG, в покрытом 15m-окне';return}const src=data.ltf15m||[];candlesSeries.setData(src.map(x=>({time:time(x.timestamp),open:x.open,high:x.high,low:x.low,close:x.close})));const from=time(src[0].timestamp),to=time(src.at(-1).timestamp);line([{time:from,value:c.poiTop},{time:to,value:c.poiTop}],{color:C.purple,lineWidth:3});line([{time:from,value:c.poiBottom},{time:to,value:c.poiBottom}],{color:C.purple,lineWidth:3});const colors={POI_KNOWN:C.blue,POI_TOUCH:C.purple,STOPPING:C.amber,REBOUND:C.blue,SECOND_SWEEP:C.red,PROTECTED:C.green,LOW_VOLUME_TEST:C.dim,ENTRY:C.green,STOP:C.red,TP2:C.green};const marks=c.trace.map(x=>({time:time(x.at),position:['SECOND_SWEEP','STOP'].includes(x.state)?'belowBar':'aboveBar',color:colors[x.state]||C.dim,shape:x.state==='ENTRY'?'arrowUp':'circle',size:1,text:x.state})).filter(x=>src.some(s=>time(s.timestamp)===x.time));markersPlugin.setMarkers(marks.sort((a,b)=>a.time-b.time));$('refinedStatusText').textContent=`${refinedIndex+1}/${xs.length} · ${c.direction.toUpperCase()} · ${c.status.toUpperCase()} · ${c.rejectionReason||c.outcome||'—'}`;$('refinedTrace').innerHTML=`<div>POI ${fmtP(c.poiBottom)}–${fmtP(c.poiTop)} · ${c.poiType} · ${c.eventType.toUpperCase()}</div><div>OB ${fmtP(c.obBottom)}–${fmtP(c.obTop)}</div><div>FVG ${fmtP(c.fvgBottom)}–${fmtP(c.fvgTop)}</div><div>Entry ${fmtP(c.entry)} · Stop ${fmtP(c.stop)} · TP2 ${fmtP(c.tp2)} · ${fmtR(c.grossR)}</div><hr>${c.trace.map(x=>`<div><b>${x.state}</b> · ${new Date(x.at).toLocaleString('ru-RU')}${x.volumeRatio!=null?` · vol×${x.volumeRatio.toFixed(2)}`:''}${x.note?` · ${x.note}`:''}</div>`).join('')}`;const times=c.trace.map(x=>x.at);chart.timeScale().setVisibleRange({from:time(Math.min(...times)-24*3600000),to:time(Math.max(...times)+24*3600000)})}
function toggleRefined(){refinedMode=!refinedMode;$('refinedControls').style.display=refinedMode?'block':'none';$('refinedToggle').textContent=refinedMode?'Закрыть':'Открыть';if(refinedMode){labMode=false;refinedIndex=0;renderRefined()}else{restoreMainCandles();redraw()}}
function moveRefined(n){const xs=refinedCandidates();if(!xs.length)return;refinedIndex=(refinedIndex+n+xs.length)%xs.length;renderRefined()}
function exportRefined(){const blob=new Blob([JSON.stringify(data?.refinedPoi||{},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`refined-poi-${data?.dataset?.symbol?.replace('/','-')||'data'}-${Date.now()}.json`;a.click();URL.revokeObjectURL(a.href)}
function restoreRefinedMain(){refinedMode=false;$('refinedControls').style.display='none';$('refinedToggle').textContent='Открыть';restoreMainCandles();redraw();chart.timeScale().fitContent()}
function redraw(){if(!data)return;if(liqMode){renderLiquidity();return}if(refinedMode){renderRefined();return}if(labMode){renderLab();return}clearOverlays();renderList();renderEvents();renderProtected();renderMarkers();renderSelected();renderHeatmap();renderDetail();renderCards()}
function showTooltip(p){const el=$('tooltip');if(labMode){el.style.display='none';return}if(!p.time||!p.point){el.style.display='none';return}const i=data?.candles.findIndex(c=>time(c.timestamp)===p.time);const t=filtered.find(x=>x.entryIndex===i||x.exitIndex===i);if(!t){el.style.display='none';return}el.innerHTML=`<strong>${t.stream.toUpperCase()} ${t.direction.toUpperCase()}</strong>${t.first5Skipped?' <span class="dim">FIRST5 SKIP</span>':''}<br>${t.result} · <span class="${cls(t.netR)}">${fmtR(t.netR)}</span><br><span class="muted">entry ${fmtP(t.entry)} · stop ${fmtP(t.stop)} · take ${fmtP(t.take)} · risk ${t.first5Skipped||t.executionCostSkipped?'0':`x${t.riskMult}`}</span>${t.bigbarDiagnostic?'<br><span class="amber">BIGBAR diagnostic</span>':''}`;el.style.left=`${Math.min(p.point.x+18,$('chart').clientWidth-350)}px`;el.style.top=`${Math.max(8,p.point.y-45)}px`;el.style.display='block'}
function status(text){$('loading').style.display=text?'block':'none';$('loading').textContent=text||''}

async function load(){
	$('loadBtn').disabled=true;status('Загрузка данных…')
	try{const symbol=$('symbol').value.trim()||'BTC/USDT',timeframe=document.querySelector('#tfGroup .active')?.dataset.tf||'30m',limit=Number($('limit').value)||5000,source=$('source').value,until=$('historyUntil').value;const q=new URLSearchParams({symbol,timeframe,limit:String(limit),source,contextTf:$('labContext').value,historyBars:$('labHistory').value});if(until)q.set('until',until);const r=await fetch(`/api/analyze?${q}`),json=await r.json();if(json.error)throw new Error(json.error);data=json;selectedId=null;liqMode=false;liqIndex=0;liqReviewRange=null;$('liqControls').style.display='none';$('liqToggle').textContent='Открыть';refinedMode=false;refinedIndex=0;$('refinedControls').style.display='none';$('refinedToggle').textContent='Открыть';const reasons=[...new Set((data.refinedPoi?.candidates||[]).map(x=>x.rejectionReason).filter(Boolean))];$('refinedReason').innerHTML='<option value="all">Все причины</option>'+reasons.map(x=>`<option value="${x}">${x}</option>`).join('');labMode=false;labOrder=[];labCursorAt=0;labRevealed=false;$('labControls').style.display='none';$('labToggle').textContent='Включить';$('labToggle').classList.remove('active');initChart();candlesSeries.setData(data.candles.map(c=>({time:time(c.timestamp),open:c.open,high:c.high,low:c.low,close:c.close})));$('version').textContent=data.strategy.version;$('dataset').textContent=`${data.dataset.symbol} · ${data.dataset.timeframe} · ${data.dataset.candleCount} свечей · ${data.dataset.until?`до ${data.dataset.until.slice(0,10)} · `:''}${data.finalTrend}`;redraw();const latest=getFiltered().find(t=>!t.first5Skipped)||getFiltered()[0];if(latest)selectTrade(latest.id);else chart.timeScale().fitContent();status('')}catch(e){status(`Ошибка: ${e.message}`)}finally{$('loadBtn').disabled=false}}
function randomHistoricalPeriod(){const from=Date.UTC(2024,2,1),to=Date.now(),at=from+Math.floor(Math.random()*(to-from));$('historyUntil').value=new Date(at).toISOString().slice(0,10);load()}
async function loadSymbols(){try{const r=await fetch('/api/symbols'),x=await r.json();if(x.symbols)$('symbolsList').innerHTML=x.symbols.map(s=>`<option value="${s}">`).join('')}catch{}}

$('loadBtn').onclick=load;$('randomPeriod').onclick=randomHistoricalPeriod;$('symbol').onkeydown=e=>{if(e.key==='Enter')load()};document.querySelectorAll('#tfGroup button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tfGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');load()})
for(const id of['fStream','fDirection','fResult','fTrigger','bigbarOnly','showSkipped','showEvents','showProtected'])$(id).onchange=()=>{selectedId=null;redraw()}
$('prevBtn').onclick=()=>navigate(-1);$('nextBtn').onclick=()=>navigate(1)
$('liqToggle').onclick=toggleLiquidity;$('liqPrev').onclick=()=>moveLiq(-1);$('liqNext').onclick=()=>moveLiq(1);document.querySelectorAll('[data-liq-choice]').forEach(b=>b.onclick=()=>saveLiq(b.dataset.liqChoice));$('liqExport').onclick=exportLiq;$('liqBack').onclick=closeLiq;for(const id of['liqDirection','liqLifecycle'])$(id).onchange=()=>{liqIndex=0;renderLiquidity()};$('refinedToggle').onclick=toggleRefined;$('refinedPrev').onclick=()=>moveRefined(-1);$('refinedNext').onclick=()=>moveRefined(1);$('refinedBack').onclick=restoreRefinedMain;$('refinedExport').onclick=exportRefined;for(const id of['refinedStatus','refinedReason'])$(id).onchange=()=>{refinedIndex=0;renderRefined()};$('labToggle').onclick=toggleLab;$('labShuffle').onclick=()=>{rebuildLabOrder();renderLab()};$('labPrev').onclick=()=>moveLab(-1);$('labNext').onclick=()=>moveLab(1);$('labStep').onclick=()=>advanceLab('STEP');$('labWait').onclick=()=>advanceLab('WAIT');$('labTake').onclick=()=>applyLabDecision('TAKE');$('labSkip').onclick=()=>applyLabDecision('SKIP');$('labReveal').onclick=revealLab;$('labExport').onclick=exportLab;$('labClear').onclick=clearLab;for(const id of['labLevel','labAge','labRandom','labExact'])$(id).onchange=()=>{rebuildLabOrder();renderLab()};$('labSeed').onchange=()=>{rebuildLabOrder();renderLab()};$('labContext').onchange=switchLabContext;for(const id of['labHistory','labBlind'])$(id).onchange=renderLab
document.addEventListener('keydown',e=>{if(labMode){if(e.key==='ArrowLeft')moveLab(-1);if(e.key==='ArrowRight')moveLab(1);return}if(e.key==='ArrowUp')navigate(-1);if(e.key==='ArrowDown')navigate(1)})
initChart();loadSymbols();load()

function hmPools(){const side=$('hmSide').value,minW=Number($('hmMinWeight').value),showSwept=$('hmShowSwept').checked,age=Number($('hmAge').value);let cutoff=-Infinity;if(age>0&&data.candles.length>age)cutoff=data.candles[data.candles.length-age].timestamp;return(data?.liquidityHeatmap?.pools||[]).filter(p=>(side==='all'||p.side===side)&&p.weight>=minW&&(showSwept||p.status==='active')&&p.startAt>=cutoff)}
function renderHeatmap(){if(!data)return;if(!hmOn){$('hmStatus').textContent='\u2014';return}const xs=hmPools(),ordered=[...xs].sort((a,b)=>b.weight-a.weight),cap=300,shown=ordered.slice(0,cap),last=data.candles[data.candles.length-1].timestamp;for(const p of shown){const rgb=p.side==='sell-side'?'255,102,117':'53,197,154',alpha=(0.25+0.65*p.weight).toFixed(2),width=Math.max(2,Math.min(8,1+(p.spanBins||1)+Math.round(3*p.weight)));line([{time:time(p.startAt),value:p.extremePrice},{time:time(p.sweptAt??last),value:p.extremePrice}],{color:`rgba(${rgb},${alpha})`,lineWidth:width})}const act=xs.filter(p=>p.status==='active').length;$('hmStatus').textContent=`\u041f\u0443\u043b\u044b: ${act} \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u00b7 ${xs.length-act} \u0441\u043d\u044f\u0442\u044b\u0445 \u00b7 \u043d\u0430\u0440\u0438\u0441\u043e\u0432\u0430\u043d\u043e ${shown.length}${ordered.length>cap?` \u0438\u0437 ${ordered.length}`:''}`}
$('hmToggle').onclick=()=>{hmOn=!hmOn;$('hmControls').style.display=hmOn?'block':'none';$('hmToggle').textContent=hmOn?'\u0421\u043a\u0440\u044b\u0442\u044c':'\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c';redraw()}
for(const id of['hmSide','hmMinWeight','hmShowSwept','hmAge'])$(id).onchange=()=>redraw()
