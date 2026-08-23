import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ccxt from 'ccxt'

const VENUE = 'Binance USDT-M perpetual'
const TIMEFRAME = '1h'
const TIMEFRAME_MS = 3_600_000
const ROW_TARGET = 20_000
const WARMUP_BARS = 210
const SYMBOL_COUNT = 3
const MANIFEST_PATH = 'ci-results/stateful-apex-s1-manifest.json'
const RULE_FREEZE_PATH = 'ci-results/stateful-apex-s4-v2-freeze.json'
const RULE_FREEZE_MD_PATH = 'ci-results/stateful-apex-s4-v2-freeze.md'
const STATE_MACHINE_PATH = 'ci/research/lib/statefulApexEvents.ts'
const APEX_ENGINE_PATH = 'src/core/signals/ApexEngine.ts'
const JSON_OUT = 'ci-results/stateful-apex-s4-holdout-universe-freeze.json'
const MD_OUT = 'ci-results/stateful-apex-s4-holdout-universe-freeze.md'

interface Manifest { series: Array<{ symbol: string }> }
interface RuleFreeze { status: string; configHash: string; protocolHash: string; holdout: { revealCounters: Record<string, number> } }
interface MarketLike { id: string; symbol: string; base?: string; quote?: string; settle?: string; active?: boolean; swap?: boolean; linear?: boolean; contract?: boolean; info?: Record<string, unknown> }
interface TickerLike { symbol: string; quoteVolume?: number; timestamp?: number; datetime?: string; info?: Record<string, unknown> }

