import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchCandlesPaginated, TF_MS } from '../../tools/shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'

const FREEZE_PATH = 'ci-results/stateful-apex-s4-holdout-universe-freeze.json'
const EXPECTED_FREEZE_HASH = '0f72ae18bfadef715bec8bfa7372f6551825f6c9b6256afafa2858ef71761c94'
const DATA_DIR = 'data/holdouts/stateful-apex-s4-v2'
const JSON_OUT = 'ci-results/stateful-apex-s4-holdout-acquisition.json'
const MD_OUT = 'ci-results/stateful-apex-s4-holdout-acquisition.md'

interface Freeze {
	status: string
	freezeHash: string
	selectedSymbols: Array<{ rank: number; symbol: string; canonicalSymbol: string }>
	dataProtocol: { timeframe: string; timeframeMinutes: number; rowTargetPerSymbol: number; warmupBars: number; utcWindow: { startInclusive: string; endExclusive: string } }
	revealCounters: Record<string, number>
}

function sha256(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex') }
function sha256File(path: string): string { return sha256(readFileSync(resolve(path))) }
function allZero(values: Record<string, number>): boolean { return Object.values(values).every((value) => value === 0) }
function validate(candles: readonly Candle[], start: number, end: number, tfMs: number, target: number): string[] {
	const errors: string[] = []
	if (candles.length !== target) errors.push(`row-count=${candles.length}, expected=${target}`)
	for (let i = 0; i < candles.length; i++) {
		const row = candles[i]!
		const expected = start + i * tfMs
		if (row.timestamp !== expected) errors.push(`timestamp[${i}]=${row.timestamp}, expected=${expected}`)
		if (row.timestamp < start || row.timestamp >= end || row.timestamp % tfMs !== 0) errors.push(`off-window-or-grid[${i}]`)
		if (![row.timestamp, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)) errors.push(`non-finite[${i}]`)
		if (!(row.low <= Math.min(row.open, row.close) && Math.max(row.open, row.close) <= row.high && row.volume >= 0)) errors.push(`invalid-ohlcv[${i}]`)
		if (i > 0 && row.timestamp <= candles[i - 1]!.timestamp) errors.push(`non-increasing[${i}]`)
		if (errors.length > 20) break
	}
	return errors
}

async function main(): Promise<void> {
	if (process.env.S4_HOLDOUT_ACQUIRE_ACK !== 'frozen-universe-only') throw new Error('Explicit frozen-universe acquisition acknowledgement is required.')
	const freezeBytes = readFileSync(resolve(FREEZE_PATH))
	const freeze = JSON.parse(freezeBytes.toString('utf8')) as Freeze
	if (freeze.status !== 'IMMUTABLE_HOLDOUT_UNIVERSE_FROZEN_NO_OHLCV_READ' || freeze.freezeHash !== EXPECTED_FREEZE_HASH || !allZero(freeze.revealCounters)) throw new Error('Immutable universe freeze/seal mismatch.')
	if (freeze.selectedSymbols.length !== 3 || freeze.dataProtocol.timeframe !== '1h' || freeze.dataProtocol.rowTargetPerSymbol !== 20_000 || freeze.dataProtocol.warmupBars !== 210) throw new Error('Frozen data protocol mismatch.')
	const tfMs = TF_MS[freeze.dataProtocol.timeframe]
	if (tfMs !== freeze.dataProtocol.timeframeMinutes * 60_000) throw new Error('Frozen timeframe mismatch.')
	const start = Date.parse(freeze.dataProtocol.utcWindow.startInclusive)
	const end = Date.parse(freeze.dataProtocol.utcWindow.endExclusive)
	if (end - start !== freeze.dataProtocol.rowTargetPerSymbol * tfMs) throw new Error('Frozen window/row target mismatch.')

	mkdirSync(resolve(DATA_DIR), { recursive: true })
	const series: Array<Record<string, unknown>> = []
	let blocker: string | null = null
	for (const selected of freeze.selectedSymbols) {
		if (blocker != null) break
		try {
			const candles = await fetchCandlesPaginated(selected.symbol, freeze.dataProtocol.timeframe, freeze.dataProtocol.rowTargetPerSymbol, 'futures', end)
			const errors = validate(candles, start, end, tfMs, freeze.dataProtocol.rowTargetPerSymbol)
			if (errors.length > 0) { blocker = `${selected.canonicalSymbol}: ${errors.join('; ')}`; break }
			const file = `${DATA_DIR}/${selected.canonicalSymbol}-1h.json`
			const payload = JSON.stringify(candles)
			writeFileSync(resolve(file), payload + '\n')
			series.push({ rank: selected.rank, symbol: selected.canonicalSymbol, ccxtSymbol: selected.symbol, file, rows: candles.length, firstTimestamp: candles[0]!.timestamp, firstUtc: new Date(candles[0]!.timestamp).toISOString(), lastTimestamp: candles.at(-1)!.timestamp, lastUtc: new Date(candles.at(-1)!.timestamp).toISOString(), sha256: sha256File(file), schemaErrors: 0, missingBars: 0, duplicateBars: 0, offGridBars: 0 })
		} catch (error) {
			blocker = `${selected.canonicalSymbol}: ${error instanceof Error ? error.message : String(error)}`
		}
	}
	const complete = blocker == null && series.length === freeze.selectedSymbols.length
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		status: complete ? 'HOLDOUT_ACQUIRED_VALIDATED_NOT_REVEALED' : 'HOLDOUT_ACQUISITION_BLOCKED_NO_REVEAL',
		blocker,
		protocol: { freezePath: FREEZE_PATH, freezeFileSha256: sha256(freezeBytes), freezeHash: freeze.freezeHash, venue: 'Binance USDT-M perpetual', mechanism: 'tools/shared/candleFetcher.fetchCandlesPaginated via ccxt.binanceusdm.fetchOHLCV', timeframe: freeze.dataProtocol.timeframe, utcWindow: freeze.dataProtocol.utcWindow, rowTargetPerSymbol: freeze.dataProtocol.rowTargetPerSymbol, missingDataPolicyAppliedExactly: true, interpolation: false, symbolReplacement: false },
		series,
		integrity: { requestedSymbols: freeze.selectedSymbols.map((item) => item.canonicalSymbol), acquiredSymbols: series.map((item) => item.symbol), wholeSymbolCount: series.length, schemaErrors: series.reduce((sum, item) => sum + Number(item.schemaErrors), 0), missingBars: series.reduce((sum, item) => sum + Number(item.missingBars), 0), duplicateBars: series.reduce((sum, item) => sum + Number(item.duplicateBars), 0), offGridBars: series.reduce((sum, item) => sum + Number(item.offGridBars), 0), nonOverlapWithPriorInventory: true, priorLocalOhlcvUsedForSelectionOrFallback: false },
		revealCounters: { revealCount: 0, eventsDetected: 0, labelsComputed: 0, pnlComputed: 0, metricsComputed: 0, s1UntouchedOosRevealCount: 0, ondoVirtualReuseCount: 0 },
	}
	writeFileSync(resolve(JSON_OUT), JSON.stringify(output, null, 2) + '\n')
	const rows = series.map((item) => `| ${item.symbol} | ${item.rows} | ${item.firstUtc} | ${item.lastUtc} | \`${item.sha256}\` |`).join('\n')
	const md = `# Stateful Apex S4 v2 — holdout acquisition\n\n- Status: **${output.status}**.\n- Reveal count: **0**; events/labels/PnL/metrics: **0/0/0/0**.\n- S1 untouched OOS reveal: **0**; ONDO/VIRTUAL reuse: **0**.\n- Mechanism: existing project paginated candle fetcher using ccxt Binance USDT-M.\n- Blocker: ${blocker ?? 'none'}\n\n| symbol | rows | first UTC | last UTC | SHA-256 |\n|---|---:|---|---|---|\n${rows}\n\nFrozen missing-data policy was applied exactly: no interpolation, no fallback, no replacement.\n`
	writeFileSync(resolve(MD_OUT), md)
	if (!complete) throw new Error(`Acquisition blocked with reveal=0: ${blocker}`)
	console.log(`Acquired and validated ${series.length} frozen whole-symbol series; reveal=0.`)
}

await main()
