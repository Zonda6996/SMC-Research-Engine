/**
 * E1: mechanical exit policies over vendor labels. Spec frozen in
 * ci-results/e1-exit-policies-preregistration.md (committed before this file).
 *
 * 6 frozen policies; conservative intrabar rule (both-touch -> adverse fill);
 * vendor-style vs strict winrate; random-bar control; NO tuning.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mulberry32 } from './auditFngCaseControl.js'
import { loadReversalDatasets } from './config/reversalDatasets.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { parseBatch2Csv } from './runFngOosConfirmation.js'
import { ATR_LEN, computeAtr, median } from './runO1LabelOutcomes.js'

export const SEED = 4242
export const MAX_HOLD = 192
export const MIN_FORWARD = 48

export const POLICY_NAMES = ['fixed_1to1', 'fixed_2to1', 'wide_1to2', 'partial_be', 'be_only', 'time_stop'] as const
export type PolicyName = (typeof POLICY_NAMES)[number]

export interface TradeResult {
	realizedR: number
	exit: 'stop' | 'target' | 'be-scratch' | 'time' | 'forced'
	partialTaken: boolean
	bars: number
}

/**
 * Simulate one trade under one policy. Frozen conservative rule: if a bar's
 * range covers both the current adverse level and a favorable level, the
 * ADVERSE fill happens first.
 */
export function simulateTrade(rows: ExactIndicatorRow[], atr: number[], index: number, direction: 'long' | 'short', policy: PolicyName): TradeResult | null {
	const r = atr[index]
	if (!Number.isFinite(r) || r! <= 0) return null
	const last = Math.min(index + MAX_HOLD, rows.length - 1)
	if (last - index < MIN_FORWARD) return null
	const entry = rows[index]!.close
	const sign = direction === 'long' ? 1 : -1
	const favR = (price: number) => (sign * (price - entry)) / r!
	// per-bar favorable extreme / adverse extreme in R
	const barFav = (b: ExactIndicatorRow) => favR(sign > 0 ? b.high : b.low)
	const barAdv = (b: ExactIndicatorRow) => -favR(sign > 0 ? b.low : b.high) // positive = adverse depth in R

	let stopR: number // adverse depth where we stop (positive number)
	let targetR: number | null
	let timeLimit: number | null = null
	let beTriggerR: number | null = null // favorable level that moves stop to BE
	let partialAtR: number | null = null
	switch (policy) {
		case 'fixed_1to1': stopR = 1; targetR = 1; break
		case 'fixed_2to1': stopR = 1; targetR = 2; break
		case 'wide_1to2': stopR = 2; targetR = 1; break
		case 'partial_be': stopR = 2; targetR = 2; partialAtR = 1.14; beTriggerR = 1.14; break
		case 'be_only': stopR = 2; targetR = 3; beTriggerR = 1; break
		case 'time_stop': stopR = 2; targetR = 2; timeLimit = 96; break
	}

	let beActive = false
	let partialTaken = false
	let bankedR = 0 // realized from partial
	let fraction = 1 // open fraction
	for (let i = index + 1; i <= last; i++) {
		const b = rows[i]!
		const fav = barFav(b)
		const adv = barAdv(b)
		const bars = i - index
		// 1) adverse first (frozen conservative)
		if (!beActive && adv >= stopR) {
			return { realizedR: bankedR - stopR * fraction, exit: 'stop', partialTaken, bars }
		}
		if (beActive && adv >= 0) {
			// BE stop at entry: adverse depth >= 0 means entry touched
			return { realizedR: bankedR, exit: 'be-scratch', partialTaken, bars }
		}
		// 2) partial fill
		if (partialAtR != null && !partialTaken && fav >= partialAtR) {
			partialTaken = true
			bankedR += 0.5 * partialAtR
			fraction = 0.5
		}
		// 3) BE trigger
		if (beTriggerR != null && !beActive && fav >= beTriggerR) beActive = true
		// 4) target
		if (targetR != null && fav >= targetR) {
			return { realizedR: bankedR + targetR * fraction, exit: 'target', partialTaken, bars }
		}
		// 5) time stop
		if (timeLimit != null && bars >= timeLimit) {
			return { realizedR: bankedR + favR(b.close) * fraction, exit: 'time', partialTaken, bars }
		}
	}
	const closeR = favR(rows[last]!.close)
	return { realizedR: bankedR + closeR * fraction, exit: 'forced', partialTaken, bars: last - index }
}

export interface PolicySummary {
	n: number
	winrateVendorStyle: number
	winrateStrict: number
	expectancy: number
	medianR: number
	stopRate: number
	partialBeRate: number
	timeExitRate: number
	maxDrawdownR: number
}

