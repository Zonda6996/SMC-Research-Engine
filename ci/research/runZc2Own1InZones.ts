/**
 * ZC2: does OWN1 (our open reversal signal) also earn inside the vendor's
 * hand-drawn zones? If yes, the subscriber needs the ZONES, not the arrows.
 *
 * Setup mirrors ZC1 exactly: same zones (topic 290, scaled), same matching
 * rules (direction match, age <= 45d, entry within zone +-25% width), same
 * base machinery (P25/S12). Signals: OWN1 bk1.5/M10 cooldown 40, generated
 * on the SAME Gate klines + reconstructed bands used in FWD1, over each
 * symbol/tf series already cached (only bars after the first zone for that
 * symbol matter, but we generate everywhere and let the zone filter select).
 *
 * DESCRIPTIVE companion to ZC1; single a-priori configuration, no sweeps.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma } from './lib/ggiCorrectedReplay.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import { replayVar1Trade, type Var1Config } from './runVar1ExitSweep.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { parseZones, scaleZone } from './runZc1ZoneConfluence.js'

const ZONE_TTL_DAYS = 45
const TOLERANCE_FRAC = 0.25
const BASE: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

async function main() {
	const { zones } = parseZones(resolve('data/vendor-exports/tg_topic_290_zones.json'))
	const cacheFiles = readdirSync(resolve('data/gate-cache')).filter((f) => f.endsWith('.json'))

	interface Agg { n: number; sumR: number; p: number; s: number; f: number }
	const agg = (): Agg => ({ n: 0, sumR: 0, p: 0, s: 0, f: 0 })
	const groups: Record<string, Agg> = { 'in-zone': agg(), 'out-zone': agg() }
	const inZoneTrades: Array<Record<string, unknown>> = []

	for (const file of cacheFiles) {
		const m = /^([A-Z0-9]+)_(\d+)m\.json$/u.exec(file)
		if (!m) continue
		const symbol = m[1]!
		const tfMin = Number(m[2]!)
		const symZones = zones.filter((z) => z.symbol === symbol)
		if (symZones.length === 0) continue
		const klines = (JSON.parse(readFileSync(resolve('data/gate-cache', file), 'utf8')) as { rows: Kline[] }).rows
		if (klines.length < 300) continue
		const rows = buildRows(klines)
		// scale zones against this series (nearest close to zone time)
		const scaled = symZones.flatMap((z) => {
			let nearest: Kline | null = null
			let bestDt = Infinity
			for (const r of klines) { const dt = Math.abs(r.t - z.timeMs); if (dt < bestDt) { bestDt = dt; nearest = r } }
			if (!nearest || bestDt > 7 * 86_400_000) return []
			const s = scaleZone((z.lo + z.hi) / 2, nearest.c)
			return s == null ? [] : [{ ...z, lo: z.lo * s, hi: z.hi * s }]
		})
		if (scaled.length === 0) continue
		const bSma = bodySma20(rows)
		const tr55 = trueRangeSma(rows, 55)
		const signals = own1Signals(rows, bSma, 1.5, 10, 0, rows.length)
		for (const sig of signals) {
			const bar = rows[sig.idx]!
			if (!Number.isFinite(bar.mean)) continue
			const entryRow = rows[sig.idx + 1]
			if (!entryRow) continue
			const t = replayVar1Trade(rows, tr55, sig.idx, sig.side, BASE)
			if (!t || t.outcome === 'End mark') continue
			const sigTime = bar.timestamp + tfMin * 60_000 // signal confirmed at bar close
			const width = (z: { lo: number; hi: number }) => z.hi - z.lo
			const hit = scaled.find((z) =>
				z.side === sig.side && z.timeMs <= sigTime && sigTime - z.timeMs <= ZONE_TTL_DAYS * 86_400_000 &&
				entryRow.open >= z.lo - TOLERANCE_FRAC * width(z) && entryRow.open <= z.hi + TOLERANCE_FRAC * width(z))
			// out-zone here = signals on zone-covered symbols that missed the zones,
			// restricted to the time range where zones were live for fairness
			const anyLive = scaled.some((z) => z.timeMs <= sigTime && sigTime - z.timeMs <= ZONE_TTL_DAYS * 86_400_000)
			if (!hit && !anyLive) continue
			const a = groups[hit ? 'in-zone' : 'out-zone']!
			a.n++
			a.sumR += t.grossR
			if (t.outcome === 'Partial') a.p++
			else if (t.outcome === 'Stop') a.s++
			else a.f++
			if (hit) inZoneTrades.push({ symbol, tfMin, side: sig.side, date: new Date(sigTime).toISOString(), grossR: t.grossR, outcome: t.outcome, zone: hit.raw })
		}
	}

	const md: string[] = []
	md.push('# ZC2 - OWN1 signals inside the vendor zones (same rules as ZC1)')
	md.push('')
	md.push('OWN1 bk1.5/M10/cooldown40 on Gate klines + reconstructed bands; base machinery P25/S12.')
	md.push('out-zone = OWN1 signals on the same symbols while at least one direction-matched-age-valid zone was live but price was outside all zones, or direction mismatched.')
	md.push('')
	md.push('| group | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const [k, a] of Object.entries(groups)) {
		if (a.n === 0) { md.push(`| ${k} | 0 | - | - | - |`); continue }
		md.push(`| ${k} | ${a.n} | ${(a.sumR / a.n).toFixed(4)} | ${(((a.p + a.f) / a.n) * 100).toFixed(1)}% | ${a.p}/${a.s}/${a.f} |`)
	}
	md.push('')
	md.push('## In-zone OWN1 trades (all)')
	md.push('')
	md.push('| date | symbol | tf | side | R | outcome | zone |')
	md.push('|---|---|---|---|---|---|---|')
	for (const t of inZoneTrades) md.push(`| ${String(t.date).slice(0, 16)} | ${t.symbol} | ${t.tfMin} | ${t.side === 1 ? 'L' : 'S'} | ${Number(t.grossR).toFixed(3)} | ${t.outcome} | ${t.zone} |`)
	writeFileSync(resolve('ci-results/zc2-own1-in-zones.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/zc2-own1-in-zones.json'), JSON.stringify({ groups, inZoneTrades }, null, 1))
	for (const [k, a] of Object.entries(groups)) console.log(`[zc2] ${k}: n=${a.n} meanR=${a.n ? (a.sumR / a.n).toFixed(4) : '-'} P/S/F=${a.p}/${a.s}/${a.f}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
