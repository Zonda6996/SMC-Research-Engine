/**
 * OWN1: our own reversal signal generator, built from SIG1 anatomy and frozen
 * in ci-results/own1-generator-preregistration.md (committed first).
 *
 * 6 rules (2 body-k x 3 drought-M), DM3 V2 exits, arrows + seeded random
 * benchmarks, train/test time split on BTC 2h + 4-dataset OOS.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import { replayDm3Trade, WARMUP } from './runDm3StaticExit.js'
import { mulberry32 } from './runSur1SurrogateSignal.js'

export const COOLDOWN = 40
export const BODY_KS = [1.5, 2.0] as const
export const DROUGHT_MS = [10, 20, 30] as const

export function bodySma20(rows: readonly ExactIndicatorRow[]): Array<number | null> {
	const out: Array<number | null> = new Array(rows.length).fill(null)
	let s = 0
	for (let i = 0; i < rows.length; i++) {
		s += Math.abs(rows[i]!.close - rows[i]!.open)
		if (i >= 20) s -= Math.abs(rows[i - 20]!.close - rows[i - 20]!.open)
		if (i >= 19) out[i] = s / 20
	}
	return out
}

/** OWN1 signals for one rule within [from, to). Frozen semantics per prereg. */
export function own1Signals(
	rows: readonly ExactIndicatorRow[],
	bSma: readonly (number | null)[],
	bodyK: number,
	droughtM: number,
	from: number,
	to: number,
): Array<{ idx: number; side: CorrectedGgiSide }> {
	const out: Array<{ idx: number; side: CorrectedGgiSide }> = []
	let lastMeanTouch = -1e9
	let lastBuy = -1e9
	let lastSell = -1e9
	for (let i = 0; i < to; i++) {
		const r = rows[i]!
		if (!validGgiBand(r)) continue
		const touchesMean = r.low <= r.mean && r.mean <= r.high
		if (i >= Math.max(WARMUP, from)) {
			const b = bSma[i]
			const body = Math.abs(r.close - r.open)
			const drought = i - lastMeanTouch >= droughtM
			if (b != null && b > 0 && body >= bodyK * b && drought) {
				if (r.close < r.mean && r.close > r.open && i - lastBuy > COOLDOWN) {
					out.push({ idx: i, side: 1 })
					lastBuy = i
				} else if (r.close > r.mean && r.close < r.open && i - lastSell > COOLDOWN) {
					out.push({ idx: i, side: -1 })
					lastSell = i
				}
			}
		}
		if (touchesMean) lastMeanTouch = i
	}
	return out
}

interface EvalResult { n: number; meanR: number; wr: number; partial: number; stop: number; full: number }

export function evalOwn1(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], signals: ReadonlyArray<{ idx: number; side: CorrectedGgiSide }>): EvalResult {
	const rs: number[] = []
	let wins = 0
	let partial = 0
	let stop = 0
	let full = 0
	for (const s of signals) {
		const t = replayDm3Trade(rows, tr55, s.idx, s.side, 'V2_movP_staticTPwick')
		if (t && t.outcome !== 'End mark') {
			rs.push(t.grossR)
			if (t.outcome !== 'Stop') wins++
			if (t.outcome === 'Partial') partial++
			else if (t.outcome === 'Stop') stop++
			else full++
		}
	}
	return { n: rs.length, meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN, wr: rs.length ? wins / rs.length : NaN, partial, stop, full }
}

function randomBench(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], n: number, from: number, to: number, rng: () => number): number {
	const eligible: number[] = []
	for (let i = Math.max(WARMUP, from); i < Math.min(to, rows.length - 1); i++) if (validGgiBand(rows[i]!) && tr55[i] != null) eligible.push(i)
	const means: number[] = []
	for (let d = 0; d < 200; d++) {
		const picked: Array<{ idx: number; side: CorrectedGgiSide }> = []
		let lastBuy = -1e9
		let lastSell = -1e9
		for (const idx of eligible) {
			if (picked.length >= n) break
			if (rng() < (n * 3) / eligible.length) {
				const side: CorrectedGgiSide = rng() < 0.5 ? 1 : -1
				if (side === 1 ? idx - lastBuy > COOLDOWN : idx - lastSell > COOLDOWN) {
					picked.push({ idx, side })
					if (side === 1) lastBuy = idx
					else lastSell = idx
				}
			}
		}
		const r = evalOwn1(rows, tr55, picked)
		if (r.n > 0) means.push(r.meanR)
	}
	return means.reduce((a, b) => a + b, 0) / means.length
}

