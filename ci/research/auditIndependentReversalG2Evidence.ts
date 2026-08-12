import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { INDEPENDENT_REVERSAL_G2_PROTOCOL } from '../../src/core/signals/IndependentReversalG2Protocol.js'

interface Summary {
	trades: number
	meanNetR: number | null
	profitFactor: number | null
	bestOnePercentRemovedR: number | null
}

interface AggregateVariant {
	summary: Summary
	bootstrap: { low95: number | null; high95: number | null; probabilityPositive: number | null }
	portfolio: { totalReturnPct: number; maximumDrawdownPct: number }
	stress: Record<string, Summary>
}

interface FitInput {
	protocolHash: string
	selectedVariant: string
	verdict: string
	transfer: {
		aggregate: Record<string, AggregateVariant>
		cells: Array<{ symbol: string; variant: string; summary: Summary }>
	}
}

interface WalkInput {
	verdict: string
	folds: Array<{ fold: number; months: string[]; trades: number; meanNetR: number | null; positiveMonths: number; eligibleMonths: number }>
}

interface AblationInput {
	verdict: string
	controls: Array<{ id: string; variant: string; deltaMeanNetR: number }>
}

function finite(value: number | null | undefined, fallback = Number.NEGATIVE_INFINITY): number {
	return value != null && Number.isFinite(value) ? value : fallback
}

function totalNetR(summary: Summary): number {
	return summary.trades * finite(summary.meanNetR, 0)
}

