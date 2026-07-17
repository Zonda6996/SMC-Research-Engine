let chart, candlesSeries, markersPlugin, data
let overlays = []
let selectedId = null
let filtered = []

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
	const showSkipped=$('showSkipped').checked||result==='first5-skip'
	return data.trades.filter(t=>{
		if(t.first5Skipped&&!showSkipped)return false
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
	const skipped=data.trades.filter(t=>t.first5Skipped),canon=data.trades.filter(t=>!t.first5Skipped),deep=canon.filter(t=>t.stream==='deep'),ote=canon.filter(t=>t.stream==='ote'),bb=canon.filter(t=>t.bigbarDiagnostic)
	$('cards').innerHTML=card('Canon after gate',stats(canon),'','')+card('Deep',stats(deep),` · bench ${data.strategy.benchmarks.deep}`)+card('OTE',stats(ote),` · bench ${data.strategy.benchmarks.ote}`)+card('First-5 skipped (cf)',stats(skipped),'','neg')+card('Bigbar diagnostic',stats(bb),'','amber')+`<div class="card"><div class="name">Gate effect</div><div class="value">${skipped.length}</div><div class="sub">пропущено · риск 0</div></div>`
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
	for(const t of filtered){const en=candleAt(t.entryIndex),ex=t.exitIndex!=null?candleAt(t.exitIndex):null;if(en)m.push({time:time(en.timestamp),position:t.direction==='long'?'belowBar':'aboveBar',color:t.first5Skipped?C.dim:t.direction==='long'?C.green:C.red,shape:t.direction==='long'?'arrowUp':'arrowDown',size:t.first5Skipped?0:1,text:t.first5Skipped?'FIRST5 SKIP':t.stream+(t.bigbarDiagnostic?' BB':'')});if(ex&&!t.first5Skipped)m.push({time:time(ex.timestamp),position:t.direction==='long'?'aboveBar':'belowBar',color:t.result==='tp'?C.green:t.result==='timestop'?C.amber:C.red,shape:'circle',size:1,text:fmtR(t.netR)})}
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
	for(const t of filtered){const el=document.createElement('div');el.className='trade'+(t.id===selectedId?' selected':'');el.innerHTML=`<span class="pill ${t.direction}">${t.direction.toUpperCase()}</span><span class="stream">${t.stream.toUpperCase()}</span><span><span class="meta">${new Date(candleAt(t.entryIndex).timestamp).toLocaleString('ru-RU')}</span>${t.bigbarDiagnostic?'<span class="badge bb">BIGBAR</span>':''}${t.first5Skipped?'<span class="badge skip">FIRST5 SKIP</span>':''}</span><span class="result ${cls(t.netR)}">${t.first5Skipped?'cf '+fmtR(t.netR):fmtR(t.netR)}</span>`;el.onclick=()=>selectTrade(t.id);box.appendChild(el)}
}
function renderDetail(){
	const t=data?.trades.find(x=>x.id===selectedId);if(!t){$('detail').innerHTML='<div class="empty">Выберите сделку из списка</div>';return}
	$('detail').innerHTML=`<div class="detail-grid"><div><span class="label">Поток:</span> ${t.stream.toUpperCase()}${t.first5Skipped?' · FIRST5 SKIP':''}</div><div><span class="label">Исход:</span> <b class="${cls(t.netR)}">${t.result} ${fmtR(t.netR)}</b></div><div><span class="label">Направление:</span> ${t.direction}</div><div><span class="label">Триггер:</span> ${t.trigger.toUpperCase()}</div><div><span class="label">Entry:</span> ${fmtP(t.entry)}</div><div><span class="label">Stop:</span> ${fmtP(t.stop)}</div><div><span class="label">Take:</span> ${fmtP(t.take)}</div><div><span class="label">Exit:</span> ${fmtP(t.exitPrice)}</div><div><span class="label">Fresh:</span> ${t.freshBars} бар.</div><div><span class="label">Hold:</span> ${t.holdBars??'open'} бар.</div><div><span class="label">Risk:</span> ${t.first5Skipped?'0 (skipped)':`x${t.riskMult}`}</div><div><span class="label">Bigbar:</span> ${t.bigbarDiagnostic?'ДА, диагностический':'нет'}</div><div><span class="label">Fib 0%:</span> ${fmtP(t.legStart.price)}</div><div><span class="label">Fib 100%:</span> ${fmtP(t.legEnd.price)}</div></div>${t.first5Skipped?'<div class="notice">Touch случился в первой 5m-свече HTF-бара. Сделка пропущена; показанный R — counterfactual.</div>':''}`
}
function selectTrade(id){selectedId=selectedId===id?null:id;redraw();const t=data.trades.find(x=>x.id===selectedId);if(t){const a=Math.max(0,t.createdAtIndex-15),b=Math.min(data.candles.length-1,(t.exitIndex??t.entryIndex)+20);chart.timeScale().setVisibleRange({from:time(candleAt(a).timestamp),to:time(candleAt(b).timestamp)})}}
function navigate(step){if(!filtered.length)return;let i=filtered.findIndex(x=>x.id===selectedId);i=i<0?0:(i+step+filtered.length)%filtered.length;selectTrade(filtered[i].id)}

function redraw(){if(!data)return;clearOverlays();renderList();renderEvents();renderProtected();renderMarkers();renderSelected();renderDetail();renderCards()}
function showTooltip(p){const el=$('tooltip');if(!p.time||!p.point){el.style.display='none';return}const i=data?.candles.findIndex(c=>time(c.timestamp)===p.time);const t=filtered.find(x=>x.entryIndex===i||x.exitIndex===i);if(!t){el.style.display='none';return}el.innerHTML=`<strong>${t.stream.toUpperCase()} ${t.direction.toUpperCase()}</strong>${t.first5Skipped?' <span class="dim">FIRST5 SKIP</span>':''}<br>${t.result} · <span class="${cls(t.netR)}">${fmtR(t.netR)}</span><br><span class="muted">entry ${fmtP(t.entry)} · stop ${fmtP(t.stop)} · take ${fmtP(t.take)} · risk ${t.first5Skipped?'0':`x${t.riskMult}`}</span>${t.bigbarDiagnostic?'<br><span class="amber">BIGBAR diagnostic</span>':''}`;el.style.left=`${Math.min(p.point.x+18,$('chart').clientWidth-350)}px`;el.style.top=`${Math.max(8,p.point.y-45)}px`;el.style.display='block'}
function status(text){$('loading').style.display=text?'block':'none';$('loading').textContent=text||''}

async function load(){
	$('loadBtn').disabled=true;status('Загрузка данных…')
	try{const symbol=$('symbol').value.trim()||'BTC/USDT',timeframe=document.querySelector('#tfGroup .active')?.dataset.tf||'30m',limit=Number($('limit').value)||5000,source=$('source').value;const q=new URLSearchParams({symbol,timeframe,limit:String(limit),source});const r=await fetch(`/api/analyze?${q}`),json=await r.json();if(json.error)throw new Error(json.error);data=json;selectedId=null;initChart();candlesSeries.setData(data.candles.map(c=>({time:time(c.timestamp),open:c.open,high:c.high,low:c.low,close:c.close})));$('version').textContent=data.strategy.version;$('dataset').textContent=`${data.dataset.symbol} · ${data.dataset.timeframe} · ${data.dataset.candleCount} свечей · ${data.finalTrend}`;redraw();const latest=getFiltered().find(t=>!t.first5Skipped)||getFiltered()[0];if(latest)selectTrade(latest.id);else chart.timeScale().fitContent();status('')}catch(e){status(`Ошибка: ${e.message}`)}finally{$('loadBtn').disabled=false}}
async function loadSymbols(){try{const r=await fetch('/api/symbols'),x=await r.json();if(x.symbols)$('symbolsList').innerHTML=x.symbols.map(s=>`<option value="${s}">`).join('')}catch{}}

$('loadBtn').onclick=load;$('symbol').onkeydown=e=>{if(e.key==='Enter')load()};document.querySelectorAll('#tfGroup button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tfGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');load()})
for(const id of['fStream','fDirection','fResult','fTrigger','bigbarOnly','showSkipped','showEvents','showProtected'])$(id).onchange=()=>{selectedId=null;redraw()}
$('prevBtn').onclick=()=>navigate(-1);$('nextBtn').onclick=()=>navigate(1);document.addEventListener('keydown',e=>{if(e.key==='ArrowUp')navigate(-1);if(e.key==='ArrowDown')navigate(1)})
initChart();loadSymbols();load()
