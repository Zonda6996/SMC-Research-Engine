/**
 * REV1: reverse-engineering the GGI "secret gating".
 *
 * Fact: OWN1 (body>1.5x bodySMA20 after M10 dryness, close beyond band) fires
 * ~12x/month per symbol on 1h; the vendor's forward Telegram arrows fire
 * ~2-3x/month. So GGI = OWN1-like raw condition + an unknown selectivity gate.
 *
 * Ground truth: FWD1 parsed Telegram signals (non-repaintable, timestamped).
 * For every 1h/2h symbol series in the FWD1 gate-cache we generate OWN1
 * signals and split bars into three groups:
 *   BOTH   - OWN1 fired and a GGI arrow exists within +-2 bars, same side;
 *   OWNONLY- OWN1 fired, no GGI arrow nearby (the gate REJECTED this bar);
 *   GGIONLY- GGI arrow with no OWN1 signal nearby (our raw condition missed).
 * Then we compare candidate gating features per group:
 *   penetration depth beyond outer band (in band half-widths);
 *   band width percentile (squeeze vs expansion);
 *   dryness run length before signal (# bars since last big body);
 *   body multiple (body / bodySMA20);
 *   RSI14; volume ratio (vol / volSMA20);
 *   consecutive closes beyond the band; distance from Mean in %;
 *   bars since previous OWN1 signal (cooldown proxy).
 * Output: per-feature mean/median by group + single-feature threshold scan
 * (best accuracy separating BOTH vs OWNONLY). DESCRIPTIVE - this tells us
 * WHICH dimension the gate lives on, not the exact formula.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface FwdTrade { symbol: string; tfMin: number; side: 1 | -1; timeMs: number }
interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

function rsi14(rows: readonly ExactIndicatorRow[]): number[] {
	const out = new Array<number>(rows.length).fill(NaN)
	let ag = 0, al = 0
	for (let i = 1; i < rows.length; i++) {
		const ch = rows[i]!.close - rows[i - 1]!.close
		const g = Math.max(ch, 0), l = Math.max(-ch, 0)
		if (i <= 14) { ag += g / 14; al += l / 14 }
		else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14 }
		if (i >= 14) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
	}
	return out
}

interface Feat {
	group: string; symbol: string; tfMin: number; side: number; timeMs: number
	pen: number; bwPctl: number; dry: number; bodyMult: number; rsi: number
	volRatio: number; consecOut: number; distMeanPct: number; barsSincePrev: number
}

function features(rows: readonly ExactIndicatorRow[], bSma: readonly number[], rsi: readonly number[], bwSorted: readonly number[], i: number, side: number, prevSigIdx: number): Omit<Feat, 'group' | 'symbol' | 'tfMin' | 'timeMs'> | null {
	const r = rows[i]!
	if (!Number.isFinite(r.mean) || !Number.isFinite(r.upperInner) || !Number.isFinite(r.lowerInner)) return null
	const half = side === 1 ? r.mean - r.lowerInner : r.upperInner - r.mean
	if (half <= 0) return null
	const band = side === 1 ? r.lowerInner : r.upperInner
	const pen = side === 1 ? (band - r.close) / half : (r.close - band) / half
	const bw = (r.upperInner - r.lowerInner) / r.mean
	let lo = 0, hi = bwSorted.length
	while (lo < hi) { const m = (lo + hi) >> 1; if (bwSorted[m]! < bw) lo = m + 1; else hi = m }
	const bwPctl = bwSorted.length ? lo / bwSorted.length : NaN
	let dry = 0
	for (let k = i - 1; k >= Math.max(0, i - 60); k--) {
		const body = Math.abs(rows[k]!.close - rows[k]!.open)
		if (Number.isFinite(bSma[k]!) && body > bSma[k]!) break
		dry++
	}
	const body = Math.abs(r.close - r.open)
	const bodyMult = Number.isFinite(bSma[i]!) && bSma[i]! > 0 ? body / bSma[i]! : NaN
	let volSum = 0, volN = 0
	for (let k = Math.max(0, i - 20); k < i; k++) { volSum += rows[k]!.volume; volN++ }
	const volRatio = volN > 0 && volSum > 0 ? r.volume / (volSum / volN) : NaN
	let consecOut = 0
	for (let k = i; k >= Math.max(0, i - 20); k--) {
		const rr = rows[k]!
		const b = side === 1 ? rr.lowerInner : rr.upperInner
		if (!Number.isFinite(b)) break
		if (side === 1 ? rr.close < b : rr.close > b) consecOut++
		else break
	}
	return {
		side, pen, bwPctl, dry, bodyMult, rsi: rsi[i] ?? NaN, volRatio, consecOut,
		distMeanPct: (Math.abs(r.close - r.mean) / r.mean) * 100,
		barsSincePrev: prevSigIdx >= 0 ? i - prevSigIdx : 999,
	}
}

async function main() {
	const trades = (JSON.parse(readFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), 'utf8')) as { trades: FwdTrade[] }).trades
	const feats: Feat[] = []
	const files = readdirSync(resolve('data/gate-cache')).filter((f) => /^[A-Z0-9]+_(60|120)m\.json$/u.test(f))
	for (const file of files) {
		const m = /^([A-Z0-9]+)_(\d+)m\.json$/u.exec(file)!
		const symbol = m[1]!
		const tfMin = Number(m[2]!)
		const ggi = trades.filter((t) => t.symbol === symbol && t.tfMin === tfMin)
		if (ggi.length === 0) continue
		const klines = (JSON.parse(readFileSync(resolve('data/gate-cache', file), 'utf8')) as { rows: Kline[] }).rows
		if (klines.length < 300) continue
		const rows = buildRows(klines)
		const bSma = bodySma20(rows)
		const rsi = rsi14(rows)
		const bwAll: number[] = []
		for (const r of rows) if (Number.isFinite(r.upperInner) && Number.isFinite(r.lowerInner) && Number.isFinite(r.mean) && r.mean > 0) bwAll.push((r.upperInner - r.lowerInner) / r.mean)
		bwAll.sort((a, b) => a - b)
		const own = own1Signals(rows, bSma, 1.5, 10, 0, rows.length)
		const tfMs = tfMin * 60_000
		// map GGI arrows to bar indices (signal close = floor(timeMs/tf)*tf; bar open index)
		const idxByOpen = new Map<number, number>()
		for (let i = 0; i < rows.length; i++) idxByOpen.set(rows[i]!.timestamp, i)
		const ggiIdx: Array<{ idx: number; side: 1 | -1 }> = []
		for (const g of ggi) {
			const openT = Math.floor(g.timeMs / tfMs) * tfMs - tfMs
			const idx = idxByOpen.get(openT)
			if (idx != null) ggiIdx.push({ idx, side: g.side })
		}
		const ownArr = own.map((s) => ({ idx: s.idx, side: s.side }))
		const matchedGgi = new Set<number>()
		let prev = -1
		for (const s of ownArr) {
			const g = ggiIdx.find((x) => Math.abs(x.idx - s.idx) <= 2 && x.side === s.side)
			const f = features(rows, bSma, rsi, bwAll, s.idx, s.side, prev)
			prev = s.idx
			if (!f) continue
			if (g) matchedGgi.add(g.idx)
			feats.push({ group: g ? 'BOTH' : 'OWNONLY', symbol, tfMin, timeMs: rows[s.idx]!.timestamp, ...f })
		}
		for (const g of ggiIdx) {
			if (matchedGgi.has(g.idx)) continue
			const f = features(rows, bSma, rsi, bwAll, g.idx, g.side, -1)
			if (!f) continue
			feats.push({ group: 'GGIONLY', symbol, tfMin, timeMs: rows[g.idx]!.timestamp, ...f })
		}
	}

	const keys = ['pen', 'bwPctl', 'dry', 'bodyMult', 'rsi', 'volRatio', 'consecOut', 'distMeanPct', 'barsSincePrev'] as const
	const byGroup = (g: string) => feats.filter((f) => f.group === g)
	const stat = (arr: number[]) => {
		const a = arr.filter(Number.isFinite).sort((x, y) => x - y)
		if (a.length === 0) return { mean: NaN, med: NaN, p25: NaN, p75: NaN }
		return { mean: a.reduce((x, y) => x + y, 0) / a.length, med: a[Math.floor(a.length / 2)]!, p25: a[Math.floor(a.length * 0.25)]!, p75: a[Math.floor(a.length * 0.75)]! }
	}

	const md: string[] = []
	md.push('# REV1 - what separates GGI-confirmed bars from OWN1-only bars (the secret gate)')
	md.push('')
	md.push(`Ground truth: FWD1 telegram arrows on 1h/2h. Groups: BOTH n=${byGroup('BOTH').length}, OWNONLY n=${byGroup('OWNONLY').length}, GGIONLY n=${byGroup('GGIONLY').length}.`)
	md.push('OWN1 recall of GGI arrows = BOTH / (BOTH + GGIONLY). GGI acceptance of OWN1 = BOTH / (BOTH + OWNONLY).')
	md.push('')
	md.push('| feature | BOTH mean (med) | OWNONLY mean (med) | GGIONLY mean (med) |')
	md.push('|---|---|---|---|')
	for (const k of keys) {
		const b = stat(byGroup('BOTH').map((f) => f[k]))
		const o = stat(byGroup('OWNONLY').map((f) => f[k]))
		const g = stat(byGroup('GGIONLY').map((f) => f[k]))
		md.push(`| ${k} | ${b.mean.toFixed(3)} (${b.med.toFixed(3)}) | ${o.mean.toFixed(3)} (${o.med.toFixed(3)}) | ${g.mean.toFixed(3)} (${g.med.toFixed(3)}) |`)
	}
	md.push('')
	// single-feature threshold scan BOTH vs OWNONLY
	md.push('## Single-feature separation scan (BOTH vs OWNONLY, balanced accuracy)')
	md.push('')
	md.push('| feature | best threshold | direction | bal.acc | TPR | TNR |')
	md.push('|---|---|---|---|---|---|')
	const B = byGroup('BOTH'), O = byGroup('OWNONLY')
	for (const k of keys) {
		const bv = B.map((f) => f[k]).filter(Number.isFinite)
		const ov = O.map((f) => f[k]).filter(Number.isFinite)
		if (bv.length < 10 || ov.length < 10) continue
		const all = [...bv, ...ov].sort((a, b2) => a - b2)
		let best = { thr: NaN, dir: '>', acc: 0, tpr: 0, tnr: 0 }
		for (let q = 2; q < 98; q += 2) {
			const thr = all[Math.floor((all.length * q) / 100)]!
			for (const dir of ['>', '<'] as const) {
				const tpr = bv.filter((v) => (dir === '>' ? v > thr : v < thr)).length / bv.length
				const tnr = ov.filter((v) => (dir === '>' ? v <= thr : v >= thr)).length / ov.length
				const acc = (tpr + tnr) / 2
				if (acc > best.acc) best = { thr, dir, acc, tpr, tnr }
			}
		}
		md.push(`| ${k} | ${best.thr.toFixed(3)} | ${best.dir} | ${(best.acc * 100).toFixed(1)}% | ${(best.tpr * 100).toFixed(0)}% | ${(best.tnr * 100).toFixed(0)}% |`)
	}
	writeFileSync(resolve('ci-results/rev1-secret-gating.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/rev1-secret-gating.json'), JSON.stringify(feats, null, 1))
	console.log(md.slice(0, 40).join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