function loadDataset(path: string) {
	const rows = parseExactIndicatorCsv(readFileSync(path, 'utf8'), { allowInvalidBandOrder: true })
	return { rows, tr55: trueRangeSma(rows, 55), bSma: bodySma20(rows) }
}

function arrowsIn(rows: readonly ExactIndicatorRow[], from: number, to: number): Array<{ idx: number; side: CorrectedGgiSide }> {
	const out: Array<{ idx: number; side: CorrectedGgiSide }> = []
	for (let i = Math.max(WARMUP, from); i < to; i++) {
		if (rows[i]!.buy) out.push({ idx: i, side: 1 })
		else if (rows[i]!.sell) out.push({ idx: i, side: -1 })
	}
	return out
}

async function main() {
	const TRAIN_FILE = 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv'
	const OOS = [
		{ id: 'xrp-3m', file: 'data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m_vol.csv' },
		{ id: 'ondo-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv' },
		{ id: 'ondo-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv' },
		{ id: 'btc-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv' },
	]
	const rng = mulberry32(1337)
	const d = loadDataset(resolve(TRAIN_FILE))
	const split = Math.floor(d.rows.length * 0.7)

	// Phase 1: train
	const rules: Array<{ name: string; bk: number; m: number; train: EvalResult; qualified: boolean }> = []
	for (const bk of BODY_KS) {
		for (const m of DROUGHT_MS) {
			const sigs = own1Signals(d.rows, d.bSma, bk, m, 0, split)
			const ev = evalOwn1(d.rows, d.tr55, sigs)
			const qualified = ev.n >= 30 && ev.n <= 400
			rules.push({ name: `bk${bk}/M${m}`, bk, m, train: ev, qualified })
			console.log(`[train] bk${bk}/M${m}: n=${ev.n} meanR=${ev.meanR.toFixed(4)} WR=${(ev.wr * 100).toFixed(1)}% P/S/F=${ev.partial}/${ev.stop}/${ev.full}${qualified ? '' : ' DQ'}`)
		}
	}
	const winner = rules.filter((r) => r.qualified && Number.isFinite(r.train.meanR)).sort((a, b) => b.train.meanR - a.train.meanR)[0] ?? null
	if (!winner) throw new Error('no qualified rule')
	const trainArrows = evalOwn1(d.rows, d.tr55, arrowsIn(d.rows, 0, split))
	const trainRandom = randomBench(d.rows, d.tr55, winner.train.n, 0, split, rng)

	// Phase 2: test (last 30%, same asset, time-forward)
	const testSigs = own1Signals(d.rows, d.bSma, winner.bk, winner.m, split, d.rows.length)
	const test = evalOwn1(d.rows, d.tr55, testSigs)
	const testArrows = evalOwn1(d.rows, d.tr55, arrowsIn(d.rows, split, d.rows.length))
	const testRandom = randomBench(d.rows, d.tr55, Math.max(test.n, 10), split, d.rows.length, rng)

	// Phase 3: OOS
	const oos: Array<{ id: string; own: EvalResult; arrows: EvalResult; random: number }> = []
	for (const ds of OOS) {
		const dd = loadDataset(resolve(ds.file))
		const sigs = own1Signals(dd.rows, dd.bSma, winner.bk, winner.m, 0, dd.rows.length)
		const own = evalOwn1(dd.rows, dd.tr55, sigs)
		const arr = evalOwn1(dd.rows, dd.tr55, arrowsIn(dd.rows, 0, dd.rows.length))
		const rand = randomBench(dd.rows, dd.tr55, Math.max(own.n, 10), 0, dd.rows.length, rng)
		oos.push({ id: ds.id, own, arrows: arr, random: rand })
		console.log(`[oos] ${ds.id}: own n=${own.n} meanR=${own.meanR.toFixed(4)} WR=${(own.wr * 100).toFixed(1)}% | arrows ${arr.meanR.toFixed(4)} | rand ${rand.toFixed(4)}`)
	}
	const pooledN = oos.reduce((a, r) => a + r.own.n, 0)
	const pooledOos = oos.reduce((a, r) => a + r.own.meanR * r.own.n, 0) / pooledN

	const verdict = test.meanR <= 0
		? `FAILURE (test meanR=${test.meanR.toFixed(4)} <= 0)`
		: test.meanR >= 0.05 && pooledOos >= 0.03 && test.wr >= 0.75
			? `SUCCESS (test meanR=${test.meanR.toFixed(4)}, WR=${(test.wr * 100).toFixed(1)}%, pooled OOS=${pooledOos.toFixed(4)})`
			: `PARTIAL (test meanR=${test.meanR.toFixed(4)}, WR=${(test.wr * 100).toFixed(1)}%, pooled OOS=${pooledOos.toFixed(4)})`

	const fmtEval = (e: EvalResult) => `n=${e.n}, meanR=${Number.isFinite(e.meanR) ? e.meanR.toFixed(4) : '-'}, WR=${Number.isFinite(e.wr) ? (e.wr * 100).toFixed(1) + '%' : '-'}, P/S/F=${e.partial}/${e.stop}/${e.full}`
	const md: string[] = []
	md.push('# OWN1 - our own reversal generator: results')
	md.push('')
	md.push('Pre-registration: `own1-generator-preregistration.md`. DM3 V2 exits everywhere.')
	md.push('')
	md.push('## Train (BTC.P 2h, first 70%)')
	md.push('')
	md.push('| rule | n | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|')
	for (const r of rules) md.push(`| ${r.name}${r.qualified ? '' : ' (DQ)'} | ${r.train.n} | ${Number.isFinite(r.train.meanR) ? r.train.meanR.toFixed(4) : '-'} | ${Number.isFinite(r.train.wr) ? (r.train.wr * 100).toFixed(1) + '%' : '-'} | ${r.train.partial}/${r.train.stop}/${r.train.full} |`)
	md.push('')
	md.push(`Winner: **${winner.name}**. Benchmarks on train window: arrows ${fmtEval(trainArrows)}; random meanR ${trainRandom.toFixed(4)}.`)
	md.push('')
	md.push('## Test (BTC.P 2h, last 30%, time-forward)')
	md.push('')
	md.push(`- OWN1 winner: ${fmtEval(test)}`)
	md.push(`- Arrows same window: ${fmtEval(testArrows)}`)
	md.push(`- Random same window: meanR ${testRandom.toFixed(4)}`)
	md.push('')
	md.push('## OOS (winner only)')
	md.push('')
	md.push('| dataset | OWN1 | arrows meanR | random meanR |')
	md.push('|---|---|---|---|')
	for (const r of oos) md.push(`| ${r.id} | ${fmtEval(r.own)} | ${Number.isFinite(r.arrows.meanR) ? r.arrows.meanR.toFixed(4) : '-'} | ${r.random.toFixed(4)} |`)
	md.push('')
	md.push(`Pooled OOS meanR: **${pooledOos.toFixed(4)}** (n=${pooledN})`)
	md.push('')
	md.push('## Pre-registered verdict')
	md.push('')
	md.push(`**${verdict}**`)
	writeFileSync(resolve('ci-results/own1-generator.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/own1-generator.json'), JSON.stringify({
		sha: sha256File(resolve(TRAIN_FILE)), split, rules, winner: winner.name,
		trainArrows, trainRandom, test, testArrows, testRandom, oos, pooledOos, verdict,
	}, null, 2))
	console.log(`\nwinner=${winner.name}\nVERDICT: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
