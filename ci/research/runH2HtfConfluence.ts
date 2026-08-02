/**
 * H2: HTF confluence filter for LTF labels. Spec frozen in
 * ci-results/h2-htf-confluence-preregistration.md (committed before this file).
 *
 * ALIGNED = HTF co-stretched with the (reversal) label direction: BUY aligned
 * iff htf_stretch <= -0.25; SELL aligned iff >= +0.25. Outcome = wide_hold R.
 * Strict no-lookahead HTF mapping (HTF bar close time <= LTF bar open time).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mulberry32 } from './auditFngCaseControl.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { parseBatch2Csv, type Batch2Row } from './runFngOosConfirmation.js'
import { ATR_LEN, computeAtr } from './runO1LabelOutcomes.js'
import { simulateE2Trade } from './runE2BandTrail.js'

export const SEED = 4242
export const N_PERMS = 2000
export const ALIGN_THRESHOLD = 0.25
export const RECENT_HTF_BARS = 12

const TF_MS: Record<string, number> = { '15m': 900_000, '1h': 3_600_000, '2h': 7_200_000 }

export interface HtfState {
	side: number
	stretch: number
	vp50: number
	recentSameDirLabel: (dir: 'long' | 'short') => boolean
}

/**
 * Build a lookup: for LTF bar open time t, return state of the last HTF bar
 * with closeTime <= t. Returns null when no HTF bar is closed yet or vp50 warm-up.
 */
export function buildHtfLookup(htfRows: Batch2Row[], htfTf: string, htfStartAt: number): (t: number) => HtfState | null {
	const dur = TF_MS[htfTf]
	if (!dur) throw new Error(`unknown timeframe ${htfTf}`)
	const closeTimes = htfRows.map((r) => r.timestamp + dur)
	// vp50 on HTF volumes
	const vp = new Array<number>(htfRows.length).fill(NaN)
	let s = 0
	for (let i = 0; i < htfRows.length; i++) {
		s += htfRows[i]!.volume
		if (i >= 50) s -= htfRows[i - 50]!.volume
		if (i >= 49) {
			const sma = s / 50
			vp[i] = sma > 0 ? htfRows[i]!.volume / sma : NaN
		}
	}
	return (t: number): HtfState | null => {
		// binary search: last index with closeTime <= t
		let lo = 0
		let hi = closeTimes.length - 1
		let idx = -1
		while (lo <= hi) {
			const mid = (lo + hi) >> 1
			if (closeTimes[mid]! <= t) {
				idx = mid
				lo = mid + 1
			} else hi = mid - 1
		}
		if (idx < htfStartAt || !Number.isFinite(vp[idx]!)) return null
		const bar = htfRows[idx]!
		const denom = bar.upperOuter - bar.mean
		if (!(denom > 0)) return null
		const stretch = (bar.close - bar.mean) / denom
		const from = Math.max(htfStartAt, idx - RECENT_HTF_BARS + 1)
		return {
			side: Math.sign(bar.close - bar.mean),
			stretch,
			vp50: vp[idx]!,
			recentSameDirLabel: (dir) => {
				for (let k = from; k <= idx; k++) {
					const r = htfRows[k]!
					if ((dir === 'long' && r.buy) || (dir === 'short' && r.sell)) return true
				}
				return false
			},
		}
	}
}

export function isAligned(direction: 'long' | 'short', stretch: number): boolean {
	return direction === 'long' ? stretch <= -ALIGN_THRESHOLD : stretch >= ALIGN_THRESHOLD
}

export function spearman(xs: number[], ys: number[]): number {
	const n = xs.length
	if (n < 3) return NaN
	const rank = (v: number[]): number[] => {
		const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!)
		const rk = new Array<number>(n).fill(0)
		let i = 0
		while (i < n) {
			let j = i
			while (j + 1 < n && v[order[j + 1]!]! === v[order[i]!]!) j++
			const avg = (i + j + 2) / 2
			for (let k = i; k <= j; k++) rk[order[k]!] = avg
			i = j + 1
		}
		return rk
	}
	const rx = rank(xs)
	const ry = rank(ys)
	const mx = rx.reduce((a, b) => a + b, 0) / n
	const my = ry.reduce((a, b) => a + b, 0) / n
	let num = 0
	let dx = 0
	let dy = 0
	for (let i = 0; i < n; i++) {
		num += (rx[i]! - mx) * (ry[i]! - my)
		dx += (rx[i]! - mx) ** 2
		dy += (ry[i]! - my) ** 2
	}
	return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN
}

