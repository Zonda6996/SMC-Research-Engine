/**
 * SUR1: surrogate signal generator evaluated in R. Spec frozen in
 * ci-results/sur1-surrogate-signal-preregistration.md (committed first).
 *
 * 9 frozen rules (3 stretch x 3 volume-k), cooldown 40 bars/side, evaluated
 * through the DM3 V2 exit machinery (OOS-confirmed) against two benchmarks on
 * identical machinery: vendor arrows and 200 seeded random draws.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import { replayDm3Trade, WARMUP } from './runDm3StaticExit.js'

export const COOLDOWN = 40
export const RANDOM_DRAWS = 200
export const SEED = 1337
export const STRETCHES = ['S1_wick_outer', 'S2_close_outer', 'S3_twobar_outer'] as const
export const VOL_KS = [1.25, 1.75, 2.5] as const
export type Stretch = (typeof STRETCHES)[number]

export function volumeSma(rows: readonly ExactIndicatorRow[], period: number): Array<number | null> {
	const out: Array<number | null> = new Array(rows.length).fill(null)
	let sum = 0
	for (let i = 0; i < rows.length; i++) {
		sum += rows[i]!.volume
		if (i >= period) sum -= rows[i - period]!.volume
		if (i >= period - 1) out[i] = sum / period
	}
	return out
}

function stretchSide(rows: readonly ExactIndicatorRow[], i: number, s: Stretch): CorrectedGgiSide | 0 {
	const r = rows[i]!
	if (s === 'S1_wick_outer') {
		if (r.low <= r.lowerOuter) return 1
		if (r.high >= r.upperOuter) return -1
	} else if (s === 'S2_close_outer') {
		if (r.close <= r.lowerOuter) return 1
		if (r.close >= r.upperOuter) return -1
	} else {
		const p = rows[i - 1]
		if (p && validGgiBand(p)) {
			if ((r.low <= r.lowerOuter || p.low <= p.lowerOuter) && r.close < r.mean) return 1
			if ((r.high >= r.upperOuter || p.high >= p.upperOuter) && r.close > r.mean) return -1
		}
	}
	return 0
}

/** Generate surrogate signals for one rule (frozen: cooldown 40/side, warm-up 100). */
export function surrogateSignals(
	rows: readonly ExactIndicatorRow[],
	volSma: readonly (number | null)[],
	stretch: Stretch,
	volK: number,
): Array<{ idx: number; side: CorrectedGgiSide }> {
	const out: Array<{ idx: number; side: CorrectedGgiSide }> = []
	let lastBuy = -Infinity
	let lastSell = -Infinity
	for (let i = WARMUP; i < rows.length; i++) {
		const r = rows[i]!
		if (!validGgiBand(r)) continue
		const v = volSma[i]
		if (v == null || v <= 0 || r.volume < volK * v) continue
		const side = stretchSide(rows, i, stretch)
		if (side === 1 && i - lastBuy > COOLDOWN) { out.push({ idx: i, side }); lastBuy = i }
		else if (side === -1 && i - lastSell > COOLDOWN) { out.push({ idx: i, side }); lastSell = i }
	}
	return out
}

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

interface EvalResult { n: number; meanR: number; wr: number }

function evalSignals(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], signals: ReadonlyArray<{ idx: number; side: CorrectedGgiSide }>): EvalResult {
	const rs: number[] = []
	let wins = 0
	for (const s of signals) {
		const t = replayDm3Trade(rows, tr55, s.idx, s.side, 'V2_movP_staticTPwick')
		if (t && t.outcome !== 'End mark') {
			rs.push(t.grossR)
			if (t.outcome !== 'Stop') wins++
		}
	}
	return { n: rs.length, meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN, wr: rs.length ? wins / rs.length : NaN }
}

function randomBenchmark(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], n: number, rng: () => number): { mean: number; p5: number; p95: number } {
	const eligible: number[] = []
	for (let i = WARMUP; i < rows.length - 1; i++) if (validGgiBand(rows[i]!) && tr55[i] != null) eligible.push(i)
	const means: number[] = []
	for (let d = 0; d < RANDOM_DRAWS; d++) {
		const picked: Array<{ idx: number; side: CorrectedGgiSide }> = []
		let lastBuy = -Infinity
		let lastSell = -Infinity
		const shuffled = eligible.slice()
		for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = shuffled[i]!; shuffled[i] = shuffled[j]!; shuffled[j] = tmp }
		for (const idx of shuffled.slice().sort((a, b) => a - b)) {
			if (picked.length >= n) break
			const side: CorrectedGgiSide = rng() < 0.5 ? 1 : -1
			if (side === 1 ? idx - lastBuy > COOLDOWN : idx - lastSell > COOLDOWN) {
				// random subsample: accept with prob n/eligible to spread across window
				if (rng() < (n * 3) / eligible.length) {
					picked.push({ idx, side })
					if (side === 1) lastBuy = idx
					else lastSell = idx
				}
			}
		}
		const r = evalSignals(rows, tr55, picked)
		if (r.n > 0) means.push(r.meanR)
	}
	means.sort((a, b) => a - b)
	return {
		mean: means.reduce((a, b) => a + b, 0) / means.length,
		p5: means[Math.floor(means.length * 0.05)]!,
		p95: means[Math.floor(means.length * 0.95)]!,
	}
}

