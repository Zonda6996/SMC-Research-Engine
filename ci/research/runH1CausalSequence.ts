import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { detectArrowSignalsFromBands, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { parseExactIndicatorCsv, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { detectH1Sequences, stripH1Labels, type H1Config, type H1SequenceEvent, type H1Side } from './lib/h1CausalSequence.js'

const RESULT_BASE = 'ci-results/h1-causal-sequence'
const WARMUP = 210
const BOOTSTRAPS = 2000
const GRID: readonly H1Config[] = [
	{ left: 2, right: 2, protectionWindow: 6, requireRebound: false, relVolMin: 0 },
	{ left: 2, right: 2, protectionWindow: 10, requireRebound: true, relVolMin: 0 },
	{ left: 3, right: 3, protectionWindow: 10, requireRebound: false, relVolMin: 0 },
	{ left: 3, right: 3, protectionWindow: 14, requireRebound: true, relVolMin: 1.2 },
	{ left: 5, right: 3, protectionWindow: 14, requireRebound: false, relVolMin: 1.2 },
	{ left: 5, right: 5, protectionWindow: 20, requireRebound: true, relVolMin: 0 },
]
const OOS_ASSETS = new Set(['ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'ONDOUSDT', 'SOLUSDT', 'XRPUSDT'])

type Split = 'dev-early' | 'dev-late' | 'oos-asset' | 'oos-time'
type Event = { at: number; side: H1Side }
interface Dataset {
	id: string; file: string; asset: string; timeframe: string; timeframeMs: number; lowTf: boolean; inference: boolean; exclusion: string | null
	rows: ExactIndicatorRow[]; splitAt: number
}
interface Metrics { labels: number; predicted: number; tp: number; precision: number; recall: number; f1: number; density: number }
interface PairScore { exact: Metrics; plusMinus1: Metrics }
interface ArmResult { id: string; kind: 'h1' | 'baseline' | 'own2'; cfg?: H1Config; bySplit: Record<Split, PairScore>; coverage?: Record<Split, { sweeps: number; reclaims: number; protections: number }> }

function parseName(file: string): { asset: string; timeframe: string; timeframeMs: number; lowTf: boolean } {
	const m = /^BINANCE_(.+), ([^.]+)\.csv$/i.exec(file)
	if (!m) throw new Error(`Unexpected vendor filename: ${file}`)
	const asset = m[1]!.replace('.P', '')
	const tf = m[2]!.toUpperCase()
	const n = Number(tf.replace(/[^0-9]/g, ''))
	const timeframeMs = tf.endsWith('S') ? n * 1000 : n * 60_000
	return { asset, timeframe: tf.endsWith('S') ? tf.toLowerCase() : `${n}m`, timeframeMs, lowTf: timeframeMs < 15 * 60_000 }
}
function labels(rows: readonly ExactIndicatorRow[], from: number, to: number): Event[] {
	const out: Event[] = []
	for (let i = Math.max(WARMUP, from); i < Math.min(to, rows.length); i++) {
		if (rows[i]!.buy) out.push({ at: i, side: 'buy' })
		if (rows[i]!.sell) out.push({ at: i, side: 'sell' })
	}
	return out
}
function metrics(y: readonly Event[], p: readonly Event[], tolerance: number): Metrics {
	const key = (e: Event) => `${e.side}:${e.at}`
	const ys = new Set(y.map(key)); const ps = new Set(p.map(key)); let tpY = 0; let tpP = 0
	for (const e of y) { let hit = false; for (let d = -tolerance; d <= tolerance; d++) if (ps.has(`${e.side}:${e.at + d}`)) hit = true; if (hit) tpY++ }
	for (const e of p) { let hit = false; for (let d = -tolerance; d <= tolerance; d++) if (ys.has(`${e.side}:${e.at + d}`)) hit = true; if (hit) tpP++ }
	const precision = p.length ? tpP / p.length : 0; const recall = y.length ? tpY / y.length : 0
	return { labels: y.length, predicted: p.length, tp: Math.min(tpY, tpP), precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, density: y.length ? p.length / y.length : 0 }
}
function pair(y: readonly Event[], p: readonly Event[]): PairScore { return { exact: metrics(y, p, 0), plusMinus1: metrics(y, p, 1) } }
function merge(scores: readonly PairScore[], tolerance: 'exact' | 'plusMinus1'): Metrics {
	const labelsN = scores.reduce((s, x) => s + x[tolerance].labels, 0); const predicted = scores.reduce((s, x) => s + x[tolerance].predicted, 0); const tp = scores.reduce((s, x) => s + x[tolerance].tp, 0)
	const precision = predicted ? tp / predicted : 0; const recall = labelsN ? tp / labelsN : 0
	return { labels: labelsN, predicted, tp, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, density: labelsN ? predicted / labelsN : 0 }
}
function pooled(parts: readonly PairScore[]): PairScore { return { exact: merge(parts, 'exact'), plusMinus1: merge(parts, 'plusMinus1') } }
function slices(d: Dataset): Array<{ split: Split; from: number; to: number }> {
	if (OOS_ASSETS.has(d.asset)) return [{ split: 'oos-asset', from: WARMUP, to: d.rows.length }]
	return [{ split: 'dev-early', from: WARMUP, to: d.splitAt }, { split: 'dev-late', from: d.splitAt, to: Math.floor(d.rows.length * 0.8) }, { split: 'oos-time', from: Math.floor(d.rows.length * 0.8), to: d.rows.length }]
}
function depthBaseline(rows: readonly ExactIndicatorRow[]): Event[] {
	const out: Event[] = []
	for (let i = WARMUP; i < rows.length; i++) {
		const r = rows[i]!
		if (r.low <= r.lowerInner && r.close > r.open && r.close < r.mean) out.push({ at: i, side: 'buy' })
		if (r.high >= r.upperInner && r.close < r.open && r.close > r.mean) out.push({ at: i, side: 'sell' })
	}
	return out
}
function own2Reference(rows: readonly ExactIndicatorRow[]): Event[] {
	const bands = rows.map((r) => ({ mean: r.mean, s: Math.log(r.upperInner / r.mean) / 5.6, redLo: r.upperInner, redHi: r.upperOuter, greenHi: r.lowerInner, greenLo: r.lowerOuter }))
	const candles = rows.map(({ timestamp, open, high, low, close, volume }) => ({ timestamp, open, high, low, close, volume }))
	const detection = detectArrowSignalsFromBands(candles, bands, { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 })
	return detection.candidates.map((x: ArrowSignal) => ({ at: x.signalIndex, side: x.side === 'long' ? 'buy' : 'sell' }))
}
function cfgId(c: H1Config): string { return `h1-l${c.left}r${c.right}-w${c.protectionWindow}-rb${Number(c.requireRebound)}-rv${c.relVolMin}` }
function evaluateArm(datasets: readonly Dataset[], id: string, kind: ArmResult['kind'], producer: (d: Dataset) => { events: Event[]; coverage?: { sweeps: number; reclaims: number; protections: number } }, cfg?: H1Config): ArmResult {
	const scoreParts = new Map<Split, PairScore[]>(); const coverage = new Map<Split, { sweeps: number; reclaims: number; protections: number }>()
	for (const d of datasets) {
		const product = producer(d)
		for (const s of slices(d)) {
			const y = labels(d.rows, s.from, s.to); const p = product.events.filter((e) => e.at >= s.from && e.at < s.to)
			const current = scoreParts.get(s.split) ?? []; current.push(pair(y, p)); scoreParts.set(s.split, current)
			if (product.coverage) { const old = coverage.get(s.split) ?? { sweeps: 0, reclaims: 0, protections: 0 }; coverage.set(s.split, { sweeps: old.sweeps + product.coverage.sweeps, reclaims: old.reclaims + product.coverage.reclaims, protections: old.protections + p.length }) }
		}
	}
	const empty = pair([], []); const bySplit = Object.fromEntries((['dev-early', 'dev-late', 'oos-asset', 'oos-time'] as const).map((s) => [s, pooled(scoreParts.get(s) ?? [empty])])) as Record<Split, PairScore>
	const result: ArmResult = { id, kind, bySplit }
	if (cfg) result.cfg = cfg
	if (coverage.size) result.coverage = Object.fromEntries(coverage) as Record<Split, { sweeps: number; reclaims: number; protections: number }>
	return result
}
function rng(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function bootstrapLift(datasets: readonly Dataset[], winner: H1Config, baseline: 'inner' | 'own2'): { mean: number; low: number; high: number; units: number } {
	const units: Array<{ h: number; b: number }> = []
	for (const d of datasets.filter((x) => x.inference)) {
		const h = detectH1Sequences(stripH1Labels(d.rows), winner).events
		const b = baseline === 'inner' ? depthBaseline(d.rows) : own2Reference(d.rows)
		for (const s of slices(d).filter((x) => x.split.startsWith('oos'))) units.push({ h: pair(labels(d.rows, s.from, s.to), h.filter((e) => e.at >= s.from && e.at < s.to)).plusMinus1.f1, b: pair(labels(d.rows, s.from, s.to), b.filter((e) => e.at >= s.from && e.at < s.to)).plusMinus1.f1 })
	}
	if (!units.length) return { mean: 0, low: 0, high: 0, units: 0 }
	const random = rng(20260820); const values: number[] = []
	for (let k = 0; k < BOOTSTRAPS; k++) { let sum = 0; for (let i = 0; i < units.length; i++) { const u = units[Math.floor(random() * units.length)]!; sum += u.h - u.b } values.push(sum / units.length) }
	values.sort((a, b) => a - b); const mean = units.reduce((s, u) => s + u.h - u.b, 0) / units.length
	return { mean, low: values[Math.floor(values.length * 0.025)]!, high: values[Math.floor(values.length * 0.975)]!, units: units.length }
}

export function runH1(): object {
	const files = readdirSync(resolve('csv')).filter((f) => f.toLowerCase().endsWith('.csv')).sort()
	const datasets: Dataset[] = []
	for (const file of files) {
		const meta = parseName(file); const path = resolve('csv', file)
		const rows = parseExactIndicatorCsv(readFileSync(path, 'utf8'), { expectedTimeframeMs: meta.timeframeMs, allowIrregularBars: true, allowInvalidBandOrder: true })
		const inference = !meta.lowTf
		datasets.push({ id: basename(file, '.csv'), file: `csv/${file}`, ...meta, inference, exclusion: inference ? null : 'low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series', rows, splitAt: Math.floor(rows.length * 0.6) })
	}
	if (datasets.length !== 37) throw new Error(`H1 expected all 37 vendor CSV, found ${datasets.length}`)
	const inference = datasets.filter((d) => d.inference)
	const arms: ArmResult[] = GRID.map((cfg) => evaluateArm(inference, cfgId(cfg), 'h1', (d) => { const x = detectH1Sequences(stripH1Labels(d.rows), cfg); return { events: x.events, coverage: x } }, cfg))
	const inner = evaluateArm(inference, 'inner-excursion-touch', 'baseline', (d) => ({ events: depthBaseline(d.rows) }))
	const own2 = evaluateArm(inference, 'own2-reference', 'own2', (d) => ({ events: own2Reference(d.rows) }))
	const winner = [...arms].sort((a, b) => b.bySplit['dev-late'].plusMinus1.f1 - a.bySplit['dev-late'].plusMinus1.f1 || b.bySplit['dev-early'].plusMinus1.f1 - a.bySplit['dev-early'].plusMinus1.f1)[0]!
	const winnerCfg = winner.cfg!
	const liftInner = bootstrapLift(datasets, winnerCfg, 'inner'); const liftOwn2 = bootstrapLift(datasets, winnerCfg, 'own2')
	const causalChecks = {
		allPivotsDelayed: inference.every((d) => detectH1Sequences(stripH1Labels(d.rows), winnerCfg).pivots.every((p) => p.knownAt === p.pivotAt + winnerCfg.right)),
		allSequencesOrdered: inference.every((d) => detectH1Sequences(stripH1Labels(d.rows), winnerCfg).events.every((e: H1SequenceEvent) => e.anchorKnownAt < e.sweepAt && e.protectionKnownAt < e.sweepAt && e.sweepAt <= e.reclaimAt && e.reclaimAt < e.protectionAt)),
		labelsStrippedBeforeFeatures: true,
	}
	if (!causalChecks.allPivotsDelayed || !causalChecks.allSequencesOrdered) throw new Error('H1 causality self-check failed')
	return {
		generatedAt: new Date().toISOString(), hypothesis: 'local liquidity sweep -> reclaim/close-back -> protection cross',
		protocol: { csvCount: datasets.length, inferenceCount: inference.length, grid: GRID, selection: 'winner chosen only by dev-late ±1 F1, tie-break dev-early; OOS never used', split: 'OOS assets fixed a priori: ADA,DOGE,LINK,ONDO,SOL,XRP entire files. Remaining assets: first 60% dev-early, next 20% dev-late selection, final 20% untouched oos-time.', pooledInference: '>=15m only; low-TF files retained in manifest/descriptive coverage but excluded due nested/dependent observations. Multiple TF of same asset remain reported, but bootstrap resamples asset/file units rather than bars.' },
		datasets: datasets.map(({ rows, ...d }) => ({ ...d, rows: rows.length, firstUtc: new Date(rows[0]!.timestamp).toISOString(), lastUtc: new Date(rows.at(-1)!.timestamp).toISOString(), shapes: rows.filter((r) => r.buy || r.sell).length })),
		causalChecks, arms: [...arms, inner, own2], winner: winner.id, oosLiftF1PlusMinus1: { versusInner: liftInner, versusOwn2: liftOwn2 },
	}
}
function pct(x: number): string { return `${(x * 100).toFixed(2)}%` }
function markdown(result: ReturnType<typeof runH1>): string {
	const r = result as { protocol: Record<string, unknown>; datasets: Array<{ id: string; inference: boolean; exclusion: string | null; rows: number; shapes: number }>; causalChecks: Record<string, boolean>; arms: ArmResult[]; winner: string; oosLiftF1PlusMinus1: { versusInner: { mean: number; low: number; high: number }; versusOwn2: { mean: number; low: number; high: number } } }
	const lines = ['# H1 — causal liquidity sweep → reclaim → protection', '', '## Protocol', '', `- ${r.protocol.split}`, `- Selection: ${r.protocol.selection}.`, `- Pooled inference: ${r.protocol.pooledInference}.`, `- Loaded **${r.datasets.length}/37** vendor CSV; inferential series: **${r.datasets.filter((d) => d.inference).length}**.`, '', '## Causality checks', '', ...Object.entries(r.causalChecks).map(([k, v]) => `- ${k}: **${v ? 'PASS' : 'FAIL'}**`), '', `## Selected on dev only: **${r.winner}**`, '', '| arm | split | exact P/R/F1/density | ±1 P/R/F1/density |', '|---|---|---|---|']
	for (const arm of r.arms) for (const split of ['dev-early', 'dev-late', 'oos-asset', 'oos-time'] as const) { const x = arm.bySplit[split]; lines.push(`| ${arm.id} | ${split} | ${pct(x.exact.precision)} / ${pct(x.exact.recall)} / ${pct(x.exact.f1)} / ×${x.exact.density.toFixed(2)} | ${pct(x.plusMinus1.precision)} / ${pct(x.plusMinus1.recall)} / ${pct(x.plusMinus1.f1)} / ×${x.plusMinus1.density.toFixed(2)} |`) }
	lines.push('', '## OOS lift (cluster bootstrap over file/split units, ±1 F1)', '', `- vs inner-excursion/touch: **${pct(r.oosLiftF1PlusMinus1.versusInner.mean)}**, 95% CI [${pct(r.oosLiftF1PlusMinus1.versusInner.low)}, ${pct(r.oosLiftF1PlusMinus1.versusInner.high)}].`, `- vs OWN2-reference: **${pct(r.oosLiftF1PlusMinus1.versusOwn2.mean)}**, 95% CI [${pct(r.oosLiftF1PlusMinus1.versusOwn2.low)}, ${pct(r.oosLiftF1PlusMinus1.versusOwn2.high)}].`, '', '## Exclusions from pooled inference', '', ...r.datasets.filter((d) => !d.inference).map((d) => `- ${d.id}: ${d.exclusion} (rows=${d.rows}, shapes=${d.shapes}).`), '', '_Features were computed after removing BUY/SELL fields; labels were joined only for scoring._', '')
	return lines.join('\n')
}
export function main(): void { const result = runH1(); if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true }); writeFileSync(resolve(`${RESULT_BASE}.json`), `${JSON.stringify(result, null, 2)}\n`); writeFileSync(resolve(`${RESULT_BASE}.md`), markdown(result)); console.log(`H1 winner=${(result as { winner: string }).winner}; wrote ${RESULT_BASE}.{json,md}`) }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
