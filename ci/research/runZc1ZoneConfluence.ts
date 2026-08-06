/**
 * ZC1: zone-confluence audit - THE question this research started with.
 * Do the vendor's forward GGI signals (FWD1) perform better when they fire
 * INSIDE one of his own hand-drawn interest zones (topic 290 dump)?
 *
 * Zone matching:
 *  - same symbol; direction match (LONG needs a buy zone, SHORT a sell zone);
 *  - zone posted BEFORE the signal, signal within ZONE_TTL_DAYS of posting;
 *  - entry price inside [lo, hi] widened by TOLERANCE_FRAC of zone width
 *    (zones are hand-drawn; a small buffer reflects "working the zone");
 *  - price scale auto-fix: vendor quotes some alts at a different multiplier
 *    than Gate (e.g. 1000PEPE); we scale zone prices by the power of ten that
 *    best matches the market close at broadcast time, and reject the zone if
 *    even the best scale is >50% away.
 *
 * DESCRIPTIVE: n in-zone will be small; report exact counts, no cherry-picking.
 * Control split reported alongside: direction-matched zones vs all signals.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface TgMsg { id: number; date: string; text: string }
interface Zone { symbol: string; side: 1 | -1; lo: number; hi: number; timeMs: number; raw: string }
interface FwdTrade { symbol: string; tfMin: number; side: 1 | -1; timeMs: number; channel: string; outcome: string; grossR: number | null }

const ZONE_TTL_DAYS = 45
const TOLERANCE_FRAC = 0.25

const ZONE_RE = /^([A-ZА-Яa-zа-я0-9]+)\s+Зона\s+(покупок|продаж)[^\d]*([\d.,]+)(?:\s*-\s*([\d.,]+))?/u
const SKIP_SYMBOLS = new Set(['Нефть', 'SP500', 'NAS100', 'TOTALES', 'TOTAL', 'TOTAL2', 'TOTAL3', 'DXY'])

export function parseZones(path: string): { zones: Zone[]; skipped: string[] } {
	const msgs = JSON.parse(readFileSync(path, 'utf8')) as TgMsg[]
	const zones: Zone[] = []
	const skipped: string[] = []
	for (const m of msgs) {
		const text = (m.text ?? '').trim()
		if (!text || !text.includes('Зона')) continue
		const g = ZONE_RE.exec(text)
		if (!g) { skipped.push(text.slice(0, 60)); continue }
		const symbol = g[1]!
		if (SKIP_SYMBOLS.has(symbol) || !/USDT$/u.test(symbol)) { skipped.push(text.slice(0, 60)); continue }
		const p1 = Number(g[3]!.replace(',', '.'))
		const p2 = g[4] != null ? Number(g[4].replace(',', '.')) : p1
		if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 <= 0 || p2 <= 0) { skipped.push(text.slice(0, 60)); continue }
		// single-price zones get a synthetic +-1.5% band
		const lo0 = p1 === p2 ? p1 * 0.985 : Math.min(p1, p2)
		const hi0 = p1 === p2 ? p1 * 1.015 : Math.max(p1, p2)
		// guard against typos producing absurd ranges (e.g. "0.0415-0.0038-")
		if (hi0 / lo0 > 3) { skipped.push(text.slice(0, 60)); continue }
		zones.push({ symbol, side: g[2] === 'покупок' ? 1 : -1, lo: lo0, hi: hi0, timeMs: Date.parse(m.date), raw: text.slice(0, 60) })
	}
	return { zones, skipped }
}

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

function loadCache(symbol: string, tfMin: number): Kline[] | null {
	const p = resolve('data/gate-cache', `${symbol}_${tfMin}m.json`)
	if (!existsSync(p)) return null
	return (JSON.parse(readFileSync(p, 'utf8')) as { rows: Kline[] }).rows
}

/** pick power-of-ten scale aligning zone quote with market price; null if hopeless */
export function scaleZone(zoneMid: number, marketPrice: number): number | null {
	let best: number | null = null
	let bestErr = Infinity
	for (let k = -6; k <= 6; k++) {
		const scaled = zoneMid * 10 ** k
		const err = Math.abs(Math.log(scaled / marketPrice))
		if (err < bestErr) { bestErr = err; best = 10 ** k }
	}
	return bestErr <= Math.log(1.5) ? best : null
}

