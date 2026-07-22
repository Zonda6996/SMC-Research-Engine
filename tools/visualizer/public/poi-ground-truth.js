(() => {
  const KEY = 'smc-poi-ground-truth-v1'
  let draft = null
  const labels = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
  const saveAll = x => localStorage.setItem(KEY, JSON.stringify(x))
  const root = document.createElement('div')
  root.className = 'section'
  root.innerHTML = `
    <div class="section-title"><span>POI ground truth</span><button id="poiGtToggle" class="navbtn">✎</button></div>
    <div id="poiGtBody" style="display:none">
      <div class="notice">OHLCV proxy, не копия приватной heatmap. Клик 1: near/anchor. Клик 2: far.</div>
      <select id="poiGtDirection" class="control"><option value="long">LONG</option><option value="short">SHORT</option></select>
      <select id="poiGtClass" class="control"><option value="protected-structure">PROTECTED</option><option value="outer-swing">OUTER</option><option value="local-eq">LOCAL EQ</option></select>
      <select id="poiGtSource" class="control"><option value="heatmap">heatmap</option><option value="protected-level">protected level</option><option value="equal-levels">EQ cluster</option><option value="mixed">mixed</option></select>
      <select id="poiGtConfidence" class="control"><option value="3">confidence 3</option><option value="2">confidence 2</option><option value="1">confidence 1</option></select>
      <textarea id="poiGtNote" class="lab-note" placeholder="Почему именно эта зона"></textarea>
      <div class="lab-actions"><button id="poiGtDraw" class="labbtn">Рисовать</button><button id="poiGtCandidate" class="labbtn">Из кандидата</button><button id="poiGtSave" class="labbtn take">Сохранить</button><button id="poiGtMiss" class="labbtn skip">Пропущенная зона</button><button id="poiGtExport" class="labbtn">Экспорт</button></div>
      <div id="poiGtStatus" class="lab-status">Нет draft</div>
    </div>`
  document.querySelector('.sidebar')?.prepend(root)
  const gt = id => document.getElementById(id)
  gt('poiGtToggle').onclick = () => { const b = gt('poiGtBody'); b.style.display = b.style.display === 'none' ? 'block' : 'none' }
  const show = () => { gt('poiGtStatus').textContent = draft ? `near ${fmtP(draft.near)} → far ${fmtP(draft.far)} · ${draft.originAt ? new Date(draft.originAt).toLocaleString('ru-RU') : 'без времени'}` : 'Нет draft' }
  let drawing = false
  gt('poiGtDraw').onclick = () => { drawing = true; draft = null; show(); gt('poiGtStatus').textContent = 'Кликните anchor/near' }
  chart?.subscribeClick?.(() => {})
  const attach = () => {
    if (!chart || chart.__poiGtAttached) return
    chart.__poiGtAttached = true
    chart.subscribeClick(p => {
      if (!drawing || !p?.point || p.time == null) return
      const price = candlesSeries.coordinateToPrice(p.point.y)
      if (price == null) return
      const at = Number(p.time) * 1000
      if (!draft) { draft = { originAt: at, knownAt: at, near: price, far: null, candidateId: null }; gt('poiGtStatus').textContent = 'Теперь кликните дальнюю границу' }
      else { draft.far = price; drawing = false; show(); clearOverlays(); restoreMainCandles(); const end = time(data.candles.at(-1).timestamp); line([{time:time(draft.originAt),value:draft.near},{time:end,value:draft.near}],{color:C.green,lineWidth:3}); line([{time:time(draft.originAt),value:draft.far},{time:end,value:draft.far}],{color:C.purple,lineWidth:3}) }
    })
  }
  let attachedChart = null
  setInterval(() => { if (chart && chart !== attachedChart) { attachedChart = chart; attach() } }, 250)
  gt('poiGtCandidate').onclick = () => { const c = typeof currentLiq === 'function' ? currentLiq() : null; if (!c) return alert('Сначала откройте Liquidity POI и выберите кандидата'); draft = { originAt:c.originAt, knownAt:c.knownAt, near:c.near, far:c.far, candidateId:c.id }; gt('poiGtDirection').value=c.direction; gt('poiGtClass').value=c.zoneClass; show() }
  const store = missing => {
    if (!draft || draft.far == null) return alert('Сначала нарисуйте near и far')
    const direction=gt('poiGtDirection').value
    if (direction==='long' && draft.far>=draft.near) return alert('Для LONG far должен быть ниже near')
    if (direction==='short' && draft.far<=draft.near) return alert('Для SHORT far должен быть выше near')
    const id=`manual-poi|${data?.dataset?.symbol}|${data?.dataset?.timeframe}|${draft.originAt}|${draft.near}|${draft.far}`, all=labels()
    all[id]={id,symbol:data?.dataset?.symbol,poiTf:data?.dataset?.timeframe,datasetUntil:data?.dataset?.until,direction,zoneClass:gt('poiGtClass').value,anchorAt:draft.originAt,anchorPrice:draft.near,near:draft.near,far:draft.far,knownAt:draft.knownAt,endAt:null,source:gt('poiGtSource').value,confidence:Number(gt('poiGtConfidence').value),candidateId:draft.candidateId,missingCandidate:missing,note:gt('poiGtNote').value.trim(),recordedAt:new Date().toISOString()};saveAll(all);draft=null;show()
  }
  gt('poiGtSave').onclick=()=>store(false);gt('poiGtMiss').onclick=()=>store(true)
  gt('poiGtExport').onclick=()=>{const blob=new Blob([JSON.stringify(Object.values(labels()),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`poi-ground-truth-${Date.now()}.json`;a.click();URL.revokeObjectURL(a.href)}
})()
