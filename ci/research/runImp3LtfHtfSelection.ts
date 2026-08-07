/**
 * IMP3 - LTF/HTF extension of IMP2: signal TFs 15m / 30m / 4h.
 * Context zones: 4h pools for 15m+30m signals (same zones a trader
 * watches), 1d pools for 4h signals. Everything else IDENTICAL to
 * IMP2 (pre-registered): own2Raw + gate(+3), STATIC2 machinery,
 * step=5.5*ATR200, BingX VIP0 costs 0.07%/side, RELAXED filter
 * (rank<2/3, band +-25%, swept<=48h), per-cell 60/40 time split,
 * success bar mean R > +0.05 NET on both halves.
 * EXPLORATORY: no sweeps; single pre-registered config per TF.
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
const FEE = 0.0007
const CACHE = resolve('data/gate-cache')

async function fetchGate(contract: string, gInt: string, bars: number): Promise<Kline[]> {
	const out: Kline[] = []
	let to = Math.floor(Date.now() / 1000)
	while (out.length < bars) {
		const lim = Math.min(1999, bars - out.length + 10)
		const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=${gInt}&to=${to}&limit=${lim}`
		const res = await fetch(url)
		if (!res.ok) { await new Promise((r) => setTimeout(r, 1500)); const retry = await fetch(url); if (!retry.ok) throw new Error(`${contract} ${gInt} ${retry.status}`); const arr2 = (await retry.json()) as Array<{ t: number; o: string; h: string; l: string; c: string; v: number }>; if (arr2.length === 0) break; const mapped2 = arr2.map((r) => ({ t: r.t * 1000, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: r.v })); const known2 = new Set(out.map((x) => x.t)); out.unshift(...mapped2.filter((m) => !known2.has(m.t))); to = Math.floor(mapped2[0]!.t / 1000) - 1; continue }
		const arr = (await res.json()) as Array<{ t: number; o: string; h: string; l: string; c: string; v: number }>
		if (arr.length === 0) break
		const mapped = arr.map((r) => ({ t: r.t * 1000, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: r.v }))
		const known = new Set(out.map((x) => x.t))
		out.unshift(...mapped.filter((m) => !known.has(m.t)))
		to = Math.floor(mapped[0]!.t / 1000) - 1
		if (arr.length < 5) break
		await new Promise((r) => setTimeout(r, 120))
	}
	return out.sort((a, b) => a.t - b.t)
}

async function loadOrFetch(symbol: string, tfMin: number, bars: number): Promise<Kline[] | null> {
	const p = resolve(CACHE, `${symbol}_${tfMin}m.json`)
	if (existsSync(p)) {
		const rows = (JSON.parse(readFileSync(p, 'utf8')) as { rows: Kline[] }).rows
		if (rows.length >= Math.min(bars * 0.8, 400)) return rows
	}
	const gInt = tfMin >= 1440 ? '1d' : tfMin >= 60 ? `${tfMin / 60}h` : `${tfMin}m`
	try {
		const rows = await fetchGate(symbol.replace(/USDT$/u, "_USDT"), gInt, bars)
		if (rows.length < 400) return null
		writeFileSync(p, JSON.stringify({ rows }))
		return rows
	} catch (err) { console.error(`FETCH FAIL ${symbol} ${tfMin}m: ${(err as Error).message}`); return null }
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

interface Trade { symbol: string; tf: number; timeMs: number; r: number; outcome: string; relaxed: boolean; isHold: boolean }

async function main() {
	const symbols = readdirSync(CACHE).filter((f) => /^[A-Z0-9]+USDT_240m\.json$/u.test(f)).map((f) => f.replace('_240m.json', ''))
	console.log(`universe: ${symbols.length} symbols`)
	const plans = [
		{ tfMin: 15, bars: 9000, ctxTf: 240 },
		{ tfMin: 30, bars: 5000, ctxTf: 240 },
		{ tfMin: 240, bars: 4000, ctxTf: 1440 },
	]
	const trades: Trade[] = []
	for (const symbol of symbols) {
		for (const plan of plans) {
			const klines = plan.tfMin === 240 ? (JSON.parse(readFileSync(resolve(CACHE, `${symbol}_240m.json`), 'utf8')) as { rows: Kline[] }).rows : await loadOrFetch(symbol, plan.tfMin, plan.bars)
			if (!klines || klines.length < 500) continue
			const ctx = await loadOrFetch(symbol, plan.ctxTf, plan.ctxTf === 1440 ? 900 : 3000)
			if (!ctx || ctx.length < 350) continue
			const ctxMs = plan.ctxTf * 60_000
			const candles: Candle[] = ctx.map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
			const cfg = heatmapConfigForTf(ctxMs)
			const minAge = 12 * ctxMs
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
				while (prefixLen < candles.length && candles[prefixLen]!.timestamp + ctxMs <= T) prefixLen++
				let relaxed = false
				if (prefixLen >= 300) {
					if (prefixLen !== lastPrefixLen) { pools = detectLiquidityHeatmap(candles.slice(0, prefixLen), cfg); lastPrefixLen = prefixLen }
					const entry = rows[s.idx + 1]!.open
					const want = s.side === 1 ? 'buy-side' : 'sell-side'
					const alive = pools.filter((pl) => pl.side === want && pl.startAt + minAge <= T && (pl.sweptAt == null || T - pl.sweptAt <= 48 * 3_600_000))
					const hit = alive.find((pl) => {
						const bw = pl.bandHigh - pl.bandLow
						return entry >= pl.bandLow - 0.25 * bw && entry <= pl.bandHigh + 0.25 * bw
					})
					if (hit && hit.sweptAt != null && T - hit.sweptAt <= 48 * 3_600_000) {
						let below = 0
						for (const p of alive) if (p !== hit && p.notional < hit.notional) below++
						const rank = alive.length <= 1 ? 0.5 : below / (alive.length - 1)
						relaxed = rank < 2 / 3
					}
				}
				trades.push({ symbol, tf: plan.tfMin, timeMs: T, r: res.r, outcome: res.outcome, relaxed, isHold: s.idx >= splitIdx })
			}
		}
		process.stdout.write('.')
	}
	console.log('')
	const md: string[] = ['# IMP3 - LTF/HTF signal TFs (15m/30m/4h), RELAXED pre-registered filter', '', `Universe: ${symbols.length} symbols. Costs 0.07%/side. Bar: mean R > +0.05 NET both halves.`, '']
	const seg = (list: Trade[]) => {
		const tr = list.filter((t) => !t.isHold), ho = list.filter((t) => t.isHold)
		const mean = (a: Trade[]) => (a.length ? a.reduce((s, t) => s + t.r, 0) / a.length : NaN)
		return { nT: tr.length, mT: mean(tr), nH: ho.length, mH: mean(ho) }
	}
	for (const tf of [15, 30, 240]) {
		const all = trades.filter((t) => t.tf === tf)
		const rel = all.filter((t) => t.relaxed)
		const a = seg(all), r = seg(rel)
		md.push(`## TF ${tf}m`, '', `- ALL: train n=${a.nT} meanR=${a.mT.toFixed(4)} | hold n=${a.nH} meanR=${a.mH.toFixed(4)}`, `- RELAXED: train n=${r.nT} meanR=${r.mT.toFixed(4)} | hold n=${r.nH} meanR=${r.mH.toFixed(4)} ${r.mT > 0.05 && r.mH > 0.05 ? '**PASS**' : ''}`, '')
		const bySym = new Map<string, Trade[]>()
		for (const t of rel) { const arr = bySym.get(t.symbol) ?? []; arr.push(t); bySym.set(t.symbol, arr) }
		const cells = [...bySym.entries()].filter(([, v]) => v.length >= 3).map(([k, v]) => `${k} n=${v.length} meanR=${(v.reduce((s, t) => s + t.r, 0) / v.length).toFixed(3)}`)
		if (cells.length) md.push(`RELAXED cells (n>=3): ${cells.join(' | ')}`, '')
	}
	writeFileSync(resolve('ci-results/imp3-ltf-htf-selection.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/imp3-ltf-htf-selection.json'), JSON.stringify({ trades }, null, 0))
	console.log(md.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