function sha256(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex') }
function sha256File(path: string): string { return sha256(readFileSync(resolve(path))) }
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
	if (value != null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
	return JSON.stringify(value)
}
function allZero(values: Record<string, number>): boolean { return Object.values(values).every((value) => value === 0) }

async function main(): Promise<void> {
	if (process.env.S4_HOLDOUT_UNIVERSE_FREEZE_ACK !== 'metadata-only-no-ohlcv') throw new Error('Explicit metadata-only freeze acknowledgement is required.')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as Manifest
	const ruleFreeze = JSON.parse(readFileSync(resolve(RULE_FREEZE_PATH), 'utf8')) as RuleFreeze
	if (ruleFreeze.status !== 'RULE_FROZEN_HOLDOUT_BLOCKED_NO_REVEAL' || !allZero(ruleFreeze.holdout.revealCounters)) throw new Error('Frozen rule/reveal seal mismatch before universe selection.')
	const excludedSymbols = [...new Set([...manifest.series.map((item) => item.symbol), 'ONDOUSDT', 'VIRTUALUSDT'])].sort()
	const excluded = new Set(excludedSymbols)

	// Metadata and contemporaneous 24h ticker snapshot only. This stage must not call fetchOHLCV.
	const exchange = new ccxt.binanceusdm({ enableRateLimit: true })
	const startedAt = new Date().toISOString()
	const markets = await exchange.loadMarkets() as Record<string, MarketLike>
	const tickers = await exchange.fetchTickers() as Record<string, TickerLike>
	const completedAt = new Date().toISOString()
	const serverTime = await exchange.fetchTime()
	const snapshotAtMs = Number.isFinite(serverTime) ? serverTime : Date.parse(completedAt)
	const windowEndMs = Math.floor(snapshotAtMs / TIMEFRAME_MS) * TIMEFRAME_MS
	const windowStartMs = windowEndMs - ROW_TARGET * TIMEFRAME_MS

	const marketSnapshot = Object.values(markets).map((market) => ({
		id: market.id,
		symbol: market.symbol,
		base: market.base ?? null,
		quote: market.quote ?? null,
		settle: market.settle ?? null,
		active: market.active === true,
		swap: market.swap === true,
		linear: market.linear === true,
		contract: market.contract === true,
		contractType: String(market.info?.contractType ?? ''),
		status: String(market.info?.status ?? ''),
		onboardDate: Number(market.info?.onboardDate ?? NaN),
	})).sort((a, b) => a.id.localeCompare(b.id))
	const tickerSnapshot = Object.values(tickers).map((ticker) => ({
		symbol: ticker.symbol,
		quoteVolume: Number(ticker.quoteVolume ?? ticker.info?.quoteVolume ?? NaN),
		timestamp: Number(ticker.timestamp ?? ticker.info?.closeTime ?? NaN),
	})).filter((ticker) => Number.isFinite(ticker.quoteVolume)).sort((a, b) => a.symbol.localeCompare(b.symbol))
	const tickerBySymbol = new Map(tickerSnapshot.map((ticker) => [ticker.symbol, ticker]))

	const eligibility = marketSnapshot.map((market) => {
		const canonical = market.id.endsWith('USDT') ? market.id : market.id.replace(/[^A-Z0-9]/g, '')
		const ticker = tickerBySymbol.get(market.symbol)
		const reasons: string[] = []
		if (!market.active || !market.swap || !market.linear || !market.contract) reasons.push('not-active-linear-swap-contract')
		if (market.quote !== 'USDT' || market.settle !== 'USDT') reasons.push('not-USDT-quoted-and-settled')
		if (market.contractType !== 'PERPETUAL') reasons.push('not-perpetual')
		if (market.status !== 'TRADING') reasons.push('not-trading')
		if (excluded.has(canonical)) reasons.push('used-or-explicitly-excluded-symbol')
		if (!Number.isFinite(market.onboardDate) || market.onboardDate > windowStartMs) reasons.push('insufficient-listing-age-for-frozen-window')
		if (ticker == null || !(ticker.quoteVolume >= 0)) reasons.push('missing-contemporaneous-quote-volume')
		return { id: market.id, symbol: market.symbol, canonicalSymbol: canonical, quoteVolume24h: ticker?.quoteVolume ?? null, onboardDate: Number.isFinite(market.onboardDate) ? market.onboardDate : null, eligible: reasons.length === 0, exclusionReasons: reasons }
	})
	const ranked = eligibility.filter((item) => item.eligible).sort((a, b) => (b.quoteVolume24h! - a.quoteVolume24h!) || a.canonicalSymbol.localeCompare(b.canonicalSymbol))
	const selected = ranked.slice(0, SYMBOL_COUNT)
	if (selected.length < SYMBOL_COUNT) throw new Error(`Only ${selected.length} eligible unused symbols; need ${SYMBOL_COUNT}.`)

	const metadataSnapshot = { venue: VENUE, startedAt, completedAt, exchangeServerTime: new Date(snapshotAtMs).toISOString(), markets: marketSnapshot, tickers: tickerSnapshot }
	const selectionProtocol = {
		venue: VENUE,
		market: 'linear USDT-quoted and USDT-settled perpetual swap',
		minimumWholeSymbols: SYMBOL_COUNT,
		selectionCount: SYMBOL_COUNT,
		ranking: 'descending contemporaneous exchange-reported 24h quoteVolume; canonical symbol ascending lexical tie-break',
		eligibility: ['active=true', 'swap=true', 'linear=true', 'contract=true', 'quote=USDT', 'settle=USDT', 'contractType=PERPETUAL', 'status=TRADING', 'onboardDate <= frozen window start', 'finite non-negative 24h quoteVolume', 'canonical symbol absent from every S1 train/validation/untouched-OOS series and S4 development/internal-holdout exclusions'],
		exclusionsAreSymbolWide: true,
		postSelectionReplacement: 'forbidden; any acquisition/schema/completeness failure blocks with reveal=0',
		labelFreeInputsOnly: true,
		ohlcvReadBeforeFreeze: false,
	}
	const dataProtocol = {
		timeframe: TIMEFRAME,
		timeframeMinutes: 60,
		utcWindow: { startInclusive: new Date(windowStartMs).toISOString(), endExclusive: new Date(windowEndMs).toISOString() },
		rowTargetPerSymbol: ROW_TARGET,
		warmupBars: WARMUP_BARS,
		eligibleEvaluationRowsPerSymbol: ROW_TARGET - WARMUP_BARS,
		schema: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
		barAlignment: 'timestamp must equal start + rowIndex*3600000; unique, strictly increasing, UTC epoch-aligned',
		missingDataPolicy: 'zero missing/duplicate/off-grid/non-finite/invalid-OHLCV rows permitted; reject the entire frozen holdout and keep reveal=0; no symbol replacement or interpolation',
		partialBars: 'excluded by endExclusive at the latest fully closed hourly boundary at snapshot time',
	}
	const outputWithoutHash = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		status: 'IMMUTABLE_HOLDOUT_UNIVERSE_FROZEN_NO_OHLCV_READ',
		selectionProtocol,
		dataProtocol,
		excludedSymbols,
		selectedSymbols: selected.map((item, rank) => ({ rank: rank + 1, ...item })),
		eligibleRanking: ranked.map((item, rank) => ({ rank: rank + 1, ...item })),
		snapshots: {
			metadataCanonicalSha256: sha256(stable(metadataSnapshot)),
			marketSnapshotCanonicalSha256: sha256(stable(marketSnapshot)),
			ticker24hSnapshotCanonicalSha256: sha256(stable(tickerSnapshot)),
			eligibilityCanonicalSha256: sha256(stable(eligibility)),
			metadata: metadataSnapshot,
		},
		inputs: {
			manifest: { path: MANIFEST_PATH, sha256: sha256File(MANIFEST_PATH) },
			frozenRuleJson: { path: RULE_FREEZE_PATH, sha256: sha256File(RULE_FREEZE_PATH), configHash: ruleFreeze.configHash, protocolHash: ruleFreeze.protocolHash },
			frozenRuleMarkdown: { path: RULE_FREEZE_MD_PATH, sha256: sha256File(RULE_FREEZE_MD_PATH) },
			stateMachine: { path: STATE_MACHINE_PATH, sha256: sha256File(STATE_MACHINE_PATH) },
			apexEngine: { path: APEX_ENGINE_PATH, sha256: sha256File(APEX_ENGINE_PATH) },
		},
		revealCounters: { ohlcvFilesRead: 0, ohlcvRowsRead: 0, eventsDetected: 0, labelsComputed: 0, pnlComputed: 0, metricsComputed: 0, s1UntouchedOosRevealCount: 0, ondoVirtualReuseCount: 0 },
	}
	const freezeHash = sha256(stable(outputWithoutHash))
	const output = { ...outputWithoutHash, freezeHash }
	writeFileSync(resolve(JSON_OUT), JSON.stringify(output, null, 2) + '\n')
	const names = output.selectedSymbols.map((item) => `${item.rank}. ${item.canonicalSymbol} — quoteVolume24h=${item.quoteVolume24h}`).join('\n')
	const md = `# Stateful Apex S4 v2 — immutable independent holdout universe freeze\n\n- Status: **${output.status}**.\n- OHLCV/events/labels/PnL/metrics read or computed: **0/0/0/0/0/0**.\n- S1 untouched OOS reveal: **0**; ONDO/VIRTUAL reuse: **0**.\n- Venue: ${VENUE}; timeframe: ${TIMEFRAME}; whole symbols: ${SYMBOL_COUNT}.\n- UTC window: [${dataProtocol.utcWindow.startInclusive}, ${dataProtocol.utcWindow.endExclusive}); ${ROW_TARGET} rows/symbol, then ${WARMUP_BARS} frozen warmup bars.\n\n## Frozen deterministic selection\n\nEligible active linear USDT-settled perpetuals with enough listing age and finite contemporaneous 24h quote volume were ranked descending by quote volume; canonical-symbol lexical ascending breaks exact ties. Every symbol present anywhere in S1 (including untouched OOS), S4 development, ONDO, and VIRTUAL is excluded symbol-wide. No post-selection replacement is allowed.\n\n${names}\n\n## Missing-data policy\n\n${dataProtocol.missingDataPolicy}\n\n## Snapshot and protocol hashes\n\n- Freeze: \`${freezeHash}\`\n- Metadata snapshot: \`${output.snapshots.metadataCanonicalSha256}\`\n- Market snapshot: \`${output.snapshots.marketSnapshotCanonicalSha256}\`\n- 24h ticker snapshot: \`${output.snapshots.ticker24hSnapshotCanonicalSha256}\`\n- Eligibility ledger: \`${output.snapshots.eligibilityCanonicalSha256}\`\n- Frozen rule config: \`${ruleFreeze.configHash}\`\n- Frozen rule protocol: \`${ruleFreeze.protocolHash}\`\n- State machine: \`${output.inputs.stateMachine.sha256}\`\n- Apex engine: \`${output.inputs.apexEngine.sha256}\`\n`
	writeFileSync(resolve(MD_OUT), md)
	console.log(`Frozen metadata-only universe: ${selected.map((item) => item.canonicalSymbol).join(', ')}`)
	console.log(`Window ${dataProtocol.utcWindow.startInclusive} .. ${dataProtocol.utcWindow.endExclusive}; freeze=${freezeHash}`)
}

await main()