async function main() {
	const { zones, skipped } = parseZones(resolve('data/vendor-exports/tg_topic_290_zones.json'))
	const trades = (JSON.parse(readFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), 'utf8')) as { trades: FwdTrade[] }).trades
	console.log(`[zc1] zones parsed: ${zones.length}, skipped lines: ${skipped.length}, fwd trades: ${trades.length}`)

	// resolve scale per zone using market close nearest to zone broadcast
	const seriesCache = new Map<string, Kline[] | null>()
	const getSeries = (symbol: string, tfMin: number) => {
		const key = `${symbol}_${tfMin}`
		if (!seriesCache.has(key)) seriesCache.set(key, loadCache(symbol, tfMin))
		return seriesCache.get(key)!
	}

	const scaledZones: Zone[] = []
	let unscalable = 0
	for (const z of zones) {
		// any cached tf for this symbol will do for scale resolution
		let scale: number | null = null
		for (const tf of [60, 120, 15, 5, 240, 3, 1]) {
			const rows = getSeries(z.symbol, tf)
			if (!rows || rows.length === 0) continue
			let nearest: Kline | null = null
			let bestDt = Infinity
			for (const r of rows) { const dt = Math.abs(r.t - z.timeMs); if (dt < bestDt) { bestDt = dt; nearest = r } }
			if (nearest && bestDt < 7 * 86_400_000) { scale = scaleZone((z.lo + z.hi) / 2, nearest.c); break }
		}
		if (scale == null) { unscalable++; continue }
		scaledZones.push({ ...z, lo: z.lo * scale, hi: z.hi * scale })
	}
	console.log(`[zc1] usable zones after scaling: ${scaledZones.length} (unscalable/no market data: ${unscalable})`)

	interface Agg { n: number; sumR: number; p: number; s: number; f: number }
	const agg = (): Agg => ({ n: 0, sumR: 0, p: 0, s: 0, f: 0 })
	const groups: Record<string, Agg> = { 'in-zone': agg(), 'out-zone': agg(), 'no-zone-data': agg() }
	const inZoneTrades: Array<Record<string, unknown>> = []

	for (const t of trades) {
		if (t.grossR == null || t.outcome === 'End mark' || t.outcome === 'no-data') continue
		const rows = getSeries(t.symbol, t.tfMin)
		let entryPrice: number | null = null
		if (rows) {
			const tfMs = t.tfMin * 60_000
			const closeTime = Math.floor(t.timeMs / tfMs) * tfMs
			const signalOpen = closeTime - tfMs
			const idx = rows.findIndex((r) => r.t === signalOpen)
			if (idx >= 0 && idx + 1 < rows.length) entryPrice = rows[idx + 1]!.o
		}
		if (entryPrice == null) { const a = groups['no-zone-data']!; a.n++; a.sumR += t.grossR; continue }

		const candidates = scaledZones.filter((z) =>
			z.symbol === t.symbol && z.side === t.side &&
			z.timeMs <= t.timeMs && t.timeMs - z.timeMs <= ZONE_TTL_DAYS * 86_400_000)
		const width = (z: Zone) => z.hi - z.lo
		const hit = candidates.find((z) => entryPrice! >= z.lo - TOLERANCE_FRAC * width(z) && entryPrice! <= z.hi + TOLERANCE_FRAC * width(z))
		const bucket = hit ? 'in-zone' : 'out-zone'
		const a = groups[bucket]!
		a.n++
		a.sumR += t.grossR
		if (t.outcome === 'Partial') a.p++
		else if (t.outcome === 'Stop') a.s++
		else a.f++
		if (hit) inZoneTrades.push({ ...t, date: new Date(t.timeMs).toISOString(), entryPrice, zone: hit.raw, zoneAge_h: Math.round((t.timeMs - hit.timeMs) / 3_600_000) })
	}

	const md: string[] = []
	md.push('# ZC1 - zone confluence: vendor forward signals inside his own interest zones')
	md.push('')
	md.push(`Zones parsed ${zones.length}, usable after price-scale resolution ${scaledZones.length}.`)
	md.push(`Rules: direction-matched, zone age <= ${ZONE_TTL_DAYS}d, entry within zone +- ${TOLERANCE_FRAC * 100}% of width. Base machinery (P25/S12) R from FWD1.`)
	md.push('')
	md.push('| group | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const [k, a] of Object.entries(groups)) {
		if (a.n === 0) { md.push(`| ${k} | 0 | - | - | - |`); continue }
		md.push(`| ${k} | ${a.n} | ${(a.sumR / a.n).toFixed(4)} | ${(((a.p + a.f) / a.n) * 100).toFixed(1)}% | ${a.p}/${a.s}/${a.f} |`)
	}
	md.push('')
	md.push('## In-zone trades (every one, no selection)')
	md.push('')
	md.push('| date | symbol | tf | side | R | outcome | zone (raw) | zone age h |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const t of inZoneTrades) {
		md.push(`| ${String(t.date).slice(0, 16)} | ${t.symbol} | ${t.tfMin} | ${t.side === 1 ? 'L' : 'S'} | ${Number(t.grossR).toFixed(3)} | ${t.outcome} | ${t.zone} | ${t.zoneAge_h} |`)
	}
	writeFileSync(resolve('ci-results/zc1-zone-confluence.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/zc1-zone-confluence.json'), JSON.stringify({ groups, inZoneTrades }, null, 1))
	console.log('[zc1] written ci-results/zc1-zone-confluence.md')
	for (const [k, a] of Object.entries(groups)) console.log(`[zc1] ${k}: n=${a.n} meanR=${a.n ? (a.sumR / a.n).toFixed(4) : '-'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
