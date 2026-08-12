import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exactEvents, loadExactDatasets, type ExactDirection, type ExactIndicatorDataset } from './lib/exactIndicatorExport.js'

type SideEpisode = {
	direction: ExactDirection
	start: number
	end: number
	innerBars: number
	outerBars: number
	minRsi: number
	maxRsi: number
	minStoch: number
	maxStoch: number
	hasLabel: boolean
	labelOffsets: number[]
}

function rsi(values: number[], period: number): number[] {
	const out = new Array<number>(values.length).fill(NaN)
	let gains = 0, losses = 0
	for (let i = 1; i < values.length; i++) {
		const delta = values[i]! - values[i - 1]!
		gains += Math.max(0, delta)
		losses += Math.max(0, -delta)
		if (i > period) {
			const old = values[i - period]! - values[i - period - 1]!
			gains -= Math.max(0, old)
			losses -= Math.max(0, -old)
		}
		if (i >= period) out[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses)
	}
	return out
}

function stochastic(dataset: ExactIndicatorDataset, period: number): number[] {
	const out = new Array<number>(dataset.rows.length).fill(NaN)
	for (let i = period - 1; i < dataset.rows.length; i++) {
		let low = Infinity, high = -Infinity
		for (let j = i - period + 1; j <= i; j++) { low = Math.min(low, dataset.rows[j]!.low); high = Math.max(high, dataset.rows[j]!.high) }
		out[i] = 100 * (dataset.rows[i]!.close - low) / Math.max(1e-12, high - low)
	}
	return out
}

function outer(row: ExactIndicatorDataset['rows'][number], direction: ExactDirection): number {
	const ratio = 9.6 / 5.6
	return direction === 'long'
		? row.mean * Math.exp(Math.log(row.lowerInner / row.mean) * ratio)
		: row.mean * Math.exp(Math.log(row.upperInner / row.mean) * ratio)
}

function episodes(dataset: ExactIndicatorDataset): SideEpisode[] {
	const rsi14 = rsi(dataset.rows.map((row) => row.close), 14)
	const stoch14 = stochastic(dataset, 14)
	const result: SideEpisode[] = []
	for (const direction of ['long', 'short'] as const) {
		let current: SideEpisode | null = null
		for (let i = 0; i < dataset.rows.length; i++) {
			const row = dataset.rows[i]!
			const beyondInner = direction === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
			const beyondOuter = direction === 'long' ? row.low <= outer(row, direction) : row.high >= outer(row, direction)
			const neutralClose = direction === 'long' ? row.close >= row.mean : row.close <= row.mean
			const label = direction === 'long' ? row.buy : row.sell
			if (!current && beyondInner) current = { direction, start: i, end: i, innerBars: 0, outerBars: 0, minRsi: Infinity, maxRsi: -Infinity, minStoch: Infinity, maxStoch: -Infinity, hasLabel: false, labelOffsets: [] }
			if (current) {
				current.end = i
				if (beyondInner) current.innerBars++
				if (beyondOuter) current.outerBars++
				if (Number.isFinite(rsi14[i])) { current.minRsi = Math.min(current.minRsi, rsi14[i]!); current.maxRsi = Math.max(current.maxRsi, rsi14[i]!) }
				if (Number.isFinite(stoch14[i])) { current.minStoch = Math.min(current.minStoch, stoch14[i]!); current.maxStoch = Math.max(current.maxStoch, stoch14[i]!) }
				if (label) { current.hasLabel = true; current.labelOffsets.push(i - current.start) }
				if (neutralClose || i - current.start >= 256) { result.push(current); current = null }
			}
		}
		if (current) result.push(current)
	}
	return result
}

function quantile(values: number[], p: number): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!
}

function summarize(dataset: ExactIndicatorDataset) {
	const eps = episodes(dataset)
	const positive = eps.filter((episode) => episode.hasLabel)
	const negative = eps.filter((episode) => !episode.hasLabel)
	const events = exactEvents(dataset.rows)
	const gaps: Record<ExactDirection, number[]> = { long: [], short: [] }
	for (const direction of ['long', 'short'] as const) {
		const directional = events.filter((event) => event.direction === direction)
		for (let i = 1; i < directional.length; i++) gaps[direction].push((directional[i]!.at - directional[i - 1]!.at) / dataset.meta.timeframeMs)
	}
	const stats = (xs: SideEpisode[]) => ({
		n: xs.length,
		durationMedian: quantile(xs.map((x) => x.end - x.start + 1), 0.5),
		durationP90: quantile(xs.map((x) => x.end - x.start + 1), 0.9),
		innerBarsMedian: quantile(xs.map((x) => x.innerBars), 0.5),
		outerShare: xs.length ? xs.filter((x) => x.outerBars > 0).length / xs.length : 0,
		minRsiMedian: quantile(xs.map((x) => x.minRsi).filter(Number.isFinite), 0.5),
		maxRsiMedian: quantile(xs.map((x) => x.maxRsi).filter(Number.isFinite), 0.5),
		labelOffsetMedian: quantile(xs.flatMap((x) => x.labelOffsets), 0.5),
		labelOffsetP90: quantile(xs.flatMap((x) => x.labelOffsets), 0.9),
	})
	return {
		datasetId: dataset.meta.id,
		market: dataset.meta.market,
		timeframe: dataset.meta.timeframe,
		labels: events.length,
		episodes: eps.length,
		positiveEpisodeShare: positive.length / Math.max(1, eps.length),
		positive: stats(positive),
		negative: stats(negative),
		sameSideGapBars: {
			long: { median: quantile(gaps.long, 0.5), p10: quantile(gaps.long, 0.1), p90: quantile(gaps.long, 0.9) },
			short: { median: quantile(gaps.short, 0.5), p10: quantile(gaps.short, 0.1), p90: quantile(gaps.short, 0.9) },
		},
	}
}

const datasets = loadExactDatasets()
const summaries = datasets.map(summarize)
const md = `# Reversal chronology diagnosis v2 input\n\n${summaries.map((s) => `## ${s.datasetId}\n\n- ${s.labels} labels inside ${s.episodes} inner-zone episodes; positive episode share ${(100 * s.positiveEpisodeShare).toFixed(2)}%.\n- Positive episode duration median/p90: ${s.positive.durationMedian}/${s.positive.durationP90}; negative: ${s.negative.durationMedian}/${s.negative.durationP90}.\n- Positive label offset from first inner visit median/p90: ${s.positive.labelOffsetMedian}/${s.positive.labelOffsetP90}.\n- Outer reached: positive ${(100 * s.positive.outerShare).toFixed(1)}%, negative ${(100 * s.negative.outerShare).toFixed(1)}%.\n- Same-side gap median bars: BUY ${s.sameSideGapBars.long.median}, SELL ${s.sameSideGapBars.short.median}.`).join('\n\n')}\n\n## Interpretation\n\nThis report treats a visit below/above the exported inner band as an episode that ends at a close through the mean. It measures whether labels are tied to first-touch, dwell, outer penetration or long episode memory before adding those states to the v2 grammar. No future return or PnL is used.\n`
mkdirSync(resolve('ci-results'), { recursive: true })
writeFileSync(resolve('ci-results/reversal-chronology-diagnosis-v2.json'), JSON.stringify({ summaries }, null, 2))
writeFileSync(resolve('ci-results/reversal-chronology-diagnosis-v2.md'), md)
console.log(md)