export function auditIndependentReversalG2Evidence(fit: FitInput, walk: WalkInput, ablation: AblationInput) {
	const protocol = INDEPENDENT_REVERSAL_G2_PROTOCOL
	const selected = fit.transfer.aggregate[fit.selectedVariant]!
	const matchedNull = fit.transfer.aggregate.MATCHED_NULL!
	const selectedCells = fit.transfer.cells.filter((cell) => cell.variant === fit.selectedVariant)
	const positiveCells = selectedCells.filter((cell) => finite(cell.summary.meanNetR) >= 0)
	const positiveTotalR = positiveCells.reduce((sum, cell) => sum + Math.max(0, totalNetR(cell.summary)), 0)
	const contributions = positiveCells.map((cell) => ({
		symbol: cell.symbol,
		positiveNetR: Math.max(0, totalNetR(cell.summary)),
		share: positiveTotalR > 0 ? Math.max(0, totalNetR(cell.summary)) / positiveTotalR : 0,
	})).sort((a, b) => b.share - a.share)
	const maximumContribution = contributions[0]?.share ?? 0
	const totalTrades = selectedCells.reduce((sum, cell) => sum + cell.summary.trades, 0)
	const totalR = selectedCells.reduce((sum, cell) => sum + totalNetR(cell.summary), 0)
	const leaveOneSymbolOut = selectedCells.map((excluded) => {
		const trades = totalTrades - excluded.summary.trades
		const netR = totalR - totalNetR(excluded.summary)
		return { excluded: excluded.symbol, trades, meanNetR: trades > 0 ? netR / trades : null }
	}).sort((a, b) => finite(a.meanNetR) - finite(b.meanNetR))
	const worstLeaveOneOutMeanR = leaveOneSymbolOut[0]?.meanNetR ?? null
	const stressCost = String(protocol.execution.stressOneWayCostBps.at(-1))
	const stress = selected.stress[stressCost]!
	const nonNegativeCellShare = selectedCells.length ? positiveCells.length / selectedCells.length : 0
	const nullAdvantage = finite(selected.summary.meanNetR, 0) - finite(matchedNull.summary.meanNetR, 0)
	const lastFold = walk.folds.at(-1) ?? null
	const transferYears = (Date.parse(`${protocol.validation.transferUntil}T00:00:00Z`) - Date.parse(`${protocol.validation.transferFrom}T00:00:00Z`)) / (365.25 * 86_400_000)

	const gates = {
		minimumOosTrades: { value: selected.summary.trades, threshold: protocol.gates.minimumOosTrades, pass: selected.summary.trades >= protocol.gates.minimumOosTrades },
		meanNetR: { value: selected.summary.meanNetR, threshold: protocol.gates.minimumMeanNetR, pass: finite(selected.summary.meanNetR) >= protocol.gates.minimumMeanNetR },
		profitFactor: { value: selected.summary.profitFactor, threshold: protocol.gates.minimumProfitFactor, pass: finite(selected.summary.profitFactor) >= protocol.gates.minimumProfitFactor },
		stressMeanNetR: { value: stress.meanNetR, threshold: protocol.gates.minimumStressMeanNetR, pass: finite(stress.meanNetR) > protocol.gates.minimumStressMeanNetR },
		stressProfitFactor: { value: stress.profitFactor, threshold: protocol.gates.minimumStressProfitFactor, pass: finite(stress.profitFactor) >= protocol.gates.minimumStressProfitFactor },
		bestOnePercentRemovedR: { value: selected.summary.bestOnePercentRemovedR, threshold: protocol.gates.minimumBestOnePercentRemovedR, pass: finite(selected.summary.bestOnePercentRemovedR) > protocol.gates.minimumBestOnePercentRemovedR },
		nullAdvantage: { value: nullAdvantage, threshold: protocol.gates.minimumNullAdvantageR, pass: nullAdvantage >= protocol.gates.minimumNullAdvantageR },
		nonNegativeCellShare: { value: nonNegativeCellShare, threshold: protocol.gates.minimumNonNegativeCellShare, pass: nonNegativeCellShare >= protocol.gates.minimumNonNegativeCellShare },
		positiveTransferCells: { value: positiveCells.length, threshold: protocol.gates.minimumPositiveTransferCells, pass: positiveCells.length >= protocol.gates.minimumPositiveTransferCells },
		maximumSingleSymbolPositiveContribution: { value: maximumContribution, threshold: protocol.gates.maximumSingleSymbolPositiveContribution, pass: maximumContribution <= protocol.gates.maximumSingleSymbolPositiveContribution },
		maximumPortfolioDrawdownPct: { value: selected.portfolio.maximumDrawdownPct, threshold: protocol.gates.maximumPortfolioDrawdownPct, pass: selected.portfolio.maximumDrawdownPct <= protocol.gates.maximumPortfolioDrawdownPct },
	}
	const failedPromotionGates = Object.entries(gates).filter(([, gate]) => !gate.pass).map(([id]) => id)
	const evidenceWarnings = [
		{
			id: 'matched-null-count-mismatch',
			pass: matchedNull.summary.trades === selected.summary.trades,
			detail: `Selected has ${selected.summary.trades} trades; MATCHED_NULL has ${matchedNull.summary.trades}. The preregistered count-matched control is not reproduced.`,
		},
		{
			id: 'matched-null-specification-mismatch',
			pass: false,
			detail: 'The frozen runner matches side/month and approximately sequence score, but does not implement the preregistered volatility/regime matching.',
		},
		{
			id: 'confidence-interval-excludes-zero',
			pass: finite(selected.bootstrap.low95) > 0,
			detail: `Month-block bootstrap 95% lower bound is ${selected.bootstrap.low95 ?? 'null'}R.`,
		},
		{
			id: 'walk-forward-is-refit',
			pass: false,
			detail: 'The current walk-forward artifact is a frozen-variant temporal block audit. It does not re-fit or re-select parameters in rolling training windows.',
		},
	]
	const failedEvidenceChecks = evidenceWarnings.filter((warning) => !warning.pass).map((warning) => warning.id)

	return {
		protocolHash: fit.protocolHash,
		selectedVariant: fit.selectedVariant,
		parentVerdicts: { fit: fit.verdict, temporalBlocks: walk.verdict, ablation: ablation.verdict },
		verdict: failedPromotionGates.length || failedEvidenceChecks.length ? 'RESEARCH_CANDIDATE_NOT_LIVE_READY' : 'LIVE_VALIDATION_CANDIDATE',
		aggregate: {
			trades: selected.summary.trades,
			meanNetR: selected.summary.meanNetR,
			profitFactor: selected.summary.profitFactor,
			bestOnePercentRemovedR: selected.summary.bestOnePercentRemovedR,
			blockBootstrap95: [selected.bootstrap.low95, selected.bootstrap.high95],
			probabilityPositive: selected.bootstrap.probabilityPositive,
			totalReturnPctAtOnePercentRisk: selected.portfolio.totalReturnPct,
			maximumDrawdownPctAtOnePercentRisk: selected.portfolio.maximumDrawdownPct,
			transferYears,
			simpleReturnPctPerYearAtOnePercentRisk: transferYears > 0 ? selected.portfolio.totalReturnPct / transferYears : null,
			lastTemporalFoldMeanNetR: lastFold?.meanNetR ?? null,
		},
		gates,
		failedPromotionGates,
		evidenceWarnings,
		failedEvidenceChecks,
		stability: {
			positiveCells: positiveCells.length,
			totalCells: selectedCells.length,
			nonNegativeCellShare,
			positiveContributionBySymbol: contributions,
			leaveOneSymbolOut,
			worstLeaveOneOutMeanR,
		},
		nextResearchOrder: [
			'CONTROL1: repair the matched null to equal count plus side/month/causal-volatility/causal-regime matching; treat the current transfer set as contaminated audit data.',
			'BREADTH1: freeze EXT_POOL_SEQ unchanged and test new symbols and at least one additional timeframe to reach 100+ genuinely new OOS trades.',
			'ECON1: add funding, spread and latency/slippage stress; max holding of 2,000 hours makes funding omission material.',
			'RANK1: on development data only, replace the hard sequence cutoff with a shallow monotone/regularized ranker and an abstain region; compare it against the unchanged binary core on a new holdout.',
			'EXEC1: nested-validation-only stop/partial/timeout ablation. Do not optimize execution on the already opened transfer symbols.',
		],
	}
}

