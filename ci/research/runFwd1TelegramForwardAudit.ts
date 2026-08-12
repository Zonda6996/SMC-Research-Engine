/**
 * FWD1: forward audit of GGI signals from the vendor's own Telegram bot dumps.
 * These signals were broadcast in real time and CANNOT have been repainted -
 * first genuinely forward test of the arrows in this whole research line.
 *
 * Pipeline: parse dumps -> fetch Bybit klines (public API, cached) ->
 * reconstruct bands via the recovered approximation
 *   mean = ALMA(hlc3, 200, 0.85, 6)
 *   s    = ALMA(TR/close, 122, 0.625, 3.5)
 *   inner = mean*exp(+-5.6*s), outer = mean*exp(+-9.6*s)
 * -> replay through DM3-V2 base (P25/S12) and VAR1 winner (P25/S10+ADD).
 *
 * DESCRIPTIVE audit. Band approximation error (~2-4% width) makes individual
 * TP levels fuzzy; aggregates are meaningful, single trades are not.
 * SP500/NAS100 are excluded (not on Bybit).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import { replayVar1Trade, type Var1Config } from './runVar1ExitSweep.js'

interface TgMsg { id: number; date: string; text: string }
interface Signal { symbol: string; tfMin: number; side: CorrectedGgiSide; timeMs: number; channel: string }

const SIG_RE = /Сигнал в (ЛОНГ|ШОРТ)\s+([A-Z0-9]+?)(\.P)?\s+(\d+)\s*$/u
const EXCLUDED = new Set(['SP500', 'NAS100', 'US30', 'DXY', 'GOLD', 'XAUUSD'])

export function parseSignals(path: string, channel: string): Signal[] {
	const msgs = JSON.parse(readFileSync(path, 'utf8')) as TgMsg[]
	const out: Signal[] = []
	for (const m of msgs) {
		const g = SIG_RE.exec(m.text?.trim() ?? '')
		if (!g) continue
		const symbol = g[2]!
		if (EXCLUDED.has(symbol)) continue
		out.push({
			symbol,
			tfMin: Number(g[4]!),
			side: g[1] === 'ЛОНГ' ? 1 : -1,
			timeMs: Date.parse(m.date),
			channel,
		})
	}
	return out.sort((a, b) => a.timeMs - b.timeMs)
}

/** Arnaud Legoux MA over a fixed window; null until warm. */
export function alma(values: readonly (number | null)[], window: number, offset: number, sigma: number): (number | null)[] {
	const m = offset * (window - 1)
	const s = window / sigma
	const w: number[] = []
	let wSum = 0
	for (let i = 0; i < window; i++) {
		const wi = Math.exp(-((i - m) * (i - m)) / (2 * s * s))
		w.push(wi)
		wSum += wi
	}
	const out: (number | null)[] = new Array(values.length).fill(null)
	outer: for (let i = window - 1; i < values.length; i++) {
		let acc = 0
		for (let j = 0; j < window; j++) {
			const v = values[i - window + 1 + j]
			if (v == null) continue outer
			acc += v * w[j]!
		}
		out[i] = acc / wSum
	}
	return out
}

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

const CACHE_DIR = 'data/gate-cache'
const GATE_INTERVALS: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h' }

/** Bybit is geo-blocked in this sandbox; Gate.io mirrors the same perp universe.
 *  3m is aggregated from 1m (Gate has no native 3m). Prices differ from Bybit
 *  by well under the band-approximation error, so aggregates stay meaningful. */
async function gateFetch(url: string): Promise<unknown | null> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(url, { headers: { Accept: 'application/json' } })
			if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue }
			if (!res.ok) return null
			return await res.json()
		} catch { await new Promise((r) => setTimeout(r, 800)) }
	}
	return null
}

