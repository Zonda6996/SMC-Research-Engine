import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exactEvents, loadExactDatasets, type ExactDirection } from './lib/exactIndicatorExport.js'

function q(values: number[], p: number): number | null { if (!values.length) return null; const xs = [...values].sort((a, b) => a - b); return xs[Math.floor((xs.length - 1) * p)]! }
const datasets = loadExactDatasets()
const summaries = datasets.map((dataset) => {
	const events = exactEvents(dataset.rows)
	const sequence = events.map((event) => event.direction)
	let alternations = 0
	for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) alternations++
	const sideGaps: Record<ExactDirection, number[]> = { long: [], short: [] }
	const anyGaps: number[] = []
	const last: Record<ExactDirection, number | null> = { long: null, short: null }
	let previousAny: number | null = null
	const recoveryDistance: number[] = []
	const crossingDistance: number[] = []
	for (const event of events) {
		const i = dataset.rows.findIndex((row) => row.timestamp === event.at)
		if (last[event.direction] != null) sideGaps[event.direction].push(i - last[event.direction]!)
		if (previousAny != null) anyGaps.push(i - previousAny)
		last[event.direction] = i; previousAny = i
		const row = dataset.rows[i]!, previous = dataset.rows[i - 1]
		const halfInner = Math.max(1e-12, (row.upperInner - row.lowerInner) / 2)
		const distance = event.direction === 'long' ? (row.mean - row.close) / halfInner : (row.close - row.mean) / halfInner
		recoveryDistance.push(distance)
		if (previous) {
			const prevHalf = Math.max(1e-12, (previous.upperInner - previous.lowerInner) / 2)
			const prevDistance = event.direction === 'long' ? (previous.mean - previous.close) / prevHalf : (previous.close - previous.mean) / prevHalf
			crossingDistance.push(prevDistance - distance)
		}
	}
	const stats = (xs: number[]) => ({ min: q(xs, 0), p10: q(xs, .1), p25: q(xs, .25), median: q(xs, .5), p75: q(xs, .75), p90: q(xs, .9), max: q(xs, 1) })
	return { datasetId: dataset.meta.id, labels: events.length, alternationShare: alternations / Math.max(1, sequence.length - 1), anyGap: stats(anyGaps), longGap: stats(sideGaps.long), shortGap: stats(sideGaps.short), signalDistanceFromMeanInInnerHalfwidths: stats(recoveryDistance), oneBarRecoveryDelta: stats(crossingDistance) }
})
const md = `# Reversal timing and recovery diagnosis v3\n\n${summaries.map((x) => `## ${x.datasetId}\n\n- Labels: ${x.labels}; direction alternation share ${(100 * x.alternationShare).toFixed(1)}%.\n- Any-signal gap bars min/p10/p25/median/p75/p90/max: ${Object.values(x.anyGap).join(' / ')}.\n- BUY same-side gap: ${Object.values(x.longGap).join(' / ')}.\n- SELL same-side gap: ${Object.values(x.shortGap).join(' / ')}.\n- Signal close distance from mean in Inner-halfwidths: ${Object.values(x.signalDistanceFromMeanInInnerHalfwidths).map((v) => typeof v === 'number' ? v.toFixed(3) : 'null').join(' / ')}.\n- One-bar recovery delta: ${Object.values(x.oneBarRecoveryDelta).map((v) => typeof v === 'number' ? v.toFixed(3) : 'null').join(' / ')}.`).join('\n\n')}\n\nThe focused v3 search should model a recovery-level crossing after an earlier Inner/Outer visit, with independent one-shot and same-side re-arm.\n`
mkdirSync(resolve('ci-results'), { recursive: true }); writeFileSync(resolve('ci-results/reversal-timing-diagnosis-v3.json'), JSON.stringify({ summaries }, null, 2)); writeFileSync(resolve('ci-results/reversal-timing-diagnosis-v3.md'), md); console.log(md)
