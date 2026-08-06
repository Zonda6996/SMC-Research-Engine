/**
 * ZC5: CAUSAL pool state - the clean test of the ZC3/ZC4 weight-inversion lead.
 *
 * Method: at every OWN1 1h signal time T we re-run detectLiquidityHeatmap on
 * the PREFIX of 4h candles closed strictly before T. Everything the pool knows
 * (notional, status, sweep) is therefore knowledge-at-T - zero look-ahead.
 * This is brute-force but reuses the exact main-branch engine logic unchanged.
 *
 * Selection layers (fixed a priori):
 *  - baseline "in-any": same-side pool, age >= 2d, active or swept <= 24h,
 *    entry within band +- 50% width (ZC4 baseline, for continuity);
 *  - CAUSAL terciles by notional rank among same-side alive pools at T;
 *  - SELECTIVE rule (the candidate filter): light+mid rank (< 2/3) AND
 *    entry strictly inside the raw band AND pool swept within last 24h
 *    (sweep-reversal setup). Goal: <= ~10% of signals pass.
 * Machinery: base P25/S12. Gross R. 12 symbols, ~14 months (Gate cap).
 * EXPLORATORY - one configuration, no sweeps.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma } from './lib/ggiCorrectedReplay.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import { replayVar1Trade, type Var1Config } from './runVar1ExitSweep.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, type LiquidityPool } from './lib/liquidityHeatmapEngine.js'
import type { Candle } from './lib/candleType.js'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'DOTUSDT', 'ATOMUSDT']
const BASE: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }
const MIN_AGE_MS = 12 * 240 * 60_000
const GRACE_MS = 24 * 3_600_000

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
const load = (sym: string, tf: number): Kline[] | null => {
	try { return (JSON.parse(readFileSync(resolve('data/gate-cache', `zc4_${sym}_${tf}m.json`), 'utf8')) as { rows: Kline[] }).rows } catch { return null }
}

interface Agg { n: number; sumR: number; p: number; s: number; f: number }
const agg = (): Agg => ({ n: 0, sumR: 0, p: 0, s: 0, f: 0 })
const bump = (a: Agg, r: { outcome: string; grossR: number }) => {
	a.n++; a.sumR += r.grossR
	if (r.outcome === 'Partial') a.p++
	else if (r.outcome === 'Stop') a.s++
	else a.f++
}
const fmt = (a: Agg) => a.n === 0 ? `| 0 | - | - | - |` : `| ${a.n} | ${(a.sumR / a.n).toFixed(4)} | ${(((a.p + a.f) / a.n) * 100).toFixed(1)}% | ${a.p}/${a.s}/${a.f} |`

async function main() {
	const cfg4h = heatmapConfigForTf(240 * 60_000)
	const groups: Record<string, Agg> = {}
	const G = (k: string) => (groups[k] ??= agg())
	const rBy: Record<string, number[]> = {}
	const push = (k: string, r: number) => ((rBy[k] ??= []).push(r))
	const selective: Array<Record<string, unknown>> = []
	let totalSignals = 0

	for (const symbol of SYMBOLS) {
		const k4 = load(symbol, 240)
		const k1 = load(symbol, 60)
		if (!k4 || !k1 || k4.length < 500 || k1.length < 400) { console.log(`[zc5] ${symbol}: missing data`); continue }
		const candles4: Candle[] = k4.map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
		const rows = buildRows(k1)
		const tr55 = trueRangeSma(rows, 55)
		const signals = own1Signals(rows, bodySma20(rows), 1.5, 10, 0, rows.length)

		// prefix cache: recompute pools only when the 4h prefix length changes
		let lastPrefixLen = -1
		let pools: LiquidityPool[] = []

		for (const sig of signals) {
			const bar = rows[sig.idx]!
			const entryRow = rows[sig.idx + 1]
			if (!entryRow || !Number.isFinite(bar.mean)) continue
			const t = replayVar1Trade(rows, tr55, sig.idx, sig.side, BASE)
			if (!t || t.outcome === 'End mark') continue
			totalSignals++
			const T = bar.timestamp + 3_600_000
			// prefix = 4h candles fully closed before T
			let prefixLen = 0
			while (prefixLen < candles4.length && candles4[prefixLen]!.timestamp + 240 * 60_000 <= T) prefixLen++
			if (prefixLen < 300) { bump(G('out|any'), t); push('out|any', t.grossR); continue }
			if (prefixLen !== lastPrefixLen) {
				pools = detectLiquidityHeatmap(candles4.slice(0, prefixLen), cfg4h)
				lastPrefixLen = prefixLen
			}
			const entry = entryRow.open
			const want = sig.side === 1 ? 'buy-side' : 'sell-side'
			const alive = pools.filter((pl) => pl.side === want && pl.startAt + MIN_AGE_MS <= T && (pl.sweptAt == null || T - pl.sweptAt <= GRACE_MS))
			const inBand = (pl: LiquidityPool, tol: number) => {
				const bw = pl.bandHigh - pl.bandLow
				return entry >= pl.bandLow - tol * bw && entry <= pl.bandHigh + tol * bw
			}
			const hit = alive.find((pl) => inBand(pl, 0.5))
			if (!hit) { bump(G('out|any'), t); push('out|any', t.grossR); continue }
			bump(G('in|any'), t)
			push('in|any', t.grossR)
			// causal rank by notional among alive same-side pools
			let below = 0
			for (const p of alive) if (p !== hit && p.notional < hit.notional) below++
			const rank = alive.length <= 1 ? 0.5 : below / (alive.length - 1)
			const terc = rank >= 2 / 3 ? 'w-top' : rank >= 1 / 3 ? 'w-mid' : 'w-low'
			bump(G(`in|${terc}`), t)
			push(`in|${terc}`, t.grossR)
			// selective rule
			const sweptRecently = hit.sweptAt != null && T - hit.sweptAt <= GRACE_MS
			if (rank < 2 / 3 && inBand(hit, 0) && sweptRecently) {
				bump(G('in|SELECTIVE'), t)
				push('in|SELECTIVE', t.grossR)
				selective.push({ symbol, side: sig.side, date: new Date(T).toISOString(), grossR: t.grossR, outcome: t.outcome, rank: rank.toFixed(2), alive: alive.length })
			}
		}
		console.log(`[zc5] ${symbol} done`)
	}

	// bootstrap for the key slices vs out-zone
	const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
	const outMean = mean(rBy['out|any'] ?? [])
	const boot = (key: string) => {
		const a = rBy[key] ?? []
		if (a.length < 5 || !Number.isFinite(outMean)) return NaN
		let le = 0
		const N = 10000
		for (let b = 0; b < N; b++) {
			let s = 0
			for (let i = 0; i < a.length; i++) s += a[(Math.random() * a.length) | 0]!
			if (s / a.length <= outMean) le++
		}
		return le / N
	}

	const md: string[] = []
	md.push('# ZC5 - causal pool state (prefix re-detection at every signal)')
	md.push('')
	md.push(`Symbols: ${SYMBOLS.join(', ')}. 1h OWN1 trigger, 4h zones, machinery P25/S12. Total evaluated signals: ${totalSignals}.`)
	md.push('Pools recomputed on the 4h prefix closed before each signal - notional/status/rank are knowledge-at-T, no look-ahead.')
	md.push('SELECTIVE = rank < 2/3 (not heaviest) AND entry strictly in band AND pool swept within 24h.')
	md.push('')
	md.push('| group | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const k of Object.keys(groups).sort()) md.push(`| ${k} ${fmt(groups[k]!)}`)
	md.push('')
	md.push(`out-zone mean: ${Number.isFinite(outMean) ? outMean.toFixed(4) : 'n/a'}`)
	md.push(`bootstrap P(slice <= out): in|any=${boot('in|any').toFixed(3)}, in|w-low=${boot('in|w-low').toFixed(3)}, in|w-mid=${boot('in|w-mid').toFixed(3)}, in|SELECTIVE=${boot('in|SELECTIVE').toFixed(3)}`)
	md.push('')
	md.push('## SELECTIVE trades (all)')
	md.push('')
	md.push('| date | symbol | side | R | outcome | rank | alive pools |')
	md.push('|---|---|---|---|---|---|---|')
	for (const s of selective) md.push(`| ${String(s.date).slice(0, 16)} | ${s.symbol} | ${s.side === 1 ? 'L' : 'S'} | ${Number(s.grossR).toFixed(3)} | ${s.outcome} | ${s.rank} | ${s.alive} |`)
	writeFileSync(resolve('ci-results/zc5-causal-pool-state.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/zc5-causal-pool-state.json'), JSON.stringify({ groups, selective, outMean }, null, 1))
	for (const k of Object.keys(groups).sort()) { const a = groups[k]!; console.log(`[zc5] ${k}: n=${a.n} meanR=${a.n ? (a.sumR / a.n).toFixed(4) : '-'}`) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