function loadDataset(path: string) {
	const rows = parseExactIndicatorCsv(readFileSync(path, 'utf8'), { allowInvalidBandOrder: true })
	const tr55 = trueRangeSma(rows, 55)
	const volSma = volumeSma(rows, 50)
	const arrows: Array<{ idx: number; side: CorrectedGgiSide }> = []
	for (let i = WARMUP; i < rows.length; i++) {
		if (rows[i]!.buy) arrows.push({ idx: i, side: 1 })
		else if (rows[i]!.sell) arrows.push({ idx: i, side: -1 })
	}
	return { rows, tr55, volSma, arrows }
}

async function main() {
	// Deferred decisive run (sur1-deferred-run-preregistration.md): volume
	// re-exports received; calibration back on BTC 2h per original prereg.
	// SUR1_MODE=deferred selects it; default remains the amendment-1 layout.
	const deferred = process.env.SUR1_MODE === 'deferred'
	const CALIB = deferred
		? 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv'
		: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv'
	const OOS = deferred
		? [
			{ id: 'xrp-3m', file: 'data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m_vol.csv' },
			{ id: 'ondo-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv' },
			{ id: 'ondo-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv' },
		]
		: [
			{ id: 'ondo-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv' },
			{ id: 'ondo-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv' },
		]
	const rng = mulberry32(SEED)

	// Phase 1: calibration
	const c = loadDataset(resolve(CALIB))
	if (!c.rows.some((r) => r.volume > 0)) throw new Error('calibration dataset has no volume data - aborting (SUR1 amendment 1)')
	const arrowsEval = evalSignals(c.rows, c.tr55, c.arrows)
	const nArrows = c.arrows.length
	const rules: Array<{ name: string; stretch: Stretch; k: number; n: number; meanR: number; wr: number; capture: number; qualified: boolean }> = []
	// one shared random benchmark sized at arrow count (re-scaled per rule via capture formula using rule-size random would be noisy; frozen: benchmark at each rule's own n)
	for (const stretch of STRETCHES) {
		for (const k of VOL_KS) {
			const sigs = surrogateSignals(c.rows, c.volSma, stretch, k)
			const ev = evalSignals(c.rows, c.tr55, sigs)
			const qualified = ev.n >= Math.ceil(0.4 * nArrows) && ev.n <= 3 * nArrows
			const rand = qualified ? randomBenchmark(c.rows, c.tr55, ev.n, rng) : { mean: NaN, p5: NaN, p95: NaN }
			const capture = qualified ? (ev.meanR - rand.mean) / (arrowsEval.meanR - rand.mean) : NaN
			rules.push({ name: `${stretch}/k${k}`, stretch, k, n: ev.n, meanR: ev.meanR, wr: ev.wr, capture, qualified })
			console.log(`[calib] ${stretch}/k${k}: n=${ev.n} meanR=${ev.meanR.toFixed(4)} WR=${(ev.wr * 100).toFixed(1)}% C=${qualified ? capture.toFixed(3) : 'DQ'} (rand ${rand.mean?.toFixed(4)})`)
		}
	}
	const qualifiedRules = rules.filter((r) => r.qualified && Number.isFinite(r.capture))
	const winner = qualifiedRules.slice().sort((a, b) => b.capture - a.capture)[0] ?? null
	const calibRandom = randomBenchmark(c.rows, c.tr55, nArrows, rng)

	// Phase 2: OOS - winner only
	const oosResults: Array<Record<string, unknown>> = []
	let pooledCapture = NaN
	if (winner && winner.capture >= 0.6) {
		const surR: number[] = []
		const arrR: number[] = []
		const rndR: number[] = []
		for (const ds of OOS) {
			const d = loadDataset(resolve(ds.file))
			const sigs = surrogateSignals(d.rows, d.volSma, winner.stretch, winner.k)
			const ev = evalSignals(d.rows, d.tr55, sigs)
			const arr = evalSignals(d.rows, d.tr55, d.arrows)
			const rand = randomBenchmark(d.rows, d.tr55, Math.max(ev.n, 10), rng)
			const cap = (ev.meanR - rand.mean) / (arr.meanR - rand.mean)
			oosResults.push({ id: ds.id, sha: sha256File(resolve(ds.file)), surrogate: ev, arrows: arr, random: rand, capture: cap })
			console.log(`[oos] ${ds.id}: sur n=${ev.n} meanR=${ev.meanR.toFixed(4)} | arrows n=${arr.n} meanR=${arr.meanR.toFixed(4)} | rand ${rand.mean.toFixed(4)} | C=${cap.toFixed(3)}`)
			surR.push(ev.meanR * ev.n)
			arrR.push(arr.meanR * arr.n)
			rndR.push(rand.mean * ev.n)
		}
		const totSurN = oosResults.reduce((a, r) => a + (r.surrogate as EvalResult).n, 0)
		const totArrN = oosResults.reduce((a, r) => a + (r.arrows as EvalResult).n, 0)
		const pooledSur = surR.reduce((a, b) => a + b, 0) / totSurN
		const pooledArr = arrR.reduce((a, b) => a + b, 0) / totArrN
		const pooledRnd = rndR.reduce((a, b) => a + b, 0) / totSurN
		pooledCapture = (pooledSur - pooledRnd) / (pooledArr - pooledRnd)
	}

	const verdict = winner == null
		? 'FAILURE (no rule met the frequency sanity gate)'
		: winner.capture < 0.6
			? `FAILURE (best calibration C=${winner.capture.toFixed(3)} < 0.6: hidden state carries the bulk of the arrows' value)`
			: pooledCapture >= 0.5
				? `SUCCESS (calib C=${winner.capture.toFixed(3)}, pooled OOS C=${pooledCapture.toFixed(3)})`
				: pooledCapture >= 0.2
					? `PARTIAL (calib C=${winner.capture.toFixed(3)}, pooled OOS C=${pooledCapture.toFixed(3)})`
					: `FAILURE (calib C=${winner.capture.toFixed(3)} but pooled OOS C=${pooledCapture.toFixed(3)} < 0.2)`

	const md: string[] = []
	md.push('# SUR1 surrogate signal results')
	md.push('')
	md.push('Pre-registration: `sur1-surrogate-signal-preregistration.md`. DM3 V2 exits everywhere; capture C = (sur - rand) / (arrows - rand).')
	md.push('')
	md.push(`## Calibration - ${deferred ? 'BTC.P 2h full20k (vol re-export)' : 'BTC.P 15m (amendment 1)'} (arrows: n=${arrowsEval.n}, meanR=${arrowsEval.meanR.toFixed(4)}, WR=${(arrowsEval.wr * 100).toFixed(1)}%; random @ arrow-n: ${calibRandom.mean.toFixed(4)} [${calibRandom.p5.toFixed(4)}..${calibRandom.p95.toFixed(4)}])`)
	md.push('')
	md.push('| rule | n | mean R | WR | capture C |')
	md.push('|---|---|---|---|---|')
	for (const r of rules) md.push(`| ${r.name} | ${r.n} | ${Number.isFinite(r.meanR) ? r.meanR.toFixed(4) : '-'} | ${Number.isFinite(r.wr) ? (r.wr * 100).toFixed(1) + '%' : '-'} | ${r.qualified ? r.capture.toFixed(3) : 'DQ (freq)'} |`)
	md.push('')
	md.push('## OOS (winner only)')
	md.push('')
	if (oosResults.length) {
		md.push('| dataset | sur n | sur mean R | sur WR | arrows n | arrows mean R | random | C |')
		md.push('|---|---|---|---|---|---|---|---|')
		for (const r of oosResults) {
			const s = r.surrogate as EvalResult
			const a = r.arrows as EvalResult
			const rd = r.random as { mean: number }
			md.push(`| ${r.id} | ${s.n} | ${s.meanR.toFixed(4)} | ${(s.wr * 100).toFixed(1)}% | ${a.n} | ${a.meanR.toFixed(4)} | ${rd.mean.toFixed(4)} | ${(r.capture as number).toFixed(3)} |`)
		}
		md.push('')
		md.push(`Pooled OOS capture: **${pooledCapture.toFixed(3)}**`)
	} else md.push('Not run (calibration failed).')
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	const outBase = deferred ? 'sur1-deferred-decisive' : 'sur1-surrogate-signal'
	writeFileSync(resolve(`ci-results/${outBase}.md`), md.join('\n'))
	writeFileSync(resolve(`ci-results/${outBase}.json`), JSON.stringify({
		shaCalib: sha256File(resolve(CALIB)),
		config: { cooldown: COOLDOWN, draws: RANDOM_DRAWS, seed: SEED },
		arrows: arrowsEval, calibRandom, rules, winner: winner?.name ?? null, oos: oosResults, pooledCapture, verdict,
	}, null, 2))
	console.log(`\nVERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