interface LabelRecord {
	pair: string
	aligned: boolean
	realizedR: number
	stretch: number
	vp50: number
	recent: boolean
	direction: 'long' | 'short'
}

async function main() {
	const manifest = JSON.parse(readFileSync(resolve('data/vendor-exports/manifest-batch2.json'), 'utf8')) as {
		datasets: Array<{ id: string; file: string; symbol: string; timeframe: string; warmupRows: number }>
	}
	const byId = new Map(manifest.datasets.map((d) => [d.id, d]))
	const PAIRS: Array<[string, string]> = [
		['ondo-perp-15m-b2', 'ondo-perp-1h-b2'],
		['ondo-perp-15m-b2', 'ondo-perp-2h-b2'],
		['ondo-perp-1h-b2', 'ondo-perp-2h-b2'],
		['btc-perp-15m-b2', 'btc-perp-1h-b2'],
		['btc-perp-15m-b2', 'btc-perp-2h-b2'],
		['btc-perp-1h-b2', 'btc-perp-2h-b2'],
	]
	const cache = new Map<string, Batch2Row[]>()
	const load = (id: string): Batch2Row[] => {
		if (!cache.has(id)) cache.set(id, parseBatch2Csv(readFileSync(resolve('data/vendor-exports', byId.get(id)!.file), 'utf8')))
		return cache.get(id)!
	}

	const records: LabelRecord[] = []
	const perPair: Array<{ pair: string; nAligned: number; nNot: number; meanAligned: number; meanNot: number; diff: number }> = []
	for (const [ltfId, htfId] of PAIRS) {
		const ltfMeta = byId.get(ltfId)!
		const htfMeta = byId.get(htfId)!
		const ltf = load(ltfId)
		const htf = load(htfId)
		const lookup = buildHtfLookup(htf, htfMeta.timeframe, htfMeta.warmupRows)
		const atr = computeAtr(ltf)
		const pairName = `${ltfId} -> ${htfId}`
		const pairRecs: LabelRecord[] = []
		for (let i = ltfMeta.warmupRows; i < ltf.length; i++) {
			const row = ltf[i]!
			if (!row.buy && !row.sell) continue
			if (i < ATR_LEN) continue
			const direction: 'long' | 'short' = row.buy ? 'long' : 'short'
			const state = lookup(row.timestamp)
			if (!state) continue
			const trade = simulateE2Trade(ltf, atr, i, direction, 'wide_hold')
			if (!trade) continue
			pairRecs.push({
				pair: pairName,
				aligned: isAligned(direction, state.stretch),
				realizedR: trade.realizedR,
				stretch: state.stretch,
				vp50: state.vp50,
				recent: state.recentSameDirLabel(direction),
				direction,
			})
		}
		records.push(...pairRecs)
		const a = pairRecs.filter((r) => r.aligned)
		const n = pairRecs.filter((r) => !r.aligned)
		const mean = (xs: LabelRecord[]) => (xs.length ? xs.reduce((s2, x) => s2 + x.realizedR, 0) / xs.length : NaN)
		perPair.push({ pair: pairName, nAligned: a.length, nNot: n.length, meanAligned: mean(a), meanNot: mean(n), diff: mean(a) - mean(n) })
		console.log(`[done] ${pairName}: labels=${pairRecs.length} aligned=${a.length}`)
	}

	// pooled difference + within-pair permutation p
	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
	const pooledAligned = records.filter((r) => r.aligned).map((r) => r.realizedR)
	const pooledNot = records.filter((r) => !r.aligned).map((r) => r.realizedR)
	const observedDiff = mean(pooledAligned) - mean(pooledNot)
	const rng = mulberry32(SEED)
	const byPair = new Map<string, LabelRecord[]>()
	for (const r of records) {
		if (!byPair.has(r.pair)) byPair.set(r.pair, [])
		byPair.get(r.pair)!.push(r)
	}
	let ge = 0
	for (let p = 0; p < N_PERMS; p++) {
		const permA: number[] = []
		const permN: number[] = []
		for (const recs of byPair.values()) {
			const flags = recs.map((r) => r.aligned)
			for (let i = flags.length - 1; i > 0; i--) {
				const j = Math.floor(rng() * (i + 1))
				;[flags[i], flags[j]] = [flags[j]!, flags[i]!]
			}
			recs.forEach((r, i) => (flags[i] ? permA : permN).push(r.realizedR))
		}
		if (mean(permA) - mean(permN) >= observedDiff) ge++
	}
	const pValue = (1 + ge) / (1 + N_PERMS)
	const agreeing = perPair.filter((p) => Number.isFinite(p.diff) && Math.sign(p.diff) === Math.sign(observedDiff)).length
	const verdict =
		observedDiff >= 0.25 && pValue <= 0.05 && agreeing >= 4
			? 'CONFIRMED'
			: observedDiff < 0.1 || pValue > 0.2
				? 'REFUTED'
				: 'INCONCLUSIVE'

	const rs = records.map((r) => r.realizedR)
	const secondary = {
		spearman_stretchSigned: spearman(records.map((r) => (r.direction === 'long' ? -r.stretch : r.stretch)), rs),
		spearman_htfVp50: spearman(records.map((r) => r.vp50), rs),
		recentLabel: { withRate: mean(records.filter((r) => r.recent).map((r) => r.realizedR)), withoutRate: mean(records.filter((r) => !r.recent).map((r) => r.realizedR)), nWith: records.filter((r) => r.recent).length },
	}

	const md: string[] = []
	md.push('# H2 HTF confluence results')
	md.push('')
	md.push('Pre-registration: `h2-htf-confluence-preregistration.md`. ALIGNED = HTF co-stretched (|stretch| >= 0.25 on the label side); outcome = wide_hold realized R; strict no-lookahead HTF mapping; within-pair permutation (2000, seed 4242).')
	md.push('')
	md.push('| pair | n aligned | n not | mean R aligned | mean R not | diff |')
	md.push('|---|---|---|---|---|---|')
	for (const p of perPair) md.push(`| ${p.pair} | ${p.nAligned} | ${p.nNot} | ${p.meanAligned.toFixed(3)} | ${p.meanNot.toFixed(3)} | ${p.diff.toFixed(3)} |`)
	md.push('')
	md.push(`Pooled: aligned n=${pooledAligned.length} mean=${mean(pooledAligned).toFixed(3)} | not n=${pooledNot.length} mean=${mean(pooledNot).toFixed(3)} | **diff=${observedDiff.toFixed(3)} R**, permutation p=${pValue.toFixed(4)}, sign agreement ${agreeing}/6.`)
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	md.push('')
	md.push('## Secondary (exploratory, no confirmation weight)')
	md.push('')
	md.push(`Spearman(signed HTF stretch, R) = ${secondary.spearman_stretchSigned.toFixed(3)}; Spearman(HTF vp50, R) = ${secondary.spearman_htfVp50.toFixed(3)}; recent same-dir HTF label: mean R ${secondary.recentLabel.withRate.toFixed(3)} (n=${secondary.recentLabel.nWith}) vs ${secondary.recentLabel.withoutRate.toFixed(3)} without.`)
	writeFileSync(resolve('ci-results/h2-htf-confluence.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/h2-htf-confluence.json'), JSON.stringify({ config: { seed: SEED, nPerms: N_PERMS, alignThreshold: ALIGN_THRESHOLD }, perPair, pooled: { observedDiff, pValue, agreeing }, secondary, verdict }, null, 2))
	console.log(`\npooled diff=${observedDiff.toFixed(3)} p=${pValue.toFixed(4)} agree=${agreeing}/6\nVERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
