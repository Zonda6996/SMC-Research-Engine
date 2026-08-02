/**
 * E2: band-trailed exits on HTF labels. Spec frozen in
 * ci-results/e2-band-trail-preregistration.md (committed before this file).
 *
 * First use of the vendor bands as an EXIT instrument (trail by prior-bar mean).
 * Success requires beating the band-free wide_hold benchmark, not just control.
 * Last band experiment per the pre-registration.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mulberry32 } from './auditFngCaseControl.js'
import { loadReversalDatasets } from './config/reversalDatasets.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { parseBatch2Csv } from './runFngOosConfirmation.js'
import { ATR_LEN, computeAtr } from './runO1LabelOutcomes.js'
import { simulateTrade, summarizePolicy, type PolicySummary, type TradeResult } from './runE1ExitPolicies.js'

export const SEED = 4242
export const MAX_HOLD = 192
export const MIN_FORWARD = 48

export const E2_POLICY_NAMES = ['band_trail', 'band_trail_be', 'wide_hold'] as const
export type E2PolicyName = (typeof E2_POLICY_NAMES)[number]

/**
 * Simulate one E2 trade. Frozen rules: initial SL -3R; trail arms at +1R
 * favorable excursion; trail exit = close of the bar whose extreme crosses the
 * PRIOR bar's mean against the trade. band_trail_be adds vendor-style partial
 * (50% at +1.14R, stop to entry). wide_hold has no TP/trail, force-close at 192.
 * Conservative ordering within a bar: stop/BE first, then partial, then trail.
 */
export function simulateE2Trade(rows: ExactIndicatorRow[], atr: number[], index: number, direction: 'long' | 'short', policy: E2PolicyName): TradeResult | null {
	const r = atr[index]
	if (!Number.isFinite(r) || r! <= 0) return null
	const last = Math.min(index + MAX_HOLD, rows.length - 1)
	if (last - index < MIN_FORWARD) return null
	const entry = rows[index]!.close
	const sign = direction === 'long' ? 1 : -1
	const favR = (price: number) => (sign * (price - entry)) / r!
	const STOP = 3
	const usePartial = policy === 'band_trail_be'
	const useTrail = policy !== 'wide_hold'

	let beActive = false
	let partialTaken = false
	let bankedR = 0
	let fraction = 1
	let trailArmed = false
	for (let i = index + 1; i <= last; i++) {
		const b = rows[i]!
		const fav = favR(sign > 0 ? b.high : b.low)
		const adv = -favR(sign > 0 ? b.low : b.high)
		const bars = i - index
		// 1) stop / BE (conservative first)
		if (!beActive && adv >= STOP) return { realizedR: bankedR - STOP * fraction, exit: 'stop', partialTaken, bars }
		if (beActive && adv >= 0) return { realizedR: bankedR, exit: 'be-scratch', partialTaken, bars }
		// 2) partial
		if (usePartial && !partialTaken && fav >= 1.14) {
			partialTaken = true
			bankedR += 0.5 * 1.14
			fraction = 0.5
			beActive = true
		}
		// 3) arm trail
		if (useTrail && !trailArmed && fav >= 1) trailArmed = true
		// 4) trail exit: extreme crosses PRIOR bar's mean against the trade
		if (useTrail && trailArmed) {
			const priorMean = rows[i - 1]!.mean
			const crossed = sign > 0 ? b.low < priorMean : b.high > priorMean
			if (crossed) return { realizedR: bankedR + favR(b.close) * fraction, exit: 'target', partialTaken, bars }
		}
	}
	return { realizedR: bankedR + favR(rows[last]!.close) * fraction, exit: policy === 'wide_hold' ? 'time' : 'forced', partialTaken, bars: last - index }
}

