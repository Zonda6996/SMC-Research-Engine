import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chronologicalSlices, developmentDatasets, futuresHoldouts, loadReversalDatasets, spotHoldouts } from './config/reversalDatasets.js'
import { exactEvents, type ExactIndicatorDataset } from './lib/exactIndicatorExport.js'
import { matchDirectionalEvents, type EventMetrics } from './lib/eventMetrics.js'
import { detectReversalRecoveries, REVERSAL_RECOVERY_RESEARCH_VERSION, type ReversalRecoveryConfig } from '../../src/core/signals/ReversalRecoveryResearch.js'

type Summary = Omit<EventMetrics, 'matches'>
type SliceScore = { datasetId: string; metrics: Summary }
type Ranked = { config: ReversalRecoveryConfig; fit: SliceScore[]; fitAggregate: Summary; validation?: SliceScore[]; validationAggregate?: Summary; objective: number }

function configs(): ReversalRecoveryConfig[] {
	const out: ReversalRecoveryConfig[] = []
	for (const arm of ['inner', 'outer'] as const) for (const recoveryLevel of [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9])
		for (const minRecoveryDelta of [0, 0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25]) for (const maxEpisodeBars of [64, 96, 128, 192, 256])
			for (const globalCooldownBars of [48, 56, 64, 72, 80, 96, 112, 128, 160, 192, 256]) for (const requireDirectional of [false, true]) for (const requireCloseInsideInner of [false, true])
				out.push({ arm, recoveryLevel, minRecoveryDelta, maxEpisodeBars, globalCooldownBars, requireDirectional, requireCloseInsideInner })
	return out
}
function strip(metrics: EventMetrics): Summary { const { matches: _matches, ...summary } = metrics; return summary }
function aggregate(scores: SliceScore[]): Summary { const tp=scores.reduce((s,x)=>s+x.metrics.tp,0),fp=scores.reduce((s,x)=>s+x.metrics.fp,0),fn=scores.reduce((s,x)=>s+x.metrics.fn,0); return {tp,fp,fn,precision:tp/Math.max(1,tp+fp),recall:tp/Math.max(1,tp+fn),f1:2*tp/Math.max(1,2*tp+fp+fn),predictions:tp+fp,truth:tp+fn} }
function score(datasets: ExactIndicatorDataset[], config: ReversalRecoveryConfig, split: 'fit'|'validation'|'sealed-test'|'all', tolerance=0): SliceScore[] {
	return datasets.map((dataset) => { const truth=exactEvents(dataset.rows),pred=detectReversalRecoveries(dataset.rows,config); let from=-Infinity,to=Infinity; if(split!=='all'){const s=chronologicalSlices(dataset).find(x=>x.kind===split)!;from=dataset.rows[s.fromIndex]!.timestamp;to=s.toIndexExclusive<dataset.rows.length?dataset.rows[s.toIndexExclusive]!.timestamp:Infinity} const range=<T extends{at:number}>(xs:T[])=>xs.filter(x=>x.at>=from&&x.at<to); return {datasetId:dataset.meta.id,metrics:strip(matchDirectionalEvents(range(truth),range(pred),dataset.meta.timeframeMs,tolerance))} })
}
function objective(x:Summary){if(x.recall<.25)return-1+x.recall;const ratio=x.predictions/Math.max(1,x.truth);return x.f1+.35*x.precision+.15*x.recall-.04*Math.abs(Math.log(Math.max(1e-6,ratio)))}
function pct(x:number){return`${(100*x).toFixed(2)}%`}
function rows(xs:SliceScore[]){return xs.map(x=>`| ${x.datasetId} | ${x.metrics.tp} | ${x.metrics.fp} | ${x.metrics.fn} | ${pct(x.metrics.precision)} | ${pct(x.metrics.recall)} | ${x.metrics.predictions} | ${(x.metrics.predictions/Math.max(1,x.metrics.truth)).toFixed(2)} |`).join('\n')}
const datasets=loadReversalDatasets(),development=developmentDatasets(datasets),grid=configs();console.log(`v3 grid ${grid.length}`)
const fit:Ranked[]=grid.map(config=>{const s=score(development,config,'fit'),a=aggregate(s);return{config,fit:s,fitAggregate:a,objective:objective(a)}}).sort((a,b)=>b.objective-a.objective)
const validation=fit.slice(0,400).map(x=>{const s=score(development,x.config,'validation'),a=aggregate(s);return{...x,validation:s,validationAggregate:a,objective:objective(a)}}).sort((a,b)=>b.objective-a.objective)
const winner=validation[0]!,sealed=score(development,winner.config,'sealed-test'),futures=score(futuresHoldouts(datasets),winner.config,'all'),spot=score(spotHoldouts(datasets),winner.config,'all'),sealedAgg=aggregate(sealed),futuresAgg=aggregate(futures),spotAgg=aggregate(spot),plusMinusOne=score(datasets,winner.config,'all',1)
const gate={passed:futures.every(x=>x.metrics.precision>=.15&&x.metrics.recall>=.4&&x.metrics.predictions/Math.max(1,x.metrics.truth)>=.5&&x.metrics.predictions/Math.max(1,x.metrics.truth)<=2)}
const report={version:REVERSAL_RECOVERY_RESEARCH_VERSION,protocol:{gridSize:grid.length,selection:'BTC15m/1h 50% fit -> top400 validation -> sealed25%; ETH/SOL/BTC5m/BTC4h untouched'},winner,sealed:{slices:sealed,aggregate:sealedAgg},futures:{slices:futures,aggregate:futuresAgg},spot:{slices:spot,aggregate:spotAgg},plusMinusOne,gate,topValidation:validation.slice(0,30)}
const md=`# Reversal recovery-crossing search v3\n\n- Exact Outer lines and extended histories: 86,420 rows / 370 labels.\n- Grid: ${grid.length} causal models.\n- Family: prior Inner/Outer visit → cross a normalized recovery level → one signal → global cooldown.\n\n## Winner\n\n\`\`\`json\n${JSON.stringify(winner.config,null,2)}\n\`\`\`\n\n| Split | Precision | Recall | F1 | Pred/original |\n|---|---:|---:|---:|---:|\n| fit | ${pct(winner.fitAggregate.precision)} | ${pct(winner.fitAggregate.recall)} | ${pct(winner.fitAggregate.f1)} | ${(winner.fitAggregate.predictions/winner.fitAggregate.truth).toFixed(2)} |\n| validation | ${pct(winner.validationAggregate!.precision)} | ${pct(winner.validationAggregate!.recall)} | ${pct(winner.validationAggregate!.f1)} | ${(winner.validationAggregate!.predictions/winner.validationAggregate!.truth).toFixed(2)} |\n| sealed BTC | ${pct(sealedAgg.precision)} | ${pct(sealedAgg.recall)} | ${pct(sealedAgg.f1)} | ${(sealedAgg.predictions/sealedAgg.truth).toFixed(2)} |\n\n## Futures holdouts\n\n| Dataset | TP | FP | FN | Precision | Recall | Pred | Ratio |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows(futures)}\n\nAggregate: ${pct(futuresAgg.precision)} precision / ${pct(futuresAgg.recall)} recall.\n\n## SOL Spot separate\n\n| Dataset | TP | FP | FN | Precision | Recall | Pred | Ratio |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows(spot)}\n\n## Strict gate\n\n${gate.passed?'**PASS**':'**FAIL**'}. Production remains unchanged on FAIL.\n`
mkdirSync(resolve('ci-results'),{recursive:true});writeFileSync(resolve('ci-results/reversal-recovery-search-v3.json'),JSON.stringify(report,null,2));writeFileSync(resolve('ci-results/reversal-recovery-search-v3.md'),md);console.log(md)
