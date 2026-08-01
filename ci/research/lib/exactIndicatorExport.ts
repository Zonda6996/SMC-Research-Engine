import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Candle } from '../../../src/models/price/Candle.js'

export type ExactDirection = 'long' | 'short'
export type ExactMarket = 'futures' | 'spot'
export type ExactDatasetRole = 'development' | 'holdout-asset' | 'holdout-timeframe' | 'holdout-market-kind'

export interface ExactIndicatorRow extends Candle {
	mean: number
	upperOuter: number
	upperInner: number
	lowerInner: number
	lowerOuter: number
	buy: boolean
	sell: boolean
}

export interface ExactDatasetManifestEntry {
	id: string
	file: string
	exchange: string
	symbol: string
	market: ExactMarket
	timeframe: string
	timeframeMs: number
	role: ExactDatasetRole
	rows: number
	buy: number
	sell: number
	firstUtc: string
	lastUtc: string
	sha256: string
}

export interface ExactDatasetManifest {
	schemaVersion: number
	source: string
	shapeMapping: { shape0: 'BUY'; shape1: 'SELL' }
	datasets: ExactDatasetManifestEntry[]
}

export interface ExactIndicatorDataset {
	meta: ExactDatasetManifestEntry
	rows: ExactIndicatorRow[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_EXACT_EXPORT_DIR = resolve(HERE, '../../../data/vendor-exports')

function finite(value: string, field: string, line: number): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field} at line ${line}: ${value}`)
	return parsed
}

function label(value: string, field: string, line: number): boolean {
	const parsed = finite(value, field, line)
	if (parsed !== 0 && parsed !== 1) throw new Error(`Invalid ${field} label at line ${line}: ${value}`)
	return parsed === 1
}

export function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function parseExactIndicatorCsv(text: string, expectedTimeframeMs?: number): ExactIndicatorRow[] {
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
	if (lines.length < 2) throw new Error('Exact indicator export is empty')
	const header = lines[0]!.split(',')
	const fullHeader = ['time', 'open', 'high', 'low', 'close', 'GGI Mean', 'GGI Upper Outer', 'GGI Upper Inner', 'GGI Lower Inner', 'GGI Lower Outer', 'Shapes', 'Shapes']
	const legacyHeader = ['time', 'open', 'high', 'low', 'close', 'GGI Mean', 'GGI Upper Inner', 'GGI Lower Inner', 'Shapes', 'Shapes']
	const sameHeader = (expected: string[]) => header.length === expected.length && header.every((value, i) => value === expected[i])
	const hasExportedOuter = sameHeader(fullHeader)
	if (!hasExportedOuter && !sameHeader(legacyHeader)) throw new Error(`Unexpected exact indicator CSV header: ${header.join(',')}`)
	const expectedColumns = hasExportedOuter ? fullHeader.length : legacyHeader.length
	const rows: ExactIndicatorRow[] = []
	let previousTimestamp = -Infinity
	for (let i = 1; i < lines.length; i++) {
		const lineNumber = i + 1
		const fields = lines[i]!.split(',')
		if (fields.length !== expectedColumns) throw new Error(`Expected ${expectedColumns} columns at line ${lineNumber}, got ${fields.length}`)
		const timestamp = finite(fields[0]!, 'time', lineNumber) * 1000
		if (!Number.isInteger(timestamp)) throw new Error(`Timestamp is not whole milliseconds at line ${lineNumber}`)
		if (timestamp <= previousTimestamp) throw new Error(`Timestamps are not strictly increasing at line ${lineNumber}`)
		if (expectedTimeframeMs != null && rows.length > 0 && timestamp - previousTimestamp !== expectedTimeframeMs) {
			throw new Error(`Missing or irregular bar at line ${lineNumber}: expected ${expectedTimeframeMs}ms, got ${timestamp - previousTimestamp}ms`)
		}
		const mean = finite(fields[5]!, 'mean', lineNumber)
		const upperInner = finite(fields[hasExportedOuter ? 7 : 6]!, 'upperInner', lineNumber)
		const lowerInner = finite(fields[hasExportedOuter ? 8 : 7]!, 'lowerInner', lineNumber)
		const outerRatio = 9.6 / 5.6
		const row: ExactIndicatorRow = {
			timestamp,
			open: finite(fields[1]!, 'open', lineNumber),
			high: finite(fields[2]!, 'high', lineNumber),
			low: finite(fields[3]!, 'low', lineNumber),
			close: finite(fields[4]!, 'close', lineNumber),
			volume: 0,
			mean,
			upperOuter: hasExportedOuter ? finite(fields[6]!, 'upperOuter', lineNumber) : mean * Math.exp(Math.log(upperInner / mean) * outerRatio),
			upperInner,
			lowerInner,
			lowerOuter: hasExportedOuter ? finite(fields[9]!, 'lowerOuter', lineNumber) : mean * Math.exp(Math.log(lowerInner / mean) * outerRatio),
			buy: label(fields[hasExportedOuter ? 10 : 8]!, 'Shape0/BUY', lineNumber),
			sell: label(fields[hasExportedOuter ? 11 : 9]!, 'Shape1/SELL', lineNumber),
		}
		if (row.low > row.high) throw new Error(`Low exceeds high at line ${lineNumber}`)
		if (row.lowerOuter >= row.lowerInner || row.lowerInner >= row.mean || row.mean >= row.upperInner || row.upperInner >= row.upperOuter) throw new Error(`Invalid band order at line ${lineNumber}`)
		if (row.buy && row.sell) throw new Error(`BUY and SELL are both set at line ${lineNumber}`)
		rows.push(row)
		previousTimestamp = timestamp
	}
	return rows
}

export function loadExactManifest(baseDir = DEFAULT_EXACT_EXPORT_DIR): ExactDatasetManifest {
	const path = resolve(baseDir, 'manifest.json')
	return JSON.parse(readFileSync(path, 'utf8')) as ExactDatasetManifest
}

export function validateExactDataset(dataset: ExactIndicatorDataset, filePath: string): void {
	const { meta, rows } = dataset
	const buys = rows.filter((row) => row.buy).length
	const sells = rows.filter((row) => row.sell).length
	if (rows.length !== meta.rows) throw new Error(`${meta.id}: expected ${meta.rows} rows, got ${rows.length}`)
	if (buys !== meta.buy || sells !== meta.sell) throw new Error(`${meta.id}: expected ${meta.buy}/${meta.sell} BUY/SELL, got ${buys}/${sells}`)
	if (new Date(rows[0]!.timestamp).toISOString() !== meta.firstUtc) throw new Error(`${meta.id}: first timestamp mismatch`)
	if (new Date(rows.at(-1)!.timestamp).toISOString() !== meta.lastUtc) throw new Error(`${meta.id}: last timestamp mismatch`)
	const hash = sha256File(filePath)
	if (hash !== meta.sha256) throw new Error(`${meta.id}: sha256 mismatch, expected ${meta.sha256}, got ${hash}`)
}

export function loadExactDatasets(baseDir = DEFAULT_EXACT_EXPORT_DIR): ExactIndicatorDataset[] {
	const manifest = loadExactManifest(baseDir)
	if (manifest.schemaVersion !== 1) throw new Error(`Unsupported exact export manifest version ${manifest.schemaVersion}`)
	return manifest.datasets.map((meta) => {
		const filePath = resolve(baseDir, meta.file)
		const rows = parseExactIndicatorCsv(readFileSync(filePath, 'utf8'), meta.timeframeMs)
		const dataset = { meta, rows }
		validateExactDataset(dataset, filePath)
		return dataset
	})
}

export function exactEvents(rows: ExactIndicatorRow[]): Array<{ at: number; direction: ExactDirection }> {
	const out: Array<{ at: number; direction: ExactDirection }> = []
	for (const row of rows) {
		if (row.buy) out.push({ at: row.timestamp, direction: 'long' })
		if (row.sell) out.push({ at: row.timestamp, direction: 'short' })
	}
	return out
}
