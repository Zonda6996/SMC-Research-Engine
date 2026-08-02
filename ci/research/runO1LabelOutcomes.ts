/**
 * O1: post-label outcome statistics. Spec frozen in
 * ci-results/o1-label-outcomes-preregistration.md (committed before this file).
 *
 * Measures raw price behavior after each vendor label against a frozen,
 * indicator-independent yardstick (R = ATR14 of the label bar), with a matched
 * random-bar control. NOT a backtest of vendor exit logic.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mulberry32 } from './auditFngCaseControl.js'
import { loadReversalDatasets } from './config/reversalDatasets.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { parseBatch2Csv } from './runFngOosConfirmation.js'

export const SEED = 4242
export const HORIZON = 96
export const MIN_FORWARD = 24
export const K_LADDER = [0.5, 1.0, 1.14, 1.5, 2.0] as const
export const ATR_LEN = 14

/** Wilder ATR(14); NaN until seeded. */
export function computeAtr(rows: ExactIndicatorRow[], len = ATR_LEN): number[] {
	const n = rows.length
	const atr = new Array<number>(n).fill(NaN)
	let acc = 0
	for (let i = 0; i < n; i++) {
		const r = rows[i]!
		const tr = i === 0 ? r.high - r.low : Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1]!.close), Math.abs(r.low - rows[i - 1]!.close))
		if (i < len) {
			acc += tr
			if (i === len - 1) atr[i] = acc / len
		} else {
			atr[i] = (atr[i - 1]! * (len - 1) + tr) / len
		}
	}
	return atr
}

export interface LabelOutcome {
	index: number
	direction: 'long' | 'short'
	forwardBars: number
	mfe: number
	mae: number
	/** per k: 'fav' | 'adv' | 'none' (intrabar tie counted adverse, frozen) */
	firstTouch: Record<string, 'fav' | 'adv' | 'none'>
	barsToPlus1R: number | null
	terminal24: number | null
	terminal96: number | null
}

/** Measure one signal (label or control) with the frozen definitions. */
export function measureOutcome(rows: ExactIndicatorRow[], atr: number[], index: number, direction: 'long' | 'short'): LabelOutcome | null {
	const r = atr[index]
	if (!Number.isFinite(r) || r! <= 0) return null
	const entry = rows[index]!.close
	const last = Math.min(index + HORIZON, rows.length - 1)
	const forwardBars = last - index
	if (forwardBars < MIN_FORWARD) return null
	const sign = direction === 'long' ? 1 : -1
	let mfe = 0
	let mae = 0
	const firstTouch: Record<string, 'fav' | 'adv' | 'none'> = {}
	const touched: Record<string, boolean> = {}
	for (const k of K_LADDER) firstTouch[String(k)] = 'none'
	let barsToPlus1R: number | null = null
	let terminal24: number | null = null
	let terminal96: number | null = null
	for (let i = index + 1; i <= last; i++) {
		const bar = rows[i]!
		const fav = (sign * ((sign > 0 ? bar.high : bar.low) - entry)) / r!
		const adv = (sign * (entry - (sign > 0 ? bar.low : bar.high))) / r!
		mfe = Math.max(mfe, fav)
		mae = Math.max(mae, adv)
		for (const k of K_LADDER) {
			const key = String(k)
			if (touched[key]) continue
			const hitFav = fav >= k
			const hitAdv = adv >= k
			if (hitFav || hitAdv) {
				touched[key] = true
				firstTouch[key] = hitAdv ? 'adv' : 'fav' // tie -> adverse (frozen, conservative)
			}
		}
		if (barsToPlus1R == null && fav >= 1) barsToPlus1R = i - index
		if (i - index === 24) terminal24 = (sign * (bar.close - entry)) / r!
		if (i - index === HORIZON) terminal96 = (sign * (bar.close - entry)) / r!
	}
	return { index, direction, forwardBars, mfe, mae, firstTouch, barsToPlus1R, terminal24, terminal96 }
}