export function summarizePolicy(trades: TradeResult[]): PolicySummary {
	const n = trades.length
	if (n === 0) return { n: 0, winrateVendorStyle: NaN, winrateStrict: NaN, expectancy: NaN, medianR: NaN, stopRate: NaN, partialBeRate: NaN, timeExitRate: NaN, maxDrawdownR: NaN }
	let cum = 0
	let peak = 0
	let mdd = 0
	for (const t of trades) {
		cum += t.realizedR
		peak = Math.max(peak, cum)
		mdd = Math.max(mdd, peak - cum)
	}
	return {
		n,
		winrateVendorStyle: trades.filter((t) => t.realizedR > 0).length / n,
		winrateStrict: trades.filter((t) => t.realizedR >= 0.5).length / n,
		expectancy: trades.reduce((a, t) => a + t.realizedR, 0) / n,
		medianR: median(trades.map((t) => t.realizedR)),
		stopRate: trades.filter((t) => t.exit === 'stop').length / n,
		partialBeRate: trades.filter((t) => t.partialTaken && t.exit === 'be-scratch').length / n,
		timeExitRate: trades.filter((t) => t.exit === 'time' || t.exit === 'forced').length / n,
		maxDrawdownR: mdd,
	}
}

function tfClassOf(tf: string): '1m-5m' | '15m' | '1h-2h' {
	if (tf === '1m' || tf === '3m' || tf === '5m') return '1m-5m'
	if (tf === '15m') return '15m'
	return '1h-2h'
}

