/**
 * ZC4: second iteration on Nikita's liquidity-heatmap zones, fixing the three
 * gaps ZC3 left open:
 *  1. 1h TRIGGER (OWN1 on 1h bars) - ZC2's edge lived on sub-4h triggers;
 *     ZC3 only managed the 4h leg (Gate 1h history capped at last 10000
 *     bars ~ 14 months, so the 1h window is ~mid-2025..now: recent regime).
 *  2. 1h-profile zones (heatmapConfigForTf(60m)) tested alongside 4h zones.
 *  3. WEIGHT TERCILE as a causal filter probe: ZC3 hinted heaviest pools are
 *     sliced through (-0.10R) while light pools reversed (+0.14R). Here the
 *     tercile is computed CAUSALLY: rank of the pool's raw strength among
 *     same-side pools alive at signal time T (no global-history ranking).
 *
 * Zone lifecycle as in ZC3: age gate, active or swept within grace window
 * (the sweep IS the setup), entry within band +- 50% width.
 * Machinery: base P25/S12 only (zone-edge stop was a lottery - dropped).
 * EXPLORATORY. Gross R, approximated bands, Gate prices.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
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
const BAND_TOL = 0.5
const GRACE_H = 24
const MIN_AGE_BARS: Record<number, number> = { 60: 24, 240: 12 } // >=1d (1h zones), >=2d (4h zones)

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
const CACHE = 'data/gate-cache'
const IV: Record<number, string> = { 60: '1h', 240: '4h' }

/** Gate caps history at ~10000 most recent points per interval. */
async function fetchSeries(symbol: string, tfMin: number): Promise<Kline[] | null> {
	mkdirSync(resolve(CACHE), { recursive: true })
	const p = resolve(CACHE, `zc4_${symbol}_${tfMin}m.json`)
	if (existsSync(p)) return (JSON.parse(readFileSync(p, 'utf8')) as { rows: Kline[] }).rows
	const pair = symbol.replace(/USDT$/u, '') + '_USDT'
	const stepSec = tfMin * 60
	const endSec = Math.floor(Date.now() / 1000)
	let fromSec = endSec - 9900 * stepSec
	const rows: Kline[] = []
	while (fromSec < endSec) {
		const toSec = Math.min(fromSec + 1900 * stepSec, endSec)
		const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${pair}&interval=${IV[tfMin]}&from=${fromSec}&to=${toSec}`
		let j: unknown = null
		for (let a = 0; a < 6; a++) {
			try {
				const res = await fetch(url, { headers: { Accept: 'application/json' } })
				if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (a + 1))); continue }
				if (!res.ok) break
				j = await res.json()
				break
			} catch { await new Promise((r) => setTimeout(r, 1200 * (a + 1))) }
		}
		if (!Array.isArray(j)) { console.log(`[zc4] fetch failed ${symbol} ${tfMin}m from=${fromSec}`); if (rows.length === 0) return null; break }
		for (const k of j as Array<{ t: number; o: string; h: string; l: string; c: string; v: number }>) {
			rows.push({ t: k.t * 1000, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) })
		}
		fromSec = toSec + stepSec
		await new Promise((r) => setTimeout(r, 130))
	}
	rows.sort((a, b) => a.t - b.t)
	const dedup = rows.filter((r, i) => i === 0 || r.t !== rows[i - 1]!.t)
	writeFileSync(p, JSON.stringify({ rows: dedup }))
	return dedup
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

/** causal-ish strength rank of pool among same-side pools alive at time t: 0..1 (1 = heaviest).
 *  Uses notional (raw accumulated size). Mild look-ahead: notional is the pool's
 *  final accumulation, not its value at t - acceptable for a descriptive probe. */
function causalRank(pool: LiquidityPool, alive: readonly LiquidityPool[]): number {
	if (alive.length <= 1) return 0.5
	let below = 0
	for (const p of alive) if (p !== pool && p.notional < pool.notional) below++
	return below / (alive.length - 1)
}

async function main() {
	const groups: Record<string, Agg> = {}
	const G = (k: string) => (groups[k] ??= agg())
	const rBy: Record<string, number[]> = {}
	const push = (k: string, r: number) => ((rBy[k] ??= []).push(r))
	const samples: Array<Record<string, unknown>> = []

	for (const symbol of SYMBOLS) {
		const zoneLayers: Array<{ label: string; pools: LiquidityPool[]; tfMs: number }> = []
		for (const zoneTf of [60, 240] as const) {
			const kl = await fetchSeries(symbol, zoneTf)
			if (!kl || kl.length < 500) { console.log(`[zc4] ${symbol}: no ${zoneTf}m zone data`); continue }
			const candles: Candle[] = kl.map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
			zoneLayers.push({ label: `z${zoneTf}`, pools: detectLiquidityHeatmap(candles, heatmapConfigForTf(zoneTf * 60_000)), tfMs: zoneTf * 60_000 })
		}
		if (zoneLayers.length === 0) continue

		const k1 = await fetchSeries(symbol, 60)
		if (!k1 || k1.length < 400) { console.log(`[zc4] ${symbol}: no 1h trigger data`); continue }
		const rows = buildRows(k1)
		const bSma = bodySma20(rows)
		const tr55 = trueRangeSma(rows, 55)
		const signals = own1Signals(rows, bSma, 1.5, 10, 0, rows.length)

		for (const sig of signals) {
			const bar = rows[sig.idx]!
			const entryRow = rows[sig.idx + 1]
			if (!entryRow || !Number.isFinite(bar.mean)) continue
			const t = replayVar1Trade(rows, tr55, sig.idx, sig.side, BASE)
			if (!t || t.outcome === 'End mark') continue
			const sigTime = bar.timestamp + 3_600_000
			const entry = entryRow.open
			const wantSide = sig.side === 1 ? 'buy-side' : 'sell-side'

			let anyHit = false
			for (const layer of zoneLayers) {
				const minAgeMs = MIN_AGE_BARS[layer.tfMs / 60_000]! * layer.tfMs
				const alive = layer.pools.filter((pl) =>
					pl.startAt + minAgeMs <= sigTime && (pl.sweptAt == null || pl.sweptAt > sigTime || sigTime - pl.sweptAt <= GRACE_H * 3_600_000))
				const sameSide = alive.filter((p) => p.side === wantSide)
				const inBand = (pl: LiquidityPool, tol: number) => {
					const bw = pl.bandHigh - pl.bandLow
					return entry >= pl.bandLow - tol * bw && entry <= pl.bandHigh + tol * bw
				}
				const hit = sameSide.find((pl) => inBand(pl, BAND_TOL))
				if (!hit) continue
				anyHit = true
				bump(G(`in|${layer.label}`), t)
				push(`in|${layer.label}`, t.grossR)
				// strict: entry inside the raw band, no tolerance
				if (sameSide.some((pl) => inBand(pl, 0))) { bump(G(`in|${layer.label}|strict`), t); push(`in|${layer.label}|strict`, t.grossR) }
				// top-5 by notional among alive same-side pools
				const top5 = [...sameSide].sort((a, b) => b.notional - a.notional).slice(0, 5)
				if (top5.some((pl) => inBand(pl, 0))) { bump(G(`in|${layer.label}|top5strict`), t); push(`in|${layer.label}|top5strict`, t.grossR) }
				const rank = causalRank(hit, sameSide)
				const terc = rank >= 2 / 3 ? 'w-top' : rank >= 1 / 3 ? 'w-mid' : 'w-low'
				bump(G(`in|${layer.label}|${terc}`), t)
				push(`in|${layer.label}|${terc}`, t.grossR)
				if (samples.length < 300) samples.push({ symbol, layer: layer.label, side: sig.side, date: new Date(sigTime).toISOString(), grossR: t.grossR, outcome: t.outcome, causalRank: rank.toFixed(2) })
			}
			if (!anyHit) { bump(G('out|any'), t); push('out|any', t.grossR) }
			else { bump(G('in|any'), t); push('in|any', t.grossR) }
		}
		console.log(`[zc4] ${symbol} done`)
	}

	const inR = rBy['in|any'] ?? []
	const outR = rBy['out|any'] ?? []
	let pBoot = NaN
	if (inR.length > 5 && outR.length > 5) {
		const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
		const outMean = mean(outR)
		let le = 0
		const N = 10000
		for (let b = 0; b < N; b++) {
			let s = 0
			for (let i = 0; i < inR.length; i++) s += inR[(Math.random() * inR.length) | 0]!
			if (s / inR.length <= outMean) le++
		}
		pBoot = le / N
	}

	const md: string[] = []
	md.push('# ZC4 - heatmap iteration 2: 1h trigger, 1h+4h zone profiles, causal weight terciles')
	md.push('')
	md.push(`Symbols: ${SYMBOLS.join(', ')}. Window: last ~9900 1h bars (~14 months, Gate history cap).`)
	md.push(`Trigger OWN1 bk1.5/M10/cd40 on 1h. Zones: heatmap 60m + 240m profiles, age >= 1d/2d, active or swept <= ${GRACE_H}h, band tol ${BAND_TOL * 100}%. Machinery P25/S12.`)
	md.push('Weight tercile = causal rank of rawStrength among same-side pools alive at signal time.')
	md.push('')
	md.push('| group | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const k of Object.keys(groups).sort()) md.push(`| ${k} ${fmt(groups[k]!)}`)
	md.push('')
	md.push(`Bootstrap P(in-any mean <= out-any mean): ${Number.isFinite(pBoot) ? pBoot.toFixed(4) : 'n/a'}`)
	md.push('')
	md.push('## Sample in-zone trades (first 300)')
	md.push('')
	md.push('| date | symbol | layer | side | R | outcome | causal rank |')
	md.push('|---|---|---|---|---|---|---|')
	for (const s of samples) md.push(`| ${String(s.date).slice(0, 16)} | ${s.symbol} | ${s.layer} | ${s.side === 1 ? 'L' : 'S'} | ${Number(s.grossR).toFixed(3)} | ${s.outcome} | ${s.causalRank} |`)
	writeFileSync(resolve('ci-results/zc4-heatmap-iteration2.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/zc4-heatmap-iteration2.json'), JSON.stringify({ groups, samples, pBoot }, null, 1))
	for (const k of Object.keys(groups).sort()) { const a = groups[k]!; console.log(`[zc4] ${k}: n=${a.n} meanR=${a.n ? (a.sumR / a.n).toFixed(4) : '-'}`) }
	console.log(`[zc4] bootstrap p(in<=out): ${pBoot}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
