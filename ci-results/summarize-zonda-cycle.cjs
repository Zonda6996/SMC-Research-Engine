const fs=require('fs'); const r=require('./zonda-profitability-cycle.json');
const f=x=>x==null?'-':typeof x==='number'?x.toFixed(3):x;
let s='';
for(const v of ['baseline','H1_APEX_CONTRACTION_REGIME']){
 s+='## '+v+'\n';
 s+='|Mode|Split|N|Fin|F/P/S|Open/TO|Gross mean|Net mean|95% CI|Net total|PF|DD|Hold mean/med|/month|clusters|WR|\n|---|---|---:|---:|---|---|---:|---:|---|---:|---:|---:|---|---:|---:|---:|\n';
 for(const x of r.aggregate.filter(x=>x.variant===v)){const n=x.net,g=x.gross;s+=`|${x.mode}|${x.split}|${n.signals}|${n.finalized}|${n.outcomes.full}/${n.outcomes.terminalPartial}/${n.outcomes.stop}|${n.open}/${n.timeout}|${f(g.meanR)}|${f(n.meanR)}|[${f(n.ci95MeanR[0])}, ${f(n.ci95MeanR[1])}]|${f(n.totalR)}|${f(n.profitFactor)}|${f(n.maxDrawdownR)}|${f(n.holdingBars.mean)}/${f(n.holdingBars.median)}|${f(n.tradesPerMonth)}|${n.clusters}|${(n.vendorStyleWR*100).toFixed(1)}%|\n`}
}
s+='\n## Baseline OOS worst slices\n';
for(const m of ['safe','risk','standard']) for(const d of ['asset','timeframe','side']) {const a=r.slices.filter(x=>x.variant==='baseline'&&x.mode===m&&x.split==='oos'&&x.dimension===d&&x.net.signals).sort((a,b)=>a.net.meanR-b.net.meanR); s+=`${m} ${d}: ${a[0].key} n=${a[0].net.signals} mean=${f(a[0].net.meanR)}\n`}
s+='\n## H1 risk OOS assets\n';
for(const x of r.slices.filter(x=>x.variant==='H1_APEX_CONTRACTION_REGIME'&&x.mode==='risk'&&x.split==='oos'&&x.dimension==='asset'))s+=`${x.key} n=${x.net.signals} mean=${f(x.net.meanR)} total=${f(x.net.totalR)} CI=[${x.net.ci95MeanR.map(f).join(', ')}]\n`;
s+='\n## Sources\n'+r.sources.map(x=>`${x.asset} ${x.timeframe}: ${x.from} .. ${x.to}; split ${x.splitAt}`).join('\n')+'\n';
fs.writeFileSync('zonda-profitability-cycle-summary.md',s); console.log(s);
