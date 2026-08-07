/**
 * IMP2 - SELECTION over management: extension signals x causal liquidity
 * context, per symbol x TF cells, REAL BingX VIP0 costs.
 *
 * Universe: every cached symbol with 60m (and 120m where present) + 240m.
 * Signal: own2Raw extension + per-mode trade-state gate (+3 bars), safe only.
 * Machinery: IMP1's only robust variant (STATIC2): entry next open,
 *   step = 5.5*ATR200(RMA), add at 1 step, stop mirror 2 steps,
 *   partial 25% at dynamic Mean w/ BE-after-partial, static TP at 2 steps.
 * Costs: 0.05% taker + 0.02% slippage per side (BingX VIP0, small size).
 * Context at signal time T (ZERO look-ahead, ZC5 engine on 4h prefix):
 *   ALL         - every gated signal (baseline)
 *   INPOOL      - same-side alive pool, entry in band +-50% width
 *   SELECTIVE   - ZC5 rule: rank < 2/3 AND inside raw band AND swept <= 24h
 *   RELAXED     - rank < 2/3 AND in band +-25% AND swept <= 48h
 * Protocol: per-symbol 60/40 time split (train/holdout). Success bar fixed
 * a priori: mean R > +0.05 NET on BOTH halves. Per-cell table (n >= 4)
 * only for filters that clear the bar in aggregate.
 * EXPLORATORY: filters fixed a priori (ZC5 lineage), no parameter sweeps.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { own2Raw } from './runOwn2ExtensionTrigger.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, type LiquidityPool } from './lib/liquidityHeatmapEngine.js'
import type { Candle } from './lib/candleType.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
const FEE = 0.0007 // 0.05% taker + 0.02% slippage, per side
const MIN_AGE_MS = 12 * 240 * 60_000
const load = (name: string): Kline[] | null => {
	const p = resolve('data/gate-cache', name)
	return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { rows: Kline[] }).rows : null
}

function atrRma200(rows: readonly ExactIndicatorRow[]): number[] {
	const out = new Array(rows.length).fill(NaN)
	let s = 0
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i]!, p = rows[i - 1]!
		const tr = Math.max(r.high - r.low, Math.abs(r.high - p.close), Math.abs(r.low - p.close))
		if (i <= 200) { s += tr; if (i === 200) out[i] = s / 200 }
		else out[i] = (out[i - 1]! * 199 + tr) / 200
	}
	return out
}

/** STATIC2 replay, net of fees; R basis: add-filled stop = -1R. */
function replayStatic2(rows: readonly ExactIndicatorRow[], atr: readonly number[], sigIdx: number, side: 1 | -1): { r: number; exitIdx: number; outcome: string } | null {
	const e = rows[sigIdx + 1]
	const a = atr[sigIdx]
	if (!e || !Number.isFinite(a)) return null
	const step = 5.5 * (a as number)
	const entry = e.open
	const add = side === 1 ? entry - step : entry + step
	const stop = side === 1 ? entry - 2 * step : entry + 2 * step
	const tp = side === 1 ? entry + 2 * step : entry - 2 * step
	const avgFull = (entry + add) / 2
	const oneR = Math.abs(avgFull - stop) * 2
	let addFilled = false, partialDone = false, realized = 0, weight = 1, avgEntry = entry, notional = entry
	for (let i = sigIdx + 1; i < rows.length; i++) {
		const r = rows[i]!
		if (!addFilled && (side === 1 ? r.low <= add : r.high >= add)) { addFilled = true; avgEntry = avgFull; weight = partialDone ? 1.75 : 2; notional += add }
		if (side === 1 ? r.low <= stop : r.high >= stop) {
			const pnl = (side === 1 ? stop - avgEntry : avgEntry - stop) * weight
			notional += Math.abs(stop) * weight
			return { r: (realized + pnl - notional * FEE) / oneR, exitIdx: i, outcome: partialDone ? 'pStop' : 'stop' }
		}
		const fix = r.mean
		if (!partialDone && Number.isFinite(fix) && (side === 1 ? r.high >= fix : r.low <= fix)) {
			realized += (side === 1 ? (fix as number) - avgEntry : avgEntry - (fix as number)) * weight * 0.25
			notional += Math.abs(fix as number) * weight * 0.25
			weight *= 0.75
			partialDone = true
		}
		if (partialDone && Number.isFinite(fix) && (side === 1 ? (fix as number) < avgEntry : (fix as number) > avgEntry)) {
			if (side === 1 ? r.high >= avgEntry : r.low <= avgEntry) {
				notional += Math.abs(avgEntry) * weight
				return { r: (realized - notional * FEE) / oneR, exitIdx: i, outcome: 'pBE' }
			}
		}
		if (side === 1 ? r.high >= tp : r.low <= tp) {
			const pnl = (side === 1 ? tp - avgEntry : avgEntry - tp) * weight
			notional += Math.abs(tp) * weight
			return { r: (realized + pnl - notional * FEE) / oneR, exitIdx: i, outcome: 'full' }
		}
	}
	return null
}

interface Trade { symbol: string; tf: number; timeMs: number; r: number; outcome: string; filters: Record<string, boolean>; isHold: boolean }