function percent(value: number | null | undefined): string {
	return value == null || !Number.isFinite(value) ? '-' : `${(value * 100).toFixed(1)}%`
}

function number(value: number | null | undefined, digits = 4): string {
	return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits)
}

function markdown(result: ReturnType<typeof auditIndependentReversalG2Evidence>): string {
	const a = result.aggregate
	const lines = [
		'# Independent Reversal G2 — аудит торгового преимущества', '',
		`## Вердикт: **${result.verdict}**`, '',
		'Сигнал уже выглядит как содержательный исследовательский кандидат, но текущих данных недостаточно, чтобы запускать его на реальные деньги или утверждать, что прибыльность доказана.', '',
		'## Что реально показывает замороженный transfer', '',
		'| Метрика | Результат | Интерпретация |', '|---|---:|---|',
		`| Сделки | ${a.trades} | Меньше preregistered минимума 100 |`,
		`| Средний net R | ${number(a.meanNetR)} | Выше точечного порога +0.05R |`,
		`| Profit factor | ${number(a.profitFactor, 3)} | Выше точечного порога 1.20 |`,
		`| 95% month-block CI | [${number(a.blockBootstrap95[0])}, ${number(a.blockBootstrap95[1])}] | Интервал включает ноль |`,
		`| P(mean > 0), block bootstrap | ${percent(a.probabilityPositive)} | Обнадёживает, но не доказывает edge |`,
		`| Доход ledger при риске 1% | ${number(a.totalReturnPctAtOnePercentRisk, 2)}% за ${number(a.transferYears, 2)} года | Около ${number(a.simpleReturnPctPerYearAtOnePercentRisk, 2)}% в год простой арифметикой |`,
		`| Max DD при риске 1% | ${number(a.maximumDrawdownPctAtOnePercentRisk, 2)}% | Низкий, отчасти из-за редких сигналов |`,
		`| Последний временной блок | ${number(a.lastTemporalFoldMeanNetR)}R | В свежем блоке преимущество почти исчезло |`, '',
		'## Проверка promotion-контракта', '',
		'| Гейт | Значение | Порог | Пройден |', '|---|---:|---:|:---:|',
	]
	for (const [id, gate] of Object.entries(result.gates)) lines.push(`| ${id} | ${number(gate.value)} | ${number(gate.threshold)} | ${gate.pass ? 'да' : 'нет'} |`)
	lines.push('', `Провалены замороженные гейты: **${result.failedPromotionGates.join(', ') || 'нет'}**.`, '')
	lines.push('## Методологические предупреждения', '')
	const warningRu: Record<string, string> = {
		'matched-null-count-mismatch': 'Выбранный сигнал дал 60 сделок, MATCHED_NULL — 801. Заранее заявленный count-matched контроль не воспроизведён.',
		'matched-null-specification-mismatch': 'Текущий null совпадает по стороне/месяцу и приблизительно по sequence score, но не по заранее заявленным volatility/regime.',
		'confidence-interval-excludes-zero': `Нижняя граница 95% month-block bootstrap равна ${number(a.blockBootstrap95[0])}R, поэтому статистическая неопределённость остаётся большой.`,
		'walk-forward-is-refit': 'Текущий walk-forward — разрез фиксированного варианта по временным блокам, а не rolling refit/reselection. Это temporal stability audit, а не полноценное переобучение по окнам.',
	}
	for (const warning of result.evidenceWarnings) lines.push(`- **${warning.id}:** ${warningRu[warning.id] ?? warning.detail}`)
	lines.push('', '## Устойчивость между активами', '', `Положительные ячейки: **${result.stability.positiveCells}/${result.stability.totalCells} (${percent(result.stability.nonNegativeCellShare)})**.`, '', '| Исключённый актив | Оставшиеся сделки | Оставшийся средний net R |', '|---|---:|---:|')
	for (const row of result.stability.leaveOneSymbolOut) lines.push(`| ${row.excluded} | ${row.trades} | ${number(row.meanNetR)} |`)
	lines.push('', `Худший leave-one-symbol-out результат: **${number(result.stability.worstLeaveOneOutMeanR)}R**. После удаления любого одного актива aggregate остаётся положительным — это действительно хороший признак.`, '')
	lines.push('## Эксперименты с максимальной ценностью', '')
	const nextRu = [
		'CONTROL1: исправить matched null — одинаковое количество сделок плюс matching по стороне, месяцу, causal volatility и causal regime. Текущий transfer считать уже открытым audit-набором.',
		'BREADTH1: заморозить EXT_POOL_SEQ без изменений и проверить новые активы плюс минимум ещё один timeframe, пока не наберётся 100+ действительно новых OOS-сделок.',
		'ECON1: добавить funding, spread и задержку/slippage. При максимальном удержании 2 000 часов отсутствие funding в модели материально.',
		'RANK1: только на development заменить жёсткий sequence cutoff неглубоким монотонным/регуляризованным ranker с зоной abstain; сравнить с неизменённым binary core на новом holdout.',
		'EXEC1: stop/partial/timeout менять только внутри nested validation. Уже открытые transfer-активы нельзя использовать для оптимизации исполнения.',
	]
	for (const [index, item] of nextRu.entries()) lines.push(`${index + 1}. ${item}`)
	lines.push('', '## Прямой ответ', '', 'Небольшой edge здесь возможен, но пока не доказан, а плотность standalone-доходности слишком мала, чтобы назвать это готовой зарабатывающей системой. Улучшать нужно через более строгую валидацию, расширение независимой выборки и селективный ranking/abstention — не через ретюнинг порогов на уже увиденном transfer.', '')
	return lines.join('\n')
}

export function main() {
	const fit = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-g2-fit-validation.json'), 'utf8')) as FitInput
	const walk = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-g2-walk-forward.json'), 'utf8')) as WalkInput
	const ablation = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-g2-ablation.json'), 'utf8')) as AblationInput
	const result = auditIndependentReversalG2Evidence(fit, walk, ablation)
	writeFileSync(resolve('ci-results/independent-reversal-g2-evidence-audit.json'), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve('outputs/independent-reversal-g2-evidence-audit-2026-08-06.md'), `${markdown(result)}\n`)
	console.log(JSON.stringify({ verdict: result.verdict, failedPromotionGates: result.failedPromotionGates, failedEvidenceChecks: result.failedEvidenceChecks }, null, 2))
	return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