async function main() {
	interface Bundle { id: string; tfClass: string; inPool: boolean; rows: ExactIndicatorRow[]; startAt: number }
	const bundles: Bundle[] = []
	for (const ds of loadReversalDatasets()) bundles.push({ id: ds.meta.id, tfClass: tfClassOf(ds.meta.timeframe), inPool: true, rows: ds.rows, startAt: 0 })
	const manifest = JSON.parse(readFileSync(resolve('data/vendor-exports/manifest-batch2.json'), 'utf8')) as { datasets: Array<{ id: string; file: string; timeframe: string; warmupRows: number }> }
	const EXCLUDED = new Set(['btc-perp-15m-b2', 'btc-perp-1h-b2'])
	for (const ds of manifest.datasets) {
		bundles.push({ id: ds.id, tfClass: tfClassOf(ds.timeframe), inPool: !EXCLUDED.has(ds.id), rows: parseBatch2Csv(readFileSync(resolve('data/vendor-exports', ds.file), 'utf8')), startAt: ds.warmupRows })
	}

	const rng = mulberry32(SEED)
	type Cohort = 'labels' | 'control'
	const pooled: Record<PolicyName, Record<Cohort, TradeResult[]>> = Object.fromEntries(POLICY_NAMES.map((p) => [p, { labels: [], control: [] }])) as never
	const byDir: Record<PolicyName, Record<'long' | 'short', TradeResult[]>> = Object.fromEntries(POLICY_NAMES.map((p) => [p, { long: [], short: [] }])) as never
	const byTf: Record<PolicyName, Record<string, TradeResult[]>> = Object.fromEntries(POLICY_NAMES.map((p) => [p, { '1m-5m': [], '15m': [], '1h-2h': [] }])) as never
	const perDataset: Array<{ id: string; inPool: boolean; n: number; policies: Record<PolicyName, { labels: PolicySummary; control: PolicySummary }> }> = []

	for (const b of bundles) {
		const atr = computeAtr(b.rows)
		const signals: Array<{ index: number; direction: 'long' | 'short' }> = []
		for (let i = b.startAt; i < b.rows.length; i++) {
			const row = b.rows[i]!
			if (row.buy || row.sell) signals.push({ index: i, direction: row.buy ? 'long' : 'short' })
		}
		// random control (matched count; one shared draw across policies)
		const eligible: number[] = []
		for (let i = Math.max(b.startAt, ATR_LEN); i < b.rows.length - MIN_FORWARD; i++) eligible.push(i)
		const controls: Array<{ index: number; direction: 'long' | 'short' }> = []
		let guard = 0
		while (controls.length < signals.length && guard < signals.length * 50) {
			guard++
			const idx = eligible[Math.floor(rng() * eligible.length)]!
			if (Number.isFinite(atr[idx]) && atr[idx]! > 0) controls.push({ index: idx, direction: rng() < 0.5 ? 'long' : 'short' })
		}
		const dsEntry: (typeof perDataset)[number] = { id: b.id, inPool: b.inPool, n: 0, policies: {} as never }
		for (const p of POLICY_NAMES) {
			const lt: TradeResult[] = []
			for (const s of signals) {
				const t = simulateTrade(b.rows, atr, s.index, s.direction, p)
				if (t) lt.push(t)
			}
			const ct: TradeResult[] = []
			for (const s of controls) {
				const t = simulateTrade(b.rows, atr, s.index, s.direction, p)
				if (t) ct.push(t)
			}
			dsEntry.n = lt.length
			dsEntry.policies[p] = { labels: summarizePolicy(lt), control: summarizePolicy(ct) }
			if (b.inPool) {
				pooled[p].labels.push(...lt)
				pooled[p].control.push(...ct)
			}
		}
		if (b.inPool) {
			for (const s of signals) {
				for (const p of POLICY_NAMES) {
					const t = simulateTrade(b.rows, atr, s.index, s.direction, p)
					if (t) {
						byDir[p][s.direction].push(t)
						byTf[p][b.tfClass]!.push(t)
					}
				}
			}
		}
		perDataset.push(dsEntry)
		console.log(`[done] ${b.id}: signals=${signals.length}`)
	}

	const report = {
		config: { seed: SEED, maxHold: MAX_HOLD, minForward: MIN_FORWARD, policies: POLICY_NAMES },
		pooled: Object.fromEntries(POLICY_NAMES.map((p) => [p, { labels: summarizePolicy(pooled[p].labels), control: summarizePolicy(pooled[p].control) }])),
		byDirection: Object.fromEntries(POLICY_NAMES.map((p) => [p, { long: summarizePolicy(byDir[p].long), short: summarizePolicy(byDir[p].short) }])),
		byTimeframe: Object.fromEntries(POLICY_NAMES.map((p) => [p, Object.fromEntries(Object.entries(byTf[p]).map(([k, v]) => [k, summarizePolicy(v)]))])),
		perDataset,
	}
	writeFileSync(resolve('ci-results/e1-exit-policies.json'), JSON.stringify(report, null, 2))

	const pc = (x: number) => (x * 100).toFixed(1) + '%'
	const md: string[] = []
	md.push('# E1 mechanical exit policies over labels')
	md.push('')
	md.push('Pre-registration: `e1-exit-policies-preregistration.md`. Conservative intrabar rule (both-touch -> adverse). Vendor-style win = realized R > 0 (partial+BE counts as win). Control = matched random bars (seed 4242).')
	md.push('')
	md.push('## Pooled')
	md.push('')
	md.push('| policy | cohort | n | WR vendor | WR strict | expectancy R | median R | stop rate | partial->BE | time/forced |')
	md.push('|---|---|---|---|---|---|---|---|---|---|')
	for (const p of POLICY_NAMES) {
		const l = (report.pooled as never as Record<string, { labels: PolicySummary; control: PolicySummary }>)[p]!
		md.push(`| ${p} | labels | ${l.labels.n} | ${pc(l.labels.winrateVendorStyle)} | ${pc(l.labels.winrateStrict)} | ${l.labels.expectancy.toFixed(3)} | ${l.labels.medianR.toFixed(2)} | ${pc(l.labels.stopRate)} | ${pc(l.labels.partialBeRate)} | ${pc(l.labels.timeExitRate)} |`)
		md.push(`| ${p} | control | ${l.control.n} | ${pc(l.control.winrateVendorStyle)} | ${pc(l.control.winrateStrict)} | ${l.control.expectancy.toFixed(3)} | ${l.control.medianR.toFixed(2)} | ${pc(l.control.stopRate)} | ${pc(l.control.partialBeRate)} | ${pc(l.control.timeExitRate)} |`)
	}
	md.push('')
	md.push('## Splits (labels only, pooled)')
	md.push('')
	md.push('| policy | LONG WR/exp | SHORT WR/exp | 1m-5m WR/exp | 15m WR/exp | 1h-2h WR/exp |')
	md.push('|---|---|---|---|---|---|')
	for (const p of POLICY_NAMES) {
		const d = (report.byDirection as never as Record<string, { long: PolicySummary; short: PolicySummary }>)[p]!
		const t = (report.byTimeframe as never as Record<string, Record<string, PolicySummary>>)[p]!
		const f = (s: PolicySummary) => `${pc(s.winrateVendorStyle)} / ${s.expectancy.toFixed(2)}`
		md.push(`| ${p} | ${f(d.long)} | ${f(d.short)} | ${f(t['1m-5m']!)} | ${f(t['15m']!)} | ${f(t['1h-2h']!)} |`)
	}
	writeFileSync(resolve('ci-results/e1-exit-policies.md'), md.join('\n'))
	for (const p of POLICY_NAMES) {
		const l = (report.pooled as never as Record<string, { labels: PolicySummary; control: PolicySummary }>)[p]!
		console.log(`${p}: labels WR=${pc(l.labels.winrateVendorStyle)} exp=${l.labels.expectancy.toFixed(3)} | control WR=${pc(l.control.winrateVendorStyle)} exp=${l.control.expectancy.toFixed(3)}`)
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