async function fetchGateSeries(symbol: string, tfMin: number, startMs: number, endMs: number): Promise<{ rows: Kline[]; category: string } | null> {
	const pair = symbol.replace(/USDT$/u, '') + '_USDT'
	const interval = GATE_INTERVALS[tfMin]
	if (!interval) return null
	const stepSec = tfMin * 60
	for (const category of ['futures', 'spot']) {
		const rows: Kline[] = []
		const maxPts = category === 'futures' ? 1900 : 950
		let fromSec = Math.floor(startMs / 1000)
		const endSec = Math.floor(endMs / 1000)
		let failed = false
		while (fromSec < endSec) {
			const toSec = Math.min(fromSec + maxPts * stepSec, endSec)
			const url = category === 'futures'
				? `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${pair}&interval=${interval}&from=${fromSec}&to=${toSec}`
				: `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${fromSec}&to=${toSec}`
			const j = await gateFetch(url)
			if (j == null || !Array.isArray(j)) { failed = rows.length === 0; break }
			if (category === 'futures') {
				for (const k of j as Array<{ t: number; o: string; h: string; l: string; c: string; v: number }>) {
					rows.push({ t: k.t * 1000, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) })
				}
			} else {
				for (const k of j as string[][]) {
					rows.push({ t: Number(k[0]) * 1000, o: Number(k[5]), h: Number(k[3]), l: Number(k[4]), c: Number(k[2]), v: Number(k[6]) })
				}
			}
			fromSec = toSec + stepSec
			await new Promise((r) => setTimeout(r, 150))
		}
		if (!failed && rows.length > 0) {
			rows.sort((a, b) => a.t - b.t)
			const dedup = rows.filter((r, i) => i === 0 || r.t !== rows[i - 1]!.t)
			return { rows: dedup, category: `gate-${category}` }
		}
	}
	return null
}

function aggregate(rows: readonly Kline[], groupMin: number, baseMin: number): Kline[] {
	const groupMs = groupMin * 60_000
	const out: Kline[] = []
	let cur: Kline | null = null
	for (const r of rows) {
		const bucket = Math.floor(r.t / groupMs) * groupMs
		if (!cur || cur.t !== bucket) {
			if (cur) out.push(cur)
			cur = { t: bucket, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }
		} else {
			cur.h = Math.max(cur.h, r.h)
			cur.l = Math.min(cur.l, r.l)
			cur.c = r.c
			cur.v += r.v
		}
	}
	if (cur) out.push(cur)
	return out
}

async function fetchKlines(symbol: string, tfMin: number, startMs: number, endMs: number): Promise<{ rows: Kline[]; category: string } | null> {
	mkdirSync(resolve(CACHE_DIR), { recursive: true })
	const cachePath = resolve(CACHE_DIR, `${symbol}_${tfMin}m.json`)
	if (existsSync(cachePath)) {
		const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
		if (cached.startMs <= startMs && cached.endMs >= endMs - tfMin * 60_000 * 2) return { rows: cached.rows, category: cached.category }
	}
	let result: { rows: Kline[]; category: string } | null = null
	if (GATE_INTERVALS[tfMin]) {
		result = await fetchGateSeries(symbol, tfMin, startMs, endMs)
	} else if (tfMin === 3) {
		const base = await fetchGateSeries(symbol, 1, startMs, endMs)
		if (base) result = { rows: aggregate(base.rows, 3, 1), category: `${base.category}-agg1m` }
	}
	if (result) writeFileSync(cachePath, JSON.stringify({ startMs, endMs, category: result.category, rows: result.rows }))
	return result
}

export function buildRows(klines: readonly Kline[]): ExactIndicatorRow[] {
	const hlc3 = klines.map((k) => (k.h + k.l + k.c) / 3)
	const trRel: (number | null)[] = klines.map((k, i) => {
		if (i === 0) return null
		const prev = klines[i - 1]!
		const tr = Math.max(k.h - k.l, Math.abs(k.h - prev.c), Math.abs(k.l - prev.c))
		return tr / k.c
	})
	const mean = alma(hlc3, 200, 0.85, 6)
	const s = alma(trRel, 122, 0.625, 3.5)
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < klines.length; i++) {
		const k = klines[i]!
		const m = mean[i]
		const sv = s[i]
		if (m == null || sv == null) {
			rows.push({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, mean: NaN, upperInner: NaN, lowerInner: NaN, upperOuter: NaN, lowerOuter: NaN, buy: false, sell: false })
			continue
		}
		rows.push({
			timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v,
			mean: m,
			upperInner: m * Math.exp(5.6 * sv), lowerInner: m * Math.exp(-5.6 * sv),
			upperOuter: m * Math.exp(9.6 * sv), lowerOuter: m * Math.exp(-9.6 * sv),
			buy: false, sell: false,
		})
	}
	return rows
}

const BASE: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }
const WINNER: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 10, addOn: true }

interface Agg { n: number; sumR: number; p: number; s: number; f: number; end: number; skipped: number }
const newAgg = (): Agg => ({ n: 0, sumR: 0, p: 0, s: 0, f: 0, end: 0, skipped: 0 })

