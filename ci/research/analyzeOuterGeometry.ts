import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadExactDatasets, type ExactDirection, type ExactIndicatorDataset } from './lib/exactIndicatorExport.js'

type LabelRow = { datasetId: string; direction: ExactDirection; index: number; at: number; outerPen: number; innerPen: number; meanDistance: number; closeInsideMean: boolean; prevOuter: boolean; currentOuter: boolean; previousLabelGap: number | null }

function width(row: ExactIndicatorDataset['rows'][number]): number { return Math.max(1e-12, (row.upperInner - row.lowerInner) / 5.6) }
function penetration(row: ExactIndicatorDataset['rows'][number], side: ExactDirection): number {
	const w = width(row)
	return side === 'long' ? Math.max(0, (row.lowerOuter - row.low) / w) : Math.max(0, (row.high - row.upperOuter) / w)
}
function innerPenetration(row: ExactIndicatorDataset['rows'][number], side: ExactDirection): number {
	const w = width(row)
	return side === 'long' ? Math.max(0, (row.lowerInner - row.low) / w) : Math.max(0, (row.high - row.upperInner) / w)
}
function direction(row: ExactIndicatorDataset['rows'][number], side: ExactDirection): boolean { return side === 'long' ? row.close > row.open : row.close < row.open }
function quantile(xs: number[], p: number): number | null { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]! }
function build(dataset: ExactIndicatorDataset): LabelRow[] {
	const out: LabelRow[] = []
	const previous: Record<ExactDirection, number | null> = { long: null, short: null }
	for (let i = 0; i < dataset.rows.length; i++) {
		const row = dataset.rows[i]!
		for (const side of ['long', 'short'] as const) {
			const label = side === 'long' ? row.buy : row.sell
			if (!label) continue
			const prev = dataset.rows[i - 1]
			const currentOuter = side === 'long' ? row.low <= row.lowerOuter : row.high >= row.upperOuter
			const prevOuter = prev ? side === 'long' ? prev.low <= prev.lowerOuter : prev.high >= prev.upperOuter : false
			const meanDistance = side === 'long' ? (row.mean - row.close) / width(row) : (row.close - row.mean) / width(row)
			out.push({ datasetId: dataset.meta.id, direction: side, index: i, at: row.timestamp, outerPen: penetration(row, side), innerPen: innerPenetration(row, side), meanDistance, closeInsideMean: side === 'long' ? row.close < row.mean : row.close > row.mean, prevOuter, currentOuter, previousLabelGap: previous[side] == null ? null : i - previous[side]! })
			previous[side] = i
		}
	}
	return out
}
function summarize(rows: LabelRow[]) {
	const by = (direction: ExactDirection) => rows.filter((row) => row.direction === direction)
	return (['all', 'long', 'short'] as const).map((key) => {
		const xs = key === 'all' ? rows : by(key)
		return { key, n: xs.length, currentOuter: xs.filter((x) => x.currentOuter).length / Math.max(1, xs.length), prevOuter: xs.filter((x) => x.prevOuter).length / Math.max(1, xs.length), outerPenMedian: quantile(xs.map((x) => x.outerPen), .5), outerPenP90: quantile(xs.map((x) => x.outerPen), .9), innerPenMedian: quantile(xs.map((x) => x.innerPen), .5), meanDistanceMedian: quantile(xs.map((x) => x.meanDistance), .5), meanDistanceP90: quantile(xs.map((x) => x.meanDistance), .9), previousLabelGapMedian: quantile(xs.map((x) => x.previousLabelGap).filter((x): x is number => x != null), .5) }
	})
}
const datasets = loadExactDatasets()
const labels = datasets.flatMap(build)
const summaries = datasets.map((dataset) => ({ datasetId: dataset.meta.id, rows: summarize(labels.filter((row) => row.datasetId === dataset.meta.id)) }))
const md = `# Reversal Outer geometry analysis\n\nOuter lines are now available in the two extended BTC exports. This report measures whether exact labels require current/previous outer penetration in addition to inner episode context.\n\n${summaries.map((dataset) => `## ${dataset.datasetId}\n\n| Slice | n | Current outer | Previous outer | Outer penetration median | Outer penetration p90 | Inner penetration median | Mean distance median | Same-side gap median |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${dataset.rows.map((x) => `| ${x.key} | ${x.n} | ${(100 * x.currentOuter).toFixed(1)}% | ${(100 * x.prevOuter).toFixed(1)}% | ${x.outerPenMedian?.toFixed(2) ?? 'null'} | ${x.outerPenP90?.toFixed(2) ?? 'null'} | ${x.innerPenMedian?.toFixed(2) ?? 'null'} | ${x.meanDistanceMedian?.toFixed(2) ?? 'null'} | ${x.previousLabelGapMedian?.toFixed(1) ?? 'null'} |`).join('\n')}`).join('\n\n')}\n\n## Caveat\n\nThese are label-bar fingerprints, not a detector. The next search must compare these states against matched no-label episodes and retain chronological one-shot semantics.\n`
mkdirSync(resolve('ci-results'), { recursive: true }); writeFileSync(resolve('ci-results/reversal-outer-geometry-v2.json'), JSON.stringify({ labels, summaries }, null, 2)); writeFileSync(resolve('ci-results/reversal-outer-geometry-v2.md'), md); console.log(md)
