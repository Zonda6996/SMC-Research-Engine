import { writeFileSync } from 'node:fs'
import { buildRows } from '/vercel/share/smc-research/ci/research/runFwd1TelegramForwardAudit.js'

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

// Measured SAFE steps from Nikita's Bybit simulator screenshots.
// utcOpen = signal bar OPEN time UTC (simulator labels are UTC+5).
const samples = [
	{ sym: 'LINK_USDT', gInt: '2h', tfMin: 120, utcOpen: Date.UTC(2026, 6, 28, 14, 0), entry: 8.377, stepS: 0.528 },
	{ sym: 'SOL_USDT', gInt: '1h', tfMin: 60, utcOpen: Date.UTC(2026, 6, 25, 0, 0), entry: 74.09, stepS: 3.26 },
	{ sym: 'BTC_USDT', gInt: '1h', tfMin: 60, utcOpen: Date.UTC(2026, 6, 17, 13, 0), entry: 63149, stepS: 2027.1 },
	{ sym: 'ETH_USDT', gInt: '2h', tfMin: 120, utcOpen: Date.UTC(2026, 6, 7, 2, 0), entry: 1770.14, stepS: 121.34 },
	{ sym: 'TRX_USDT', gInt: '5m', tfMin: 5, utcOpen: Date.UTC(2026, 7, 4, 13, 20), entry: 0.32986, stepS: 0.00067 },
	{ sym: 'AVAX_USDT', gInt: '5m', tfMin: 5, utcOpen: Date.UTC(2026, 7, 5, 4, 0), entry: 6.625, stepS: 0.076 },
	{ sym: 'ONDO_USDT', gInt: '15m', tfMin: 15, utcOpen: Date.UTC(2026, 7, 3, 3, 45), entry: 0.3716, stepS: 0.0128 },
]

async function fetchGate(contract: string, interval: string, toSec: number, bars: number): Promise<Kline[]> {
	const out: Kline[] = []
	let to = toSec
	while (out.length < bars) {
		const lim = Math.min(1999, bars - out.length + 10)
		const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=${interval}&to=${to}&limit=${lim}`
		const res = await fetch(url)
		if (!res.ok) throw new Error(`gate ${contract} ${res.status}`)
		const arr = (await res.json()) as Array<{ t: number; o: string; h: string; l: string; c: string; v: number }>
		if (arr.length === 0) break
		const mapped = arr.map((r) => ({ t: r.t * 1000, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: r.v }))
		out.unshift(...mapped.filter((m) => !out.some((x) => x.t === m.t)))
		to = Math.floor(mapped[0]!.t / 1000) - 1
		if (arr.length < 5) break
	}
	return out.sort((a, b) => a.t - b.t)
}

function rma(vals: number[], n: number): number[] {
	const out = new Array(vals.length).fill(NaN)
	let s = 0
	for (let i = 0; i < vals.length; i++) {
		if (i < n) { s += vals[i]!; if (i === n - 1) out[i] = s / n }
		else out[i] = (out[i - 1]! * (n - 1) + vals[i]!) / n
	}
	return out
}

async function main() {
	const rowsPerSample: Array<{ name: string; step: number; metrics: Record<string, number> }> = []
	for (const s of samples) {
		const closeSec = Math.floor((s.utcOpen + s.tfMin * 60_000) / 1000) + s.tfMin * 60 * 3
		const kl = await fetchGate(s.sym, s.gInt, closeSec, 700)
		const rows = buildRows(kl)
		const idx = rows.findIndex((r) => r.timestamp === s.utcOpen)
		if (idx < 250) { console.log('MISS/short', s.sym, idx); continue }
		const tr: number[] = [0]
		for (let i = 1; i < rows.length; i++) {
			const r = rows[i]!, p = rows[i - 1]!
			tr.push(Math.max(r.high - r.low, Math.abs(r.high - p.close), Math.abs(r.low - p.close)))
		}
		const m: Record<string, number> = {}
		for (const n of [7, 14, 21, 34, 55, 100, 200]) {
			const a = rma(tr, n)[idx]
			m[`ATRrma${n}`] = a!
			let sm = 0
			for (let k = idx - n + 1; k <= idx; k++) sm += tr[k]!
			m[`ATRsma${n}`] = sm / n
		}
		const r = rows[idx]!
		const side = Math.sign(s.entry - (r.mean as number)) || 1 // SELL if entry>mean
		const innerNear = side > 0 ? r.upperInner : r.lowerInner
		const outerNear = side > 0 ? r.upperOuter : r.lowerOuter
		m['zoneThick'] = Math.abs((outerNear as number) - (innerNear as number))
		m['meanToInner'] = Math.abs((r.mean as number) - (innerNear as number))
		m['meanToOuter'] = Math.abs((r.mean as number) - (outerNear as number))
		m['entryToOuter'] = Math.abs(s.entry - (outerNear as number))
		m['entryToMean'] = Math.abs(s.entry - (r.mean as number))
		const oppInner = side > 0 ? r.lowerInner : r.upperInner
		m['channelFull'] = Math.abs((innerNear as number) - (oppInner as number))
		let sum = 0, sum2 = 0
		for (let k = idx - 19; k <= idx; k++) { sum += rows[k]!.close; sum2 += rows[k]!.close ** 2 }
		m['stdev20'] = Math.sqrt(Math.max(0, sum2 / 20 - (sum / 20) ** 2))
		rowsPerSample.push({ name: `${s.sym.replace('_USDT', '')} ${s.gInt}`, step: s.stepS, metrics: m })
	}
	// rank candidates by CV of k = step/metric
	const names = Object.keys(rowsPerSample[0]!.metrics)
	const results: Array<{ cand: string; kMean: number; cv: number; ks: number[] }> = []
	for (const c of names) {
		const ks = rowsPerSample.map((r) => r.step / r.metrics[c]!)
		if (ks.some((k) => !Number.isFinite(k) || k <= 0)) continue
		const mean = ks.reduce((a, b) => a + b, 0) / ks.length
		const cv = Math.sqrt(ks.reduce((a, b) => a + (b - mean) ** 2, 0) / ks.length) / mean
		results.push({ cand: c, kMean: mean, cv, ks })
	}
	results.sort((a, b) => a.cv - b.cv)
	console.log('samples:', rowsPerSample.map((r) => r.name).join(', '))
	console.log('\nTOP candidates (k = step_safe / metric, CV = consistency, lower better):')
	for (const r of results.slice(0, 10)) {
		console.log(`${r.cand.padEnd(14)} k=${r.kMean.toFixed(3)} CV=${(r.cv * 100).toFixed(1)}%  ks=[${r.ks.map((k) => k.toFixed(2)).join(', ')}]`)
	}
	writeFileSync('/tmp/stepcalib-out.json', JSON.stringify({ rowsPerSample, results }, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