async function main() {
	const signals = [
		...parseSignals(resolve('data/vendor-exports/tg_topic_2348_hourly.json'), 'hourly'),
		...parseSignals(resolve('data/vendor-exports/tg_topic_16293_scalp.json'), 'scalp'),
	]
	console.log(`[fwd1] parsed ${signals.length} tradable signals`)

	const pairs = new Map<string, { symbol: string; tfMin: number; first: number }>()
	for (const sig of signals) {
		const key = `${sig.symbol}_${sig.tfMin}`
		const cur = pairs.get(key)
		if (!cur || sig.timeMs < cur.first) pairs.set(key, { symbol: sig.symbol, tfMin: sig.tfMin, first: sig.timeMs })
	}
	console.log(`[fwd1] ${pairs.size} symbol/tf pairs`)

	const marketData = new Map<string, ExactIndicatorRow[]>()
	const failed: string[] = []
	for (const [key, p] of pairs) {
		const warmupMs = 320 * p.tfMin * 60_000
		const res = await fetchKlines(p.symbol, p.tfMin, p.first - warmupMs, Date.now())
		if (!res || res.rows.length < 250) { failed.push(key); continue }
		marketData.set(key, buildRows(res.rows))
		console.log(`[fwd1] ${key}: ${res.rows.length} bars (${res.category})`)
	}
	if (failed.length) console.log(`[fwd1] no data for: ${failed.join(', ')}`)

	const results: Array<Record<string, unknown>> = []
	const aggBy = new Map<string, Agg>()
	const bump = (k: string, r: { outcome: string; grossR: number } | null) => {
		const a = aggBy.get(k) ?? newAgg()
		if (!aggBy.has(k)) aggBy.set(k, a)
		if (!r) { a.skipped++; return }
		if (r.outcome === 'End mark') { a.end++; return }
		a.n++
		a.sumR += r.grossR
		if (r.outcome === 'Partial') a.p++
		else if (r.outcome === 'Stop') a.s++
		else a.f++
	}

	for (const sig of signals) {
		const key = `${sig.symbol}_${sig.tfMin}`
		const rows = marketData.get(key)
		if (!rows) continue
		const tfMs = sig.tfMin * 60_000
		const closeTime = Math.floor(sig.timeMs / tfMs) * tfMs
		const signalOpen = closeTime - tfMs
		const idx = rows.findIndex((r) => r.timestamp === signalOpen)
		if (idx < 210 || idx >= rows.length - 1 || !Number.isFinite(rows[idx]!.mean)) { bump(`${sig.channel}|tf${sig.tfMin}|base`, null); bump(`${sig.channel}|tf${sig.tfMin}|winner`, null); continue }
		const tr55 = trueRangeSma(rows, 55)
		for (const [name, cfg] of [['base', BASE], ['winner', WINNER]] as const) {
			const t = replayVar1Trade(rows, tr55, idx, sig.side, cfg)
			bump(`${sig.channel}|tf${sig.tfMin}|${name}`, t)
			bump(`${sig.channel}|ALL|${name}`, t)
			bump(`ALL|ALL|${name}`, t)
			if (name === 'base') results.push({ ...sig, date: new Date(sig.timeMs).toISOString(), outcome: t?.outcome ?? 'no-data', grossR: t?.grossR ?? null })
		}
	}

	const md: string[] = []
	md.push('# FWD1 - forward audit of vendor Telegram signals (non-repaintable)')
	md.push('')
	md.push(`Signals parsed: ${signals.length}; pairs with market data: ${marketData.size}; failed pairs: ${failed.join(', ') || 'none'}`)
	md.push('Bands are the recovered approximation (mean ALMA(hlc3,200,0.85,6); width ALMA(TR/close,122,0.625,3.5), k=5.6/9.6).')
	md.push('base = P25/S12 (GGI-style DM3 V2); winner = P25/S10+ADD (VAR1 split-entry).')
	md.push('')
	md.push('| slice | machinery | n | mean R | WR | P/S/F | F:S | end/skip |')
	md.push('|---|---|---|---|---|---|---|---|')
	const keys = [...aggBy.keys()].sort()
	for (const k of keys) {
		const a = aggBy.get(k)!
		const [ch, tf, mach] = k.split('|')
		if (a.n === 0) { md.push(`| ${ch} ${tf} | ${mach} | 0 | - | - | - | - | ${a.end}/${a.skipped} |`); continue }
		md.push(`| ${ch} ${tf} | ${mach} | ${a.n} | ${(a.sumR / a.n).toFixed(4)} | ${(((a.p + a.f) / a.n) * 100).toFixed(1)}% | ${a.p}/${a.s}/${a.f} | ${a.s ? (a.f / a.s).toFixed(1) : 'inf'} | ${a.end}/${a.skipped} |`)
	}
	writeFileSync(resolve('ci-results/fwd1-telegram-forward-audit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), JSON.stringify({ trades: results }, null, 1))
	console.log('[fwd1] written ci-results/fwd1-telegram-forward-audit.md')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