async function main() {
	const files = readdirSync(resolve('data/gate-cache')).filter((f) => /^[A-Z0-9]+USDT_(60|120)m\.json$/u.test(f))
	const cfg4h = heatmapConfigForTf(240 * 60_000)
	const trades: Trade[] = []
	for (const file of files) {
		const m = /^([A-Z0-9]+USDT)_(\d+)m\.json$/u.exec(file)!
		const symbol = m[1]!, tfMin = Number(m[2]!)
		const klines = load(file)
		const k4 = load(`${symbol}_240m.json`)
		if (!klines || !k4 || klines.length < 400 || k4.length < 400) continue
		const candles4: Candle[] = k4.map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
		const rows = buildRows(klines)
		const atr = atrRma200(rows)
		const raw = own2Raw(rows)
		const splitIdx = Math.floor(rows.length * 0.6)
		let blockedUntil = -1
		let pools: LiquidityPool[] = []
		let lastPrefixLen = -1
		for (const s of raw) {
			if (s.idx <= blockedUntil || s.idx <= 200 || s.idx + 1 >= rows.length) continue
			const res = replayStatic2(rows, atr, s.idx, s.side)
			if (!res) continue
			blockedUntil = res.exitIdx + 3
			const T = rows[s.idx]!.timestamp
			let prefixLen = 0
			while (prefixLen < candles4.length && candles4[prefixLen]!.timestamp + 240 * 60_000 <= T) prefixLen++
			let filters: Record<string, boolean> = { ALL: true, INPOOL: false, SELECTIVE: false, RELAXED: false }
			if (prefixLen >= 300) {
				if (prefixLen !== lastPrefixLen) { pools = detectLiquidityHeatmap(candles4.slice(0, prefixLen), cfg4h); lastPrefixLen = prefixLen }
				const entry = rows[s.idx + 1]!.open
				const want = s.side === 1 ? 'buy-side' : 'sell-side'
				const alive = pools.filter((pl) => pl.side === want && pl.startAt + MIN_AGE_MS <= T && (pl.sweptAt == null || T - pl.sweptAt <= 48 * 3_600_000))
				const inBand = (pl: LiquidityPool, tol: number) => {
					const bw = pl.bandHigh - pl.bandLow
					return entry >= pl.bandLow - tol * bw && entry <= pl.bandHigh + tol * bw
				}
				const hit = alive.find((pl) => inBand(pl, 0.5))
				if (hit) {
					filters.INPOOL = true
					let below = 0
					for (const p of alive) if (p !== hit && p.notional < hit.notional) below++
					const rank = alive.length <= 1 ? 0.5 : below / (alive.length - 1)
					const swept24 = hit.sweptAt != null && T - hit.sweptAt <= 24 * 3_600_000
					const swept48 = hit.sweptAt != null && T - hit.sweptAt <= 48 * 3_600_000
					if (rank < 2 / 3 && inBand(hit, 0) && swept24) filters.SELECTIVE = true
					if (rank < 2 / 3 && inBand(hit, 0.25) && swept48) filters.RELAXED = true
				}
			}
			trades.push({ symbol, tf: tfMin, timeMs: T, r: res.r, outcome: res.outcome, filters, isHold: s.idx >= splitIdx })
		}
		console.log(`[imp2] ${symbol} ${tfMin}m done (${trades.length} cum)`)
	}

	const filterNames = ['ALL', 'INPOOL', 'SELECTIVE', 'RELAXED']
	const md: string[] = ['# IMP2 - selection via causal liquidity context (net BingX VIP0 costs: 0.07%/side)', '', `Universe: ${new Set(trades.map((t) => t.symbol)).size} symbols, TFs 1h/2h; ${trades.length} gated extension trades.`, '', '| filter | train n | train meanR | hold n | hold meanR | PASS(+0.05 both) |', '|---|---|---|---|---|---|']
	const cellPass: string[] = []
	for (const f of filterNames) {
		const tr = trades.filter((t) => t.filters[f] && !t.isHold)
		const ho = trades.filter((t) => t.filters[f] && t.isHold)
		const mean = (a: Trade[]) => (a.length ? a.reduce((x, y) => x + y.r, 0) / a.length : NaN)
		const mt = mean(tr), mh = mean(ho)
		const pass = mt > 0.05 && mh > 0.05
		md.push(`| ${f} | ${tr.length} | ${Number.isFinite(mt) ? mt.toFixed(4) : '-'} | ${ho.length} | ${Number.isFinite(mh) ? mh.toFixed(4) : '-'} | ${pass ? 'YES' : 'no'} |`)
		if (f !== 'ALL') {
			// per-cell breakdown regardless, but marked
			const cells = new Map<string, Trade[]>()
			for (const t of trades.filter((t) => t.filters[f])) {
				const k = `${t.symbol} ${t.tf}m`
				;(cells.get(k) ?? cells.set(k, []).get(k)!).push(t)
			}
			const rowsOut = [...cells.entries()].filter(([, v]) => v.length >= 4).map(([k, v]) => ({ k, n: v.length, mean: v.reduce((a, b) => a + b.r, 0) / v.length, tot: v.reduce((a, b) => a + b.r, 0) })).sort((a, b) => b.mean - a.mean)
			if (rowsOut.length > 0) {
				cellPass.push('', `## Per-cell (${f}, n>=4, net meanR)`, '', '| cell | n | mean R | total R |', '|---|---|---|---|')
				for (const r of rowsOut) cellPass.push(`| ${r.k} | ${r.n} | ${r.mean.toFixed(3)} | ${r.tot.toFixed(1)} |`)
			}
		}
	}
	md.push(...cellPass)
	writeFileSync(resolve('ci-results/imp2-context-selection.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/imp2-context-selection.json'), JSON.stringify({ trades }, null, 0))
	console.log(md.slice(0, 12).join('\n'))
	console.log('cells sections:', cellPass.length)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
