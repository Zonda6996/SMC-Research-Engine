import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface Summary { trades: number; meanNetR: number | null; profitFactor: number | null; bestOnePercentRemovedR: number | null }
interface Variant { summary: Summary; bootstrap: { low95: number | null; high95: number | null } }
interface Input {
	protocolHash: string
	selectedVariant: string
	transfer: { aggregate: Record<string, Variant>; cells: Array<{ symbol: string; variant: string; summary: Summary }> }
}

export function buildIndependentReversalG2Ablation(input: Input) {
	const selected = input.transfer.aggregate[input.selectedVariant]!
	const controls = [
		{ id: 'remove-sequence-gate', variant: 'EXT_POOL' },
		{ id: 'replace-extension-with-own1', variant: 'OWN1_POOL' },
		{ id: 'remove-pool-context', variant: 'EXT' },
		{ id: 'matched-opportunity-null', variant: 'MATCHED_NULL' },
		{ id: 'legacy-g1-baseline', variant: 'G1' },
	].map((control) => {
		const evaluation = input.transfer.aggregate[control.variant]!
		return {
			...control,
			summary: evaluation.summary,
			deltaMeanNetR: (selected.summary.meanNetR ?? 0) - (evaluation.summary.meanNetR ?? 0),
			deltaProfitFactor: (selected.summary.profitFactor ?? 0) - (evaluation.summary.profitFactor ?? 0),
		}
	})
	const cells = input.transfer.cells.filter((cell) => cell.variant === input.selectedVariant)
	const positiveCells = cells.filter((cell) => (cell.summary.meanNetR ?? -Infinity) > 0).length
	const sequenceControl = controls.find((control) => control.id === 'remove-sequence-gate')!
	const nullControl = controls.find((control) => control.id === 'matched-opportunity-null')!
	return {
		protocolHash: input.protocolHash,
		selectedVariant: input.selectedVariant,
		selected: selected.summary,
		controls,
		cellStability: { positiveCells, totalCells: cells.length, share: cells.length ? positiveCells / cells.length : null },
		findings: {
			sequenceAddsMeanR: sequenceControl.deltaMeanNetR > 0,
			beatsMatchedNull: nullControl.deltaMeanNetR > 0,
			bestOnePercentRemovedPositive: (selected.summary.bestOnePercentRemovedR ?? -Infinity) > 0,
		},
		verdict: sequenceControl.deltaMeanNetR > 0 && nullControl.deltaMeanNetR > 0 && (selected.summary.bestOnePercentRemovedR ?? -Infinity) > 0
			? 'ABLATION_SUPPORTS_INTERACTION'
			: 'ABLATION_DOES_NOT_ISOLATE_EDGE',
	}
}

function markdown(result: ReturnType<typeof buildIndependentReversalG2Ablation>): string {
	const lines = [
		'# Independent Reversal G2 — ablation and falsification', '',
		`Selected variant: **${result.selectedVariant}**`,
		`Verdict: **${result.verdict}**`, '',
		'| Control | Variant | Mean net R | PF | Δ selected-control |',
		'|---|---|---:|---:|---:|',
	]
	for (const control of result.controls) lines.push(`| ${control.id} | ${control.variant} | ${(control.summary.meanNetR ?? NaN).toFixed(4)} | ${(control.summary.profitFactor ?? NaN).toFixed(3)} | ${control.deltaMeanNetR.toFixed(4)} |`)
	lines.push('', `Positive transfer cells: ${result.cellStability.positiveCells}/${result.cellStability.totalCells}.`)
	return `${lines.join('\n')}\n`
}

export function main() {
	const input = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-g2-fit-validation.json'), 'utf8')) as Input
	const result = buildIndependentReversalG2Ablation(input)
	writeFileSync(resolve('ci-results/independent-reversal-g2-ablation.json'), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve('ci-results/independent-reversal-g2-ablation.md'), markdown(result))
	console.log(JSON.stringify({ selectedVariant: result.selectedVariant, verdict: result.verdict }, null, 2))
	return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
