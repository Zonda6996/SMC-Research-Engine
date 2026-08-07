/**
 * IMP1 - management/exit ablation on OUR extension signals with the
 * calibrated GGI geometry as the baseline. Goal: find which parts of
 * the vendor machinery help, hurt, or can be replaced.
 *
 * Honest-science setup:
 *  - FEES included: 0.05% taker per fill (Bybit-ish), converted to R.
 *  - SPLIT: per-series 60/40 time split. Train = variant ranking,
 *    Holdout = only reported, never used for picking.
 *  - Signals fixed (own2Raw + per-mode gate) - only management varies.
 * R basis: position sized so the worst-case planned stop = -1R for the
 * variant's own geometry (add-filled where add exists).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { own2Raw } from './runOwn2ExtensionTrigger.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

const FEE = 0.0005

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

interface Variant {
	name: string
	desc: string
	useAdd: boolean
	stopMult: number // in steps from entry
	partialFrac: number // fraction closed at mean touch (0 = none)
	beAfterPartial: boolean
	tp: 'inner' | 'mean' | 'static2' | 'static3'
	maxBars?: number // time stop in bars (undefined = none)
}

const variants: Variant[] = [
	{ name: 'BASE', desc: 'vendor safe machinery (calibrated reference)', useAdd: true, stopMult: 2, partialFrac: 0.25, beAfterPartial: true, tp: 'inner' },
	{ name: 'NOADD', desc: 'no averaging-in, same stop', useAdd: false, stopMult: 2, partialFrac: 0.25, beAfterPartial: true, tp: 'inner' },
	{ name: 'NOPART', desc: 'no partial - full position to inner band', useAdd: true, stopMult: 2, partialFrac: 0, beAfterPartial: false, tp: 'inner' },
	{ name: 'MEANEXIT', desc: 'take everything at mean touch', useAdd: true, stopMult: 2, partialFrac: 0, beAfterPartial: false, tp: 'mean' },
	{ name: 'HALFMEAN', desc: '50% at mean, rest to inner band, BE', useAdd: true, stopMult: 2, partialFrac: 0.5, beAfterPartial: true, tp: 'inner' },
	{ name: 'TIGHT', desc: 'stop 1.5 steps, otherwise BASE', useAdd: true, stopMult: 1.5, partialFrac: 0.25, beAfterPartial: true, tp: 'inner' },
	{ name: 'WIDE', desc: 'stop 3 steps, otherwise BASE', useAdd: true, stopMult: 3, partialFrac: 0.25, beAfterPartial: true, tp: 'inner' },
	{ name: 'NOADD-MEAN', desc: 'no add, all out at mean', useAdd: false, stopMult: 2, partialFrac: 0, beAfterPartial: false, tp: 'mean' },
	{ name: 'STATIC2', desc: 'static TP 2 steps (std-like), with partial', useAdd: true, stopMult: 2, partialFrac: 0.25, beAfterPartial: true, tp: 'static2' },
	{ name: 'TIME48', desc: 'BASE + time stop 48 bars', useAdd: true, stopMult: 2, partialFrac: 0.25, beAfterPartial: true, tp: 'inner', maxBars: 48 },
]

interface Res { r: number; exitIdx: number }

function replay(rows: readonly ExactIndicatorRow[], atr: readonly number[], sigIdx: number, side: 1 | -1, v: Variant): Res | null {
	const e = rows[sigIdx + 1]
	const a = atr[sigIdx]
	if (!e || !Number.isFinite(a)) return null
	const step = 5.5 * (a as number)
	const entry = e.open
	const add = side === 1 ? entry - step : entry + step
	const stop = side === 1 ? entry - v.stopMult * step : entry + v.stopMult * step
	const staticTp = v.tp === 'static2' ? (side === 1 ? entry + 2 * step : entry - 2 * step) : v.tp === 'static3' ? (side === 1 ? entry + 3 * step : entry - 3 * step) : NaN
	// oneR = worst-case planned loss for this variant's own geometry
	const maxUnits = v.useAdd ? 2 : 1
	const avgWorst = v.useAdd ? (entry + add) / 2 : entry
	const oneR = Math.abs(avgWorst - stop) * maxUnits
	let addFilled = false, partialDone = false, realized = 0, units = 1, avgEntry = entry
	let notional = entry
	const endIdx = v.maxBars ? Math.min(rows.length - 1, sigIdx + 1 + v.maxBars) : rows.length - 1
	for (let i = sigIdx + 1; i < rows.length; i++) {
		const r = rows[i]!
		if (v.useAdd && !addFilled && (side === 1 ? r.low <= add : r.high >= add)) {
			addFilled = true
			const newUnits = units + (partialDone ? 1 - v.partialFrac : 1)
			avgEntry = (avgEntry * units + add * (newUnits - units)) / newUnits
			notional += add * (newUnits - units)
			units = newUnits
		}
		if (side === 1 ? r.low <= stop : r.high >= stop) {
			notional += stop * units
			const gross = realized + (side === 1 ? stop - avgEntry : avgEntry - stop) * units
			return { r: (gross - notional * FEE) / oneR, exitIdx: i }
		}
		const mean = r.mean as number
		if (v.partialFrac > 0 && !partialDone && Number.isFinite(mean) && (side === 1 ? r.high >= mean : r.low <= mean)) {
			const closed = units * v.partialFrac
			realized += (side === 1 ? mean - avgEntry : avgEntry - mean) * closed
			notional += mean * closed
			units -= closed
			partialDone = true
		}
		if (v.beAfterPartial && partialDone && Number.isFinite(mean) && (side === 1 ? mean < avgEntry : mean > avgEntry)) {
			if (side === 1 ? r.high >= avgEntry : r.low <= avgEntry) {
				notional += avgEntry * units
				return { r: (realized - notional * FEE) / oneR, exitIdx: i }
			}
		}
		let tpPrice = NaN
		if (v.tp === 'inner') tpPrice = (side === 1 ? r.upperInner : r.lowerInner) as number
		else if (v.tp === 'mean') tpPrice = mean
		else tpPrice = staticTp
		if (Number.isFinite(tpPrice) && (side === 1 ? r.high >= tpPrice : r.low <= tpPrice)) {
			notional += tpPrice * units
			const gross = realized + (side === 1 ? tpPrice - avgEntry : avgEntry - tpPrice) * units
			return { r: (gross - notional * FEE) / oneR, exitIdx: i }
		}
		if (i >= endIdx && v.maxBars) {
			const px = r.close
			notional += px * units
			const gross = realized + (side === 1 ? px - avgEntry : avgEntry - px) * units
			return { r: (gross - notional * FEE) / oneR, exitIdx: i }
		}
	}
	return null // still open - excluded
}

interface Agg { n: number; sumR: number; wins: number; sumWin: number; sumLoss: number }
const agg = (): Agg => ({ n: 0, sumR: 0, wins: 0, sumWin: 0, sumLoss: 0 })
function tally(a: Agg, r: number) {
	a.n++
	a.sumR += r
	if (r > 0) { a.wins++; a.sumWin += r } else a.sumLoss += r
}
const fmt = (a: Agg) =>
	`n ${String(a.n).padStart(4)} | mean R ${(a.sumR / Math.max(1, a.n)).toFixed(4)} | total ${a.sumR.toFixed(1).padStart(7)}R | WR ${((a.wins / Math.max(1, a.n)) * 100).toFixed(1)}% | PF ${a.sumLoss !== 0 ? (a.sumWin / -a.sumLoss).toFixed(2) : '-'}`

async function main() {
	const files = readdirSync(resolve('data/gate-cache')).filter((f) => /^[A-Z0-9]+_(60|120)m\.json$/u.test(f))
	const train: Record<string, Agg> = {}, hold: Record<string, Agg> = {}
	for (const v of variants) { train[v.name] = agg(); hold[v.name] = agg() }
	for (const file of files) {
		const klines = (JSON.parse(readFileSync(resolve('data/gate-cache', file), 'utf8')) as { rows: Kline[] }).rows
		if (klines.length < 400) continue
		const rows = buildRows(klines)
		const atr = atrRma200(rows)
		const splitIdx = Math.floor(rows.length * 0.6)
		const raw = own2Raw(rows)
		for (const v of variants) {
			let blockedUntil = -1
			for (const s of raw) {
				if (s.idx <= blockedUntil || s.idx <= 200 || s.idx + 2 >= rows.length) continue
				const res = replay(rows, atr, s.idx, s.side, v)
				if (!res) continue
				tally(s.idx < splitIdx ? train[v.name]! : hold[v.name]!, res.r)
				blockedUntil = res.exitIdx + 3
			}
		}
	}
	const md: string[] = [
		'# IMP1 - management ablation on OUR signals, calibrated geometry, NET of 0.05%/fill fees',
		'',
		'Signals fixed (own2Raw + gate). Only management varies. 60/40 time split per series;',
		'train ranks, holdout only reports. R basis: variant-own worst-case stop = -1R.',
		'',
		'| variant | TRAIN | HOLDOUT | description |',
		'|---|---|---|---|',
	]
	const ranked = [...variants].sort((a, b) => (train[b.name]!.sumR / Math.max(1, train[b.name]!.n)) - (train[a.name]!.sumR / Math.max(1, train[a.name]!.n)))
	for (const v of ranked) md.push(`| ${v.name} | ${fmt(train[v.name]!)} | ${fmt(hold[v.name]!)} | ${v.desc} |`)
	writeFileSync(resolve('ci-results/imp1-management-ablation.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/imp1-management-ablation.json'), JSON.stringify({ train, hold }, null, 1))
	console.log(md.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
