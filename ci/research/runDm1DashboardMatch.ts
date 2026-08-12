/**
 * DM1: BTC.P 2h dashboard terminal-count match. Spec + predictions frozen in
 * ci-results/dm1-2h-dashboard-match-preregistration.md (committed first).
 * Ground truth: vendor dashboard screenshot supplied by Nikita (2026-08-05).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File } from './lib/exactIndicatorExport.js'
import {
	replayCorrectedGgiTrade, trueRangeSma,
	type CorrectedGgiBeBound, type CorrectedGgiOutcome, type CorrectedGgiSide,
} from './lib/ggiCorrectedReplay.js'

export const STOP_MULT = 12
export const WARMUP = 100
const BOUNDS: CorrectedGgiBeBound[] = ['optimistic-initial-stop', 'next-bar-blended-be', 'next-bar-entry-be']

export const DASHBOARD = {
	long: { trades: 50, partial: 16, stop: 7, full: 27 },
	short: { trades: 40, partial: 13, stop: 3, full: 24 },
} as const

export interface Cell { trades: number; partial: number; stop: number; full: number; end: number }

export function distance(model: { long: Cell; short: Cell }): number {
	let d = 0
	for (const side of ['long', 'short'] as const) {
		const m = model[side]
		const g = DASHBOARD[side]
		for (const k of ['partial', 'stop', 'full'] as const) d += (m[k] - g[k]) ** 2 / Math.max(g[k], 1)
	}
	return d
}

export function tally(outcomes: Array<{ side: CorrectedGgiSide; outcome: CorrectedGgiOutcome }>): { long: Cell; short: Cell } {
	const mk = (): Cell => ({ trades: 0, partial: 0, stop: 0, full: 0, end: 0 })
	const res = { long: mk(), short: mk() }
	for (const t of outcomes) {
		const c = t.side === 1 ? res.long : res.short
		if (t.outcome === 'End mark') { c.end++; continue } // open at data end: excluded from closed buckets
		c.trades++
		if (t.outcome === 'Stop') c.stop++
		else if (t.outcome === 'Partial') c.partial++
		else c.full++
	}
	return res
}

async function main() {
	const path = resolve(process.env.DM_DATA ?? 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h.csv')
	const rows = parseExactIndicatorCsv(readFileSync(path, 'utf8'), { allowInvalidBandOrder: true })
	const tr55 = trueRangeSma(rows, 55)
	const signals: Array<{ idx: number; side: CorrectedGgiSide }> = []
	for (let i = WARMUP; i < rows.length; i++) {
		const r = rows[i]!
		if (r.buy) signals.push({ idx: i, side: 1 })
		else if (r.sell) signals.push({ idx: i, side: -1 })
	}
	console.log(`signals: ${signals.length} (long ${signals.filter((s) => s.side === 1).length}, short ${signals.filter((s) => s.side === -1).length})`)

	const results: Record<string, { model: { long: Cell; short: Cell }; d: number; wr: number; meanR: number }> = {}
	for (const bound of BOUNDS) {
		const outs: Array<{ side: CorrectedGgiSide; outcome: CorrectedGgiOutcome }> = []
		const rs: number[] = []
		for (const s of signals) {
			const t = replayCorrectedGgiTrade(rows, tr55, s.idx, { stopMultiplier: STOP_MULT, beBound: bound })
			if (t) {
				outs.push({ side: s.side, outcome: t.outcome })
				if (t.outcome !== 'End mark') rs.push(t.grossR)
			}
		}
		const model = tally(outs)
		const closed = [...outs.filter((o) => o.outcome !== 'End mark')]
		const wins = closed.filter((o) => o.outcome !== 'Stop').length
		results[bound] = {
			model,
			d: distance(model),
			wr: closed.length ? wins / closed.length : NaN,
			meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN,
		}
	}

	const ranked = BOUNDS.slice().sort((a, b) => results[a]!.d - results[b]!.d)
	const best = ranked[0]!
	const second = ranked[1]!
	const bm = results[best]!.model
	const bucketOk = (['long', 'short'] as const).every((side) =>
		(['partial', 'stop', 'full'] as const).every((k) => Math.abs(bm[side][k] - DASHBOARD[side][k]) <= 6))
	const tradesOk = Math.abs(bm.long.trades - 50) <= 5 && Math.abs(bm.short.trades - 40) <= 4
	const dBest = results[best]!.d
	const verdict = dBest <= 6 && bucketOk && tradesOk && results[second]!.d >= 2 * dBest
		? `MATCHED: ${best} (D=${dBest.toFixed(2)} vs next ${results[second]!.d.toFixed(2)})`
		: dBest <= 12
			? `PARTIAL MATCH: best ${best} D=${dBest.toFixed(2)} (bucketOk=${bucketOk} tradesOk=${tradesOk} sep=${(results[second]!.d / Math.max(dBest, 1e-9)).toFixed(1)}x)`
			: `NO MATCH: best ${best} D=${dBest.toFixed(2)} > 12`

	const md: string[] = []
	md.push('# DM1 BTC.P 2h dashboard-count match')
	md.push('')
	md.push('Pre-registration: `dm1-2h-dashboard-match-preregistration.md`. Ground truth: vendor dashboard (LONG 50: 16/7/27, SHORT 40: 13/3/24, WR=non-stop share). Frozen v2 engine, 12xTR55, three BE semantics. End-mark trades excluded from closed buckets.')
	md.push('')
	md.push('| semantics | closed L | Partial L | Stop L | Full L | closed S | Partial S | Stop S | Full S | End | D | model WR | mean R |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	md.push(`| **dashboard** | 50 | 16 | 7 | 27 | 40 | 13 | 3 | 24 | - | 0 | 88.9% | - |`)
	for (const b of BOUNDS) {
		const r = results[b]!
		md.push(`| ${b} | ${r.model.long.trades} | ${r.model.long.partial} | ${r.model.long.stop} | ${r.model.long.full} | ${r.model.short.trades} | ${r.model.short.partial} | ${r.model.short.stop} | ${r.model.short.full} | ${r.model.long.end + r.model.short.end} | ${r.d.toFixed(2)} | ${(r.wr * 100).toFixed(1)}% | ${r.meanR.toFixed(4)} |`)
	}
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	const outBase = process.env.DM_OUT ?? 'dm1-2h-dashboard-match'
	writeFileSync(resolve(`ci-results/${outBase}.md`), md.join('\n'))
	writeFileSync(resolve(`ci-results/${outBase}.json`), JSON.stringify({ sha2h: sha256File(path), config: { stopMult: STOP_MULT, warmup: WARMUP }, signals: signals.length, results, verdict }, null, 2))
	for (const b of BOUNDS) console.log(`${b}: D=${results[b]!.d.toFixed(2)} WR=${(results[b]!.wr * 100).toFixed(1)}%`)
	console.log(`VERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