async function main() {
	interface Bundle { id: string; rows: ExactIndicatorRow[]; startAt: number }
	const bundles: Bundle[] = []
	const originalHtfTfs = new Set<string>()
	for (const ds of loadReversalDatasets()) {
		if (ds.meta.timeframe === '1h' || ds.meta.timeframe === '2h') {
			bundles.push({ id: ds.meta.id, rows: ds.rows, startAt: 0 })
			if (ds.meta.symbol === 'BTCUSDT.P') originalHtfTfs.add(ds.meta.timeframe)
		}
	}
	const manifest = JSON.parse(readFileSync(resolve('data/vendor-exports/manifest-batch2.json'), 'utf8')) as {
		datasets: Array<{ id: string; file: string; symbol: string; timeframe: string; warmupRows: number }>
	}
	for (const ds of manifest.datasets) {
		if (ds.timeframe !== '1h' && ds.timeframe !== '2h') continue
		if (ds.symbol === 'BTCUSDT.P' && originalHtfTfs.has(ds.timeframe)) continue // frozen overlap rule
		bundles.push({ id: ds.id, rows: parseBatch2Csv(readFileSync(resolve('data/vendor-exports', ds.file), 'utf8')), startAt: ds.warmupRows })
	}
	console.log('HTF datasets resolved:', bundles.map((b) => b.id).join(', '))

	const ALL = [...E2_POLICY_NAMES, 'fixed_2to1', 'partial_be'] as const
	const rng = mulberry32(SEED)
	const pooled: Record<string, { labels: TradeResult[]; control: TradeResult[] }> = Object.fromEntries(ALL.map((p) => [p, { labels: [], control: [] }]))
	const perDataset: Array<{ id: string; n: number; policies: Record<string, { labels: PolicySummary; control: PolicySummary }> }> = []

	for (const b of bundles) {
		const atr = computeAtr(b.rows)
		const signals: Array<{ index: number; direction: 'long' | 'short' }> = []
		for (let i = b.startAt; i < b.rows.length; i++) {
			const row = b.rows[i]!
			if (row.buy || row.sell) signals.push({ index: i, direction: row.buy ? 'long' : 'short' })
		}
		const eligible: number[] = []
		for (let i = Math.max(b.startAt, ATR_LEN); i < b.rows.length - MIN_FORWARD; i++) eligible.push(i)
		const controls: Array<{ index: number; direction: 'long' | 'short' }> = []
		let guard = 0
		while (controls.length < signals.length && guard < signals.length * 50) {
			guard++
			const idx = eligible[Math.floor(rng() * eligible.length)]!
			if (Number.isFinite(atr[idx]) && atr[idx]! > 0) controls.push({ index: idx, direction: rng() < 0.5 ? 'long' : 'short' })
		}
		const run = (sig: { index: number; direction: 'long' | 'short' }, p: string): TradeResult | null =>
			(E2_POLICY_NAMES as readonly string[]).includes(p)
				? simulateE2Trade(b.rows, atr, sig.index, sig.direction, p as E2PolicyName)
				: simulateTrade(b.rows, atr, sig.index, sig.direction, p as 'fixed_2to1' | 'partial_be')
		const entry: (typeof perDataset)[number] = { id: b.id, n: 0, policies: {} }
		for (const p of ALL) {
			const lt = signals.map((s) => run(s, p)).filter((t): t is TradeResult => t != null)
			const ct = controls.map((s) => run(s, p)).filter((t): t is TradeResult => t != null)
			entry.n = lt.length
			entry.policies[p] = { labels: summarizePolicy(lt), control: summarizePolicy(ct) }
			pooled[p]!.labels.push(...lt)
			pooled[p]!.control.push(...ct)
		}
		perDataset.push(entry)
		console.log(`[done] ${b.id}: signals=${signals.length}`)
	}

	const summary = Object.fromEntries(ALL.map((p) => [p, { labels: summarizePolicy(pooled[p]!.labels), control: summarizePolicy(pooled[p]!.control) }]))
	const expL = (p: string) => summary[p]!.labels.expectancy
	const expC = (p: string) => summary[p]!.control.expectancy
	const bestBand = expL('band_trail') >= expL('band_trail_be') ? 'band_trail' : 'band_trail_be'
	const success = expL(bestBand) >= 0.25 && expL(bestBand) - expC(bestBand) >= 0.15 && expL(bestBand) - expL('wide_hold') >= 0.1
	const bandsIrrelevant = expL(bestBand) - expL('wide_hold') < 0.1
	const verdict = success
		? `SUCCESS (${bestBand}: exp ${expL(bestBand).toFixed(3)}, beats control by ${(expL(bestBand) - expC(bestBand)).toFixed(3)}, beats wide_hold by ${(expL(bestBand) - expL('wide_hold')).toFixed(3)})`
		: bandsIrrelevant
			? `BANDS IRRELEVANT AS EXITS (${bestBand} exp ${expL(bestBand).toFixed(3)} vs wide_hold ${expL('wide_hold').toFixed(3)}; margin < 0.10 R) - band line CLOSED per pre-registration`
			: `NO VALUE (nothing separates from control by the frozen margins)`

	const pc = (x: number) => (x * 100).toFixed(1) + '%'
	const md: string[] = []
	md.push('# E2 band-trailed exits on HTF labels')
	md.push('')
	md.push(`Pre-registration: \`e2-band-trail-preregistration.md\`. HTF datasets: ${bundles.map((b) => b.id).join(', ')}. Conservative fills; seed 4242. Bands used as EXIT instrument (trail by prior-bar mean). Last band experiment.`)
	md.push('')
	md.push('## Pooled HTF')
	md.push('')
	md.push('| policy | cohort | n | WR vendor | WR strict | expectancy R | median R | stop rate | time/forced |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const p of ALL) {
		const s = summary[p]!
		md.push(`| ${p} | labels | ${s.labels.n} | ${pc(s.labels.winrateVendorStyle)} | ${pc(s.labels.winrateStrict)} | ${s.labels.expectancy.toFixed(3)} | ${s.labels.medianR.toFixed(2)} | ${pc(s.labels.stopRate)} | ${pc(s.labels.timeExitRate)} |`)
		md.push(`| ${p} | control | ${s.control.n} | ${pc(s.control.winrateVendorStyle)} | ${pc(s.control.winrateStrict)} | ${s.control.expectancy.toFixed(3)} | ${s.control.medianR.toFixed(2)} | ${pc(s.control.stopRate)} | ${pc(s.control.timeExitRate)} |`)
	}
	md.push('')
	md.push('## Per dataset (labels expectancy R)')
	md.push('')
	md.push('| dataset | n | ' + ALL.join(' | ') + ' |')
	md.push('|---|---|' + ALL.map(() => '---').join('|') + '|')
	for (const d of perDataset) {
		md.push(`| ${d.id} | ${d.n} | ` + ALL.map((p) => d.policies[p]!.labels.expectancy.toFixed(3)).join(' | ') + ' |')
	}
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	writeFileSync(resolve('ci-results/e2-band-trail.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e2-band-trail.json'), JSON.stringify({ config: { seed: SEED, maxHold: MAX_HOLD, minForward: MIN_FORWARD }, datasets: bundles.map((b) => b.id), pooled: summary, perDataset, verdict }, null, 2))
	for (const p of ALL) console.log(`${p}: labels exp=${expL(p).toFixed(3)} control exp=${expC(p).toFixed(3)}`)
	console.log(`\nVERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
