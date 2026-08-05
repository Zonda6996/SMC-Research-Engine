import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface SnapshotDiffOptions {
	olderFile: string
	newerFile: string
	timeframeMs: number
	ignoreNewestBars: number
	priceTolerance: number
	outFile: string
}

interface RowChange {
	timestamp: number
	utc: string
	ageFromNewestBars: number
	shapeChanged: boolean
	oldBuy: boolean
	newBuy: boolean
	oldSell: boolean
	newSell: boolean
	priceChanged: boolean
	bandChanged: boolean
	changes: Record<string, { old: number | boolean; new: number | boolean; delta?: number }>
}

function parseArgs(args: readonly string[]): SnapshotDiffOptions {
	const values = new Map<string, string>()
	for (let i = 0; i < args.length; i += 2) {
		const key = args[i]
		const value = args[i + 1]
		if (key == null || value == null || !key.startsWith('--')) throw new Error('Arguments must use --key value pairs')
		values.set(key.slice(2), value)
	}
	const olderFile = values.get('older')
	const newerFile = values.get('newer')
	const timeframeMs = Number(values.get('timeframe-ms'))
	if (!olderFile || !newerFile || !Number.isFinite(timeframeMs) || timeframeMs <= 0) {
		throw new Error('Usage: --older <csv> --newer <csv> --timeframe-ms <ms> [--ignore-newest-bars 1] [--price-tolerance 1e-10] [--out <json>]')
	}
	return {
		olderFile,
		newerFile,
		timeframeMs,
		ignoreNewestBars: Number(values.get('ignore-newest-bars') ?? '1'),
		priceTolerance: Number(values.get('price-tolerance') ?? '1e-10'),
		outFile: values.get('out') ?? resolve('ci-results', 'ggi-snapshot-diff.json'),
	}
}

function numericChanged(oldValue: number, newValue: number, tolerance: number): boolean {
	const scale = Math.max(1, Math.abs(oldValue), Math.abs(newValue))
	return Math.abs(oldValue - newValue) > tolerance * scale
}

function compareRows(oldRow: ExactIndicatorRow, newRow: ExactIndicatorRow, tolerance: number, newestTimestamp: number, timeframeMs: number): RowChange | null {
	const numericFields = ['open', 'high', 'low', 'close', 'mean', 'upperOuter', 'upperInner', 'lowerInner', 'lowerOuter'] as const
	const changes: RowChange['changes'] = {}
	for (const field of numericFields) {
		if (numericChanged(oldRow[field], newRow[field], tolerance)) {
			changes[field] = { old: oldRow[field], new: newRow[field], delta: newRow[field] - oldRow[field] }
		}
	}
	if (oldRow.buy !== newRow.buy) changes.buy = { old: oldRow.buy, new: newRow.buy }
	if (oldRow.sell !== newRow.sell) changes.sell = { old: oldRow.sell, new: newRow.sell }
	if (Object.keys(changes).length === 0) return null
	return {
		timestamp: oldRow.timestamp,
		utc: new Date(oldRow.timestamp).toISOString(),
		ageFromNewestBars: Math.max(0, Math.round((newestTimestamp - oldRow.timestamp) / timeframeMs)),
		shapeChanged: oldRow.buy !== newRow.buy || oldRow.sell !== newRow.sell,
		oldBuy: oldRow.buy,
		newBuy: newRow.buy,
		oldSell: oldRow.sell,
		newSell: newRow.sell,
		priceChanged: ['open', 'high', 'low', 'close'].some((field) => field in changes),
		bandChanged: ['mean', 'upperOuter', 'upperInner', 'lowerInner', 'lowerOuter'].some((field) => field in changes),
		changes,
	}
}