export function median(xs: number[]): number {
	if (xs.length === 0) return NaN
	const s = [...xs].sort((a, b) => a - b)
	const m = Math.floor(s.length / 2)
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export interface OutcomeSummary {
	n: number
	winRate: Record<string, number>
	medianMfe: number
	medianMae: number
	medianBarsToPlus1R: number
	reached1R: number
	meanTerminal24: number
	meanTerminal96: number
}

export function summarize(outs: LabelOutcome[]): OutcomeSummary {
	const winRate: Record<string, number> = {}
	for (const k of K_LADDER) {
		const key = String(k)
		const decided = outs.filter((o) => o.firstTouch[key] !== 'none')
		winRate[key] = decided.length > 0 ? decided.filter((o) => o.firstTouch[key] === 'fav').length / decided.length : NaN
	}
	const t24 = outs.map((o) => o.terminal24).filter((x): x is number => x != null)
	const t96 = outs.map((o) => o.terminal96).filter((x): x is number => x != null)
	const bars1 = outs.map((o) => o.barsToPlus1R).filter((x): x is number => x != null)
	return {
		n: outs.length,
		winRate,
		medianMfe: median(outs.map((o) => o.mfe)),
		medianMae: median(outs.map((o) => o.mae)),
		medianBarsToPlus1R: median(bars1),
		reached1R: outs.length > 0 ? bars1.length / outs.length : NaN,
		meanTerminal24: t24.length ? t24.reduce((a, b) => a + b, 0) / t24.length : NaN,
		meanTerminal96: t96.length ? t96.reduce((a, b) => a + b, 0) / t96.length : NaN,
	}
}

interface DatasetBundle {
	id: string
	tfClass: '1m-5m' | '15m' | '1h-2h'
	inPool: boolean
	rows: ExactIndicatorRow[]
	startAt: number
}

function tfClassOf(tf: string): DatasetBundle['tfClass'] {
	if (tf === '1m' || tf === '3m' || tf === '5m') return '1m-5m'
	if (tf === '15m') return '15m'
	return '1h-2h'
}

async function main() {
	const bundles: DatasetBundle[] = []
	for (const ds of loadReversalDatasets()) {
		bundles.push({ id: ds.meta.id, tfClass: tfClassOf(ds.meta.timeframe), inPool: true, rows: ds.rows, startAt: 0 })
	}
	const manifest = JSON.parse(readFileSync(resolve('data/vendor-exports/manifest-batch2.json'), 'utf8')) as {
		datasets: Array<{ id: string; file: string; timeframe: string; warmupRows: number }>
	}
	const EXCLUDED_FROM_POOL = new Set(['btc-perp-15m-b2', 'btc-perp-1h-b2'])
	for (const ds of manifest.datasets) {
		const rows = parseBatch2Csv(readFileSync(resolve('data/vendor-exports', ds.file), 'utf8'))
		bundles.push({ id: ds.id, tfClass: tfClassOf(ds.timeframe), inPool: !EXCLUDED_FROM_POOL.has(ds.id), rows, startAt: ds.warmupRows })
	}

	const rng = mulberry32(SEED)
	const perDataset: Array<{ id: string; tfClass: string; inPool: boolean; labels: OutcomeSummary; control: OutcomeSummary }> = []
	const pooledLabels: LabelOutcome[] = []
	const pooledControls: LabelOutcome[] = []
	const pooledByDir: Record<'long' | 'short', LabelOutcome[]> = { long: [], short: [] }
	const pooledByTf: Record<string, LabelOutcome[]> = { '1m-5m': [], '15m': [], '1h-2h': [] }

	for (const b of bundles) {
		const atr = computeAtr(b.rows)
		const labelOuts: LabelOutcome[] = []
		for (let i = b.startAt; i < b.rows.length; i++) {
			const row = b.rows[i]!
			if (!row.buy && !row.sell) continue
			const out = measureOutcome(b.rows, atr, i, row.buy ? 'long' : 'short')
			if (out) labelOuts.push(out)
		}
		// matched random control: same count, uniform over eligible bars, coin-flip direction
		const eligible: number[] = []
		for (let i = Math.max(b.startAt, ATR_LEN); i < b.rows.length - MIN_FORWARD; i++) eligible.push(i)
		const controlOuts: LabelOutcome[] = []
		let guard = 0
		while (controlOuts.length < labelOuts.length && guard < labelOuts.length * 50) {
			guard++
			const idx = eligible[Math.floor(rng() * eligible.length)]!
			const out = measureOutcome(b.rows, atr, idx, rng() < 0.5 ? 'long' : 'short')
			if (out) controlOuts.push(out)
		}
		perDataset.push({ id: b.id, tfClass: b.tfClass, inPool: b.inPool, labels: summarize(labelOuts), control: summarize(controlOuts) })
		if (b.inPool) {
			pooledLabels.push(...labelOuts)
			pooledControls.push(...controlOuts)
			for (const o of labelOuts) {
				pooledByDir[o.direction].push(o)
				pooledByTf[b.tfClass]!.push(o)
			}
		}
		console.log(`[done] ${b.id}: labels=${labelOuts.length} control=${controlOuts.length}`)
	}

	const report = {
		config: { seed: SEED, horizon: HORIZON, minForward: MIN_FORWARD, atrLen: ATR_LEN, kLadder: K_LADDER },
		perDataset,
		pooled: {
			labels: summarize(pooledLabels),
			control: summarize(pooledControls),
			byDirection: { long: summarize(pooledByDir.long), short: summarize(pooledByDir.short) },
			byTimeframe: Object.fromEntries(Object.entries(pooledByTf).map(([k, v]) => [k, summarize(v)])),
		},
	}
	writeFileSync(resolve('ci-results/o1-label-outcomes.json'), JSON.stringify(report, null, 2))

	const fmtWr = (s: OutcomeSummary) => K_LADDER.map((k) => ((s.winRate[String(k)] ?? NaN) * 100).toFixed(1) + '%').join(' | ')
	const md: string[] = []
	md.push('# O1 post-label outcome statistics')
	md.push('')
	md.push('Pre-registration: `o1-label-outcomes-preregistration.md`. R = ATR14 of label bar; horizon 96 bars; intrabar tie counted ADVERSE; random-bar control matched per dataset (seed 4242). NOT a backtest of vendor exit logic.')
	md.push('')
	md.push('## Pooled (14 datasets, BTC-b2 overlap excluded)')
	md.push('')
	md.push('| cohort | n | ft 0.5R | ft 1R | ft 1.14R | ft 1.5R | ft 2R | med MFE | med MAE | reached +1R | med bars to +1R | mean R@24 | mean R@96 |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	const row = (name: string, s: OutcomeSummary) =>
		`| ${name} | ${s.n} | ${fmtWr(s)} | ${s.medianMfe.toFixed(2)} | ${s.medianMae.toFixed(2)} | ${(s.reached1R * 100).toFixed(1)}% | ${s.medianBarsToPlus1R.toFixed(0)} | ${s.meanTerminal24.toFixed(3)} | ${s.meanTerminal96.toFixed(3)} |`
	md.push(row('labels', report.pooled.labels))
	md.push(row('random control', report.pooled.control))
	md.push(row('labels LONG', report.pooled.byDirection.long))
	md.push(row('labels SHORT', report.pooled.byDirection.short))
	for (const [tf, s] of Object.entries(report.pooled.byTimeframe)) md.push(row(`labels ${tf}`, s as OutcomeSummary))
	md.push('')
	md.push('## Per dataset (labels vs control)')
	md.push('')
	md.push('| dataset | pool | n | ft 1R | ft 2R | med MFE | med MAE | ctrl ft 1R | ctrl ft 2R |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const d of perDataset) {
		md.push(
			`| ${d.id} | ${d.inPool ? 'yes' : 'no'} | ${d.labels.n} | ${((d.labels.winRate['1'] ?? NaN) * 100).toFixed(1)}% | ${((d.labels.winRate['2'] ?? NaN) * 100).toFixed(1)}% | ${d.labels.medianMfe.toFixed(2)} | ${d.labels.medianMae.toFixed(2)} | ${((d.control.winRate['1'] ?? NaN) * 100).toFixed(1)}% | ${((d.control.winRate['2'] ?? NaN) * 100).toFixed(1)}% |`,
		)
	}
	writeFileSync(resolve('ci-results/o1-label-outcomes.md'), md.join('\n'))
	console.log('\npooled label ft1R:', ((report.pooled.labels.winRate['1'] ?? NaN) * 100).toFixed(1) + '%', 'control:', ((report.pooled.control.winRate['1'] ?? NaN) * 100).toFixed(1) + '%')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
