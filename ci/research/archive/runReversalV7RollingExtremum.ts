/**
 * V7' episode-gated rolling-extremum detector.
 * Spec frozen in ci-results/reversal-v7prime-preregistration.md (committed before any run).
 * Modes:
 *   search : 18-config grid on dev rows [0, 0.75n) only, evaluated on fit + validation slices.
 *   final W MINAGE THRESHOLD : single frozen run on dev sealed slices + all holdouts.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chronologicalSlices, developmentDatasets, futuresHoldouts, loadReversalDatasets, spotHoldouts } from '../config/reversalDatasets.js'
import { exactEvents, type ExactDirection, type ExactIndicatorRow } from '../lib/exactIndicatorExport.js'
import { matchDirectionalEvents, type TimedDirectionalEvent } from '../lib/eventMetrics.js'

const EPISODE_CAP_BARS = 256

export interface V7Config {
	windowBars: number
	minAgeBars: number
	recoveryThreshold: number
}

export function detectV7(rows: ExactIndicatorRow[], cfg: V7Config): TimedDirectionalEvent[] {
	const out: TimedDirectionalEvent[] = []
	for (const direction of ['long', 'short'] as const) {
		const recovery = new Array<number>(rows.length).fill(-Infinity)
		let episodeStart = -1
		let extreme = NaN
		let lastEmit = -Infinity
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i]!
			const breach = direction === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
			if (episodeStart < 0 && breach) {
				episodeStart = i
				extreme = direction === 'long' ? row.low : row.high
			}
			if (episodeStart >= 0) {
				extreme = direction === 'long' ? Math.min(extreme, row.low) : Math.max(extreme, row.high)
				const halfWidth = direction === 'long' ? row.mean - row.lowerInner : row.upperInner - row.mean
				recovery[i] = halfWidth > 0 ? (direction === 'long' ? (row.close - extreme) / halfWidth : (extreme - row.close) / halfWidth) : -Infinity
				const age = i - episodeStart
				if (age >= cfg.minAgeBars && recovery[i]! >= cfg.recoveryThreshold && i - lastEmit >= cfg.windowBars) {
					let priorMax = -Infinity
					for (let k = Math.max(0, i - cfg.windowBars + 1); k < i; k++) priorMax = Math.max(priorMax, recovery[k]!)
					if (recovery[i]! > priorMax) {
						out.push({ at: row.timestamp, direction })
						lastEmit = i
					}
				}
				const neutralClose = direction === 'long' ? row.close >= row.mean : row.close <= row.mean
				if (neutralClose || age >= EPISODE_CAP_BARS) {
					episodeStart = -1
					extreme = NaN
				}
			}
		}
	}
	return out.sort((a, b) => a.at - b.at)
}

function evaluateSlice(rows: ExactIndicatorRow[], predictions: TimedDirectionalEvent[], fromIndex: number, toIndexExclusive: number, timeframeMs: number, toleranceBars: number) {
	const fromTs = rows[fromIndex]!.timestamp
	const toTs = rows[toIndexExclusive - 1]!.timestamp
	const truth = exactEvents(rows.slice(fromIndex, toIndexExclusive))
	const preds = predictions.filter((p) => p.at >= fromTs && p.at <= toTs)
	return matchDirectionalEvents(truth, preds, timeframeMs, toleranceBars)
}

const datasets = loadReversalDatasets()
const dev = developmentDatasets(datasets)
const mode = process.argv[2]

if (mode === 'search') {
	const grid: V7Config[] = []
	for (const windowBars of [48, 54, 60]) for (const minAgeBars of [8, 16, 24]) for (const recoveryThreshold of [0.25, 0.5]) grid.push({ windowBars, minAgeBars, recoveryThreshold })
	const rowsOut: string[] = []
	const results: Array<{ cfg: V7Config; meanValidationF1: number; meanValidationPrecision: number; detail: Record<string, unknown> }> = []
	for (const cfg of grid) {
		const detail: Record<string, unknown> = {}
		let f1Sum = 0
		let precSum = 0
		for (const dataset of dev) {
			const slices = chronologicalSlices(dataset)
			const validationEnd = slices.find((s) => s.kind === 'validation')!.toIndexExclusive
			const visible = dataset.rows.slice(0, validationEnd)
			const preds = detectV7(visible, cfg)
			const fit = slices.find((s) => s.kind === 'fit')!
			const val = slices.find((s) => s.kind === 'validation')!
			const fitM = evaluateSlice(visible, preds, fit.fromIndex, fit.toIndexExclusive, dataset.meta.timeframeMs, 0)
			const valM = evaluateSlice(visible, preds, val.fromIndex, val.toIndexExclusive, dataset.meta.timeframeMs, 0)
			detail[dataset.meta.id] = { fit: { p: fitM.precision, r: fitM.recall, f1: fitM.f1, preds: fitM.predictions, truth: fitM.truth }, validation: { p: valM.precision, r: valM.recall, f1: valM.f1, preds: valM.predictions, truth: valM.truth } }
			f1Sum += valM.f1
			precSum += valM.precision
		}
		results.push({ cfg, meanValidationF1: f1Sum / dev.length, meanValidationPrecision: precSum / dev.length, detail })
	}
	results.sort((a, b) => b.meanValidationF1 - a.meanValidationF1 || b.meanValidationPrecision - a.meanValidationPrecision || a.cfg.windowBars - b.cfg.windowBars)
	for (const r of results) {
		rowsOut.push(`| ${r.cfg.windowBars} | ${r.cfg.minAgeBars} | ${r.cfg.recoveryThreshold} | ${(100 * r.meanValidationF1).toFixed(2)} | ${(100 * r.meanValidationPrecision).toFixed(2)} |`)
	}
	const winner = results[0]!
	const md = `# V7' grid search (fit+validation only, sealed untouched)\n\n18 configurations, exact matching (tolerance 0). Selection: highest mean validation F1, tie-break precision then smaller W.\n\n| W | minAge | threshold | mean val F1 % | mean val precision % |\n|---|---|---|---|---|\n${rowsOut.join('\n')}\n\n## Winner (mechanical)\n\nW=${winner.cfg.windowBars}, minAge=${winner.cfg.minAgeBars}, threshold=${winner.cfg.recoveryThreshold}\n\nPer-dataset detail:\n\n\`\`\`json\n${JSON.stringify(winner.detail, null, 2)}\n\`\`\`\n`
	writeFileSync(resolve('ci-results/reversal-v7prime-grid-search.md'), md)
	writeFileSync(resolve('ci-results/reversal-v7prime-grid-search.json'), JSON.stringify(results, null, 2))
	console.log(md)
} else if (mode === 'final') {
	const cfg: V7Config = { windowBars: Number(process.argv[3]), minAgeBars: Number(process.argv[4]), recoveryThreshold: Number(process.argv[5]) }
	if (!Number.isFinite(cfg.windowBars) || !Number.isFinite(cfg.minAgeBars) || !Number.isFinite(cfg.recoveryThreshold)) throw new Error('final mode requires W MINAGE THRESHOLD')
	const lines: string[] = [`# V7' final frozen run\n`, `Config: W=${cfg.windowBars}, minAge=${cfg.minAgeBars}, threshold=${cfg.recoveryThreshold}. Single execution per pre-registration.\n`]
	const summary: Record<string, unknown> = { cfg }
	let anyFail = false
	lines.push('## Development sealed slices\n')
	for (const dataset of dev) {
		const preds = detectV7(dataset.rows, cfg)
		const sealed = chronologicalSlices(dataset).find((s) => s.kind === 'sealed-test')!
		const val = chronologicalSlices(dataset).find((s) => s.kind === 'validation')!
		const sealedM = evaluateSlice(dataset.rows, preds, sealed.fromIndex, sealed.toIndexExclusive, dataset.meta.timeframeMs, 0)
		const valM = evaluateSlice(dataset.rows, preds, val.fromIndex, val.toIndexExclusive, dataset.meta.timeframeMs, 0)
		const collapse = valM.f1 > 0 ? sealedM.f1 / valM.f1 : 0
		const failed = collapse < 0.5
		anyFail ||= failed
		summary[dataset.meta.id] = { sealed: sealedM, validationRef: { f1: valM.f1 }, collapseRatio: collapse, failed }
		lines.push(`### ${dataset.meta.id}\n\n- sealed: precision ${(100 * sealedM.precision).toFixed(2)}%, recall ${(100 * sealedM.recall).toFixed(2)}%, F1 ${(100 * sealedM.f1).toFixed(2)}% (preds ${sealedM.predictions}, truth ${sealedM.truth})\n- validation reference F1 ${(100 * valM.f1).toFixed(2)}%; sealed/validation ratio ${(100 * collapse).toFixed(1)}% -> ${failed ? 'FAIL (collapse > 50%)' : 'pass'}\n`)
	}
	lines.push('## Futures holdouts (gated)\n')
	for (const dataset of futuresHoldouts(datasets)) {
		const preds = detectV7(dataset.rows, cfg)
		const m = evaluateSlice(dataset.rows, preds, 0, dataset.rows.length, dataset.meta.timeframeMs, 0)
		const m2 = evaluateSlice(dataset.rows, preds, 0, dataset.rows.length, dataset.meta.timeframeMs, 2)
		const ratio = m.truth > 0 ? m.predictions / m.truth : 0
		const pass = m.precision >= 0.15 && m.recall >= 0.4 && ratio >= 0.5 && ratio <= 2.0
		anyFail ||= !pass
		summary[dataset.meta.id] = { exact: m, tol2: { p: m2.precision, r: m2.recall, f1: m2.f1 }, countRatio: ratio, pass }
		lines.push(`### ${dataset.meta.id}\n\n- exact: precision ${(100 * m.precision).toFixed(2)}%, recall ${(100 * m.recall).toFixed(2)}%, F1 ${(100 * m.f1).toFixed(2)}% (preds ${m.predictions}, truth ${m.truth}, ratio ${ratio.toFixed(2)})\n- tolerance-2 diagnostic: precision ${(100 * m2.precision).toFixed(2)}%, recall ${(100 * m2.recall).toFixed(2)}%\n- gate: ${pass ? 'PASS' : 'FAIL'}\n`)
	}
	lines.push('## Spot holdout (reported, not gated)\n')
	for (const dataset of spotHoldouts(datasets)) {
		const preds = detectV7(dataset.rows, cfg)
		const m = evaluateSlice(dataset.rows, preds, 0, dataset.rows.length, dataset.meta.timeframeMs, 0)
		summary[dataset.meta.id] = { exact: m }
		lines.push(`### ${dataset.meta.id}\n\n- exact: precision ${(100 * m.precision).toFixed(2)}%, recall ${(100 * m.recall).toFixed(2)}%, F1 ${(100 * m.f1).toFixed(2)}% (preds ${m.predictions}, truth ${m.truth})\n`)
	}
	lines.push(`## Verdict\n\n**${anyFail ? 'FAIL' : 'PASS'}** under pre-registered criteria.\n`)
	writeFileSync(resolve('ci-results/reversal-v7prime-final.md'), lines.join('\n'))
	writeFileSync(resolve('ci-results/reversal-v7prime-final.json'), JSON.stringify(summary, null, 2))
	console.log(lines.join('\n'))
} else {
	throw new Error('Usage: tsx runReversalV7RollingExtremum.ts search | final W MINAGE THRESHOLD')
}