export function compareGgiSnapshots(
	older: readonly ExactIndicatorRow[],
	newer: readonly ExactIndicatorRow[],
	timeframeMs: number,
	ignoreNewestBars = 1,
	priceTolerance = 1e-10,
) {
	const oldByTime = new Map(older.map((row) => [row.timestamp, row]))
	const newByTime = new Map(newer.map((row) => [row.timestamp, row]))
	const shared = [...oldByTime.keys()].filter((timestamp) => newByTime.has(timestamp)).sort((a, b) => a - b)
	if (shared.length === 0) throw new Error('Snapshots have no shared timestamps')
	const newestSharedTimestamp = shared.at(-1)!
	const changes = shared.flatMap((timestamp) => {
		const change = compareRows(oldByTime.get(timestamp)!, newByTime.get(timestamp)!, priceTolerance, newestSharedTimestamp, timeframeMs)
		return change == null ? [] : [change]
	})
	const historicalChanges = changes.filter((change) => change.ageFromNewestBars > ignoreNewestBars)
	const recentChanges = changes.filter((change) => change.ageFromNewestBars <= ignoreNewestBars)
	const oldOnly = [...oldByTime.keys()].filter((timestamp) => !newByTime.has(timestamp)).sort((a, b) => a - b)
	const newOnly = [...newByTime.keys()].filter((timestamp) => !oldByTime.has(timestamp)).sort((a, b) => a - b)
	return {
		sharedRows: shared.length,
		olderOnlyRows: oldOnly.length,
		newerOnlyRows: newOnly.length,
		oldOnlyRange: oldOnly.length === 0 ? null : { firstUtc: new Date(oldOnly[0]!).toISOString(), lastUtc: new Date(oldOnly.at(-1)!).toISOString() },
		newOnlyRange: newOnly.length === 0 ? null : { firstUtc: new Date(newOnly[0]!).toISOString(), lastUtc: new Date(newOnly.at(-1)!).toISOString() },
		ignoreNewestBars,
		changes: changes.length,
		recentChanges: recentChanges.length,
		historicalChanges: historicalChanges.length,
		historicalShapeChanges: historicalChanges.filter((change) => change.shapeChanged).length,
		historicalBandChanges: historicalChanges.filter((change) => change.bandChanged).length,
		historicalPriceChanges: historicalChanges.filter((change) => change.priceChanged).length,
		verdict: historicalChanges.some((change) => change.shapeChanged)
			? 'historical-shape-repaint-detected'
			: historicalChanges.some((change) => change.bandChanged)
				? 'historical-band-recalculation-detected'
				: 'no-historical-change-detected-in-this-pair',
		historicalChangesDetail: historicalChanges,
		recentChangesDetail: recentChanges,
	}
}

if (process.argv[1]?.includes('compareGgiExportSnapshots')) {
	const options = parseArgs(process.argv.slice(2))
	const parseOptions = { expectedTimeframeMs: options.timeframeMs, allowIrregularBars: true, allowInvalidBandOrder: true }
	const older = parseExactIndicatorCsv(readFileSync(options.olderFile, 'utf8'), parseOptions)
	const newer = parseExactIndicatorCsv(readFileSync(options.newerFile, 'utf8'), parseOptions)
	const comparison = compareGgiSnapshots(older, newer, options.timeframeMs, options.ignoreNewestBars, options.priceTolerance)
	const result = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		older: { file: options.olderFile, name: basename(options.olderFile), sha256: sha256File(options.olderFile), rows: older.length },
		newer: { file: options.newerFile, name: basename(options.newerFile), sha256: sha256File(options.newerFile), rows: newer.length },
		timeframeMs: options.timeframeMs,
		priceTolerance: options.priceTolerance,
		...comparison,
	}
	mkdirSync(resolve(options.outFile, '..'), { recursive: true })
	writeFileSync(options.outFile, `${JSON.stringify(result, null, 2)}\n`)
	console.log(JSON.stringify({ outFile: options.outFile, verdict: result.verdict, historicalChanges: result.historicalChanges, historicalShapeChanges: result.historicalShapeChanges }, null, 2))
}
