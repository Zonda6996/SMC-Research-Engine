import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { INDEPENDENT_REVERSAL_G2_PROTOCOL, type IndependentReversalG2Variant } from '../../src/core/signals/IndependentReversalG2Protocol.js'

interface Summary { trades: number; meanNetR: number | null; profitFactor: number | null }
interface MonthlyCell { symbol: string; variant: IndependentReversalG2Variant; months: Array<{ month: string; summary: Summary }> }
interface Input {
	protocolHash: string
	selectedVariant: IndependentReversalG2Variant
	verdict: string
	transfer: { cells: MonthlyCell[] }
}

export interface WalkForwardFold {
	fold: number
	months: string[]
	trades: number
	meanNetR: number | null
	positiveMonths: number
	eligibleMonths: number
}

function weightedMean(rows: Array<{ trades: number; meanNetR: number | null }>): number | null {
	const usable = rows.filter((row) => row.trades > 0 && row.meanNetR != null)
	const count = usable.reduce((sum, row) => sum + row.trades, 0)
	return count ? usable.reduce((sum, row) => sum + row.meanNetR! * row.trades, 0) / count : null
}

export function buildIndependentReversalG2WalkForward(input: Input) {
	const selectedCells = input.transfer.cells.filter((cell) => cell.variant === input.selectedVariant)
	const months = [...new Set(selectedCells.flatMap((cell) => cell.months.map((month) => month.month)))].sort()
	const foldCount = INDEPENDENT_REVERSAL_G2_PROTOCOL.validation.monthBlockFolds
	const foldSize = Math.max(INDEPENDENT_REVERSAL_G2_PROTOCOL.validation.minimumFoldMonths, Math.floor(months.length / foldCount))
	const folds: WalkForwardFold[] = []
	for (let fold = 0; fold < foldCount; fold++) {
		const foldMonths = months.slice(fold * foldSize, fold === foldCount - 1 ? months.length : (fold + 1) * foldSize)
		if (!foldMonths.length) continue
		const observations = selectedCells.flatMap((cell) => cell.months.filter((row) => foldMonths.includes(row.month)).map((row) => row.summary))
		folds.push({
			fold: fold + 1,
			months: foldMonths,
			trades: observations.reduce((sum, row) => sum + row.trades, 0),
			meanNetR: weightedMean(observations),
			positiveMonths: observations.filter((row) => row.trades > 0 && (row.meanNetR ?? -Infinity) > 0).length,
			eligibleMonths: observations.filter((row) => row.trades > 0).length,
		})
	}
	const positiveFolds = folds.filter((fold) => (fold.meanNetR ?? -Infinity) > 0).length
	return {
		protocolHash: input.protocolHash,
		selectedVariant: input.selectedVariant,
		parentVerdict: input.verdict,
		folds,
		positiveFolds,
		foldConsistency: folds.length ? positiveFolds / folds.length : null,
		verdict: folds.length === foldCount && positiveFolds >= 3 ? 'WALK_FORWARD_STABLE' : 'WALK_FORWARD_UNSTABLE',
	}
}

function markdown(result: ReturnType<typeof buildIndependentReversalG2WalkForward>): string {
	const lines = [
		'# Independent Reversal G2 — month-block walk-forward audit', '',
		`Selected variant: **${result.selectedVariant}**`,
		`Verdict: **${result.verdict}**`, '',
		'| Fold | Months | Trades | Mean net R | Positive month-cells |',
		'|---:|---|---:|---:|---:|',
	]
	for (const fold of result.folds) lines.push(`| ${fold.fold} | ${fold.months[0]}..${fold.months.at(-1)} | ${fold.trades} | ${(fold.meanNetR ?? NaN).toFixed(4)} | ${fold.positiveMonths}/${fold.eligibleMonths} |`)
	lines.push('', `Positive folds: ${result.positiveFolds}/${result.folds.length}.`)
	return `${lines.join('\n')}\n`
}

export function main() {
	const input = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-g2-fit-validation.json'), 'utf8')) as Input
	const result = buildIndependentReversalG2WalkForward(input)
	writeFileSync(resolve('ci-results/independent-reversal-g2-walk-forward.json'), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve('ci-results/independent-reversal-g2-walk-forward.md'), markdown(result))
	console.log(JSON.stringify({ selectedVariant: result.selectedVariant, verdict: result.verdict, positiveFolds: result.positiveFolds }, null, 2))
	return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
