// forwardRunner.ts — чистый paper-forward боевого BATTLE_CONFIG.
//
// Важные гарантии v2:
// - журнал версионирован: разные версии стратегии не смешиваются;
// - сделка попадает в FORWARD только если её заявка (и нужный amend размера)
//   были известны раннеру ДО свечи fill;
// - carry-in/backfill сделки навсегда остаются backfill, даже если закрылись позже;
// - touch-fill имеет приоритет над bigbar свечи касания: close этой свечи
//   неизвестен в момент исполнения resting limit;
// - compactness median считается каузально по прошлым уникальным сеткам;
// - mirror-заявка создаётся после OTE fill и активна только со следующего бара.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { BINGX_MAKER_RATE, BINGX_SLIP_RATE, BINGX_TAKER_RATE } from '../../src/core/analysis/entryModels.js'
import { fillCostR } from '../../src/core/analysis/takeLadders.js'
import { BATTLE_CONFIG, canonRiskMultiplier, gridLevelPrice } from '../../src/strategy/battleConfig.js'
import { fetchCandlesPaginated, TF_MS } from '../shared/candleFetcher.js'
import type { FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'
import type { Candle } from '../../src/models/price/Candle.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../../tmp/forward')
const STATE_PATH = join(DATA_DIR, 'state.json')
const JOURNAL_PATH = join(DATA_DIR, 'signals.jsonl')
const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

export const FORWARD_VERSION = 'battle-7.50-first5-v4'
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT', 'ADA/USDT',
	'AVAX/USDT', 'LINK/USDT', 'SUI/USDT', 'TON/USDT', 'NEAR/USDT', 'APT/USDT', 'LTC/USDT']
const TIMEFRAMES = ['15m', '30m', '1h']
const WINDOW = 3000
const NOTIFY_MAX_AGE_MS = 2 * 3600_000

export interface RunnerState {
	version: string
	firstRunAt: string
	/** Все journal event id, Set строится на время цикла. */
	emitted: string[]
	/** Была ли исходная заявка создана уже в честном forward. */
	orderEligible: Record<string, boolean>
	/** Eligibility фиксируется на fill и наследуется outcome. */
	tradeEligible: Record<string, boolean>
}

export type ForwardStream = 'deep' | 'ote' | 'mirror'
export type ForwardEventType = 'setup' | 'amend' | 'cancel' | 'signal' | 'outcome'

export interface SignalEvent {
	version: string
	type: ForwardEventType
	id: string
	/** Стабильный id заявки; setup/amend/cancel/signal относятся к нему. */
	orderId: string
	/** Время рыночного события (ISO). */
	at: string
	/** Когда раннер фактически записал событие. */
	observedAt: string
	symbol: string
	timeframe: string
	stream: ForwardStream
	direction: 'long' | 'short'
	entry: number
	stop: number
	take: number
	riskMult: number
	/** Shadow-событие наблюдается, но не получает капитал. */
	shadow?: boolean
	/** Исследовательский multiplier до перевода потока в shadow. */
	suggestedRiskMult?: number
	/** true только если заявка и нужный размер существовали до fill. */
	forwardEligible?: boolean
	reason?: 'price-invalidated' | 'opposite-event' | 'bigbar-before-touch' | 'first-5-touch'
	result?: 'tp' | 'stop' | 'timestop'
	netR?: number
	holdBars?: number
}

type ReplayResult =
	| { status: 'pending' }
	| { status: 'cancelled'; cancelIndex: number | null }
	| { status: 'open'; fillIndex: number }
	| { status: 'done'; fillIndex: number; exitIndex: number; result: 'tp' | 'stop' | 'timestop'; netR: number }

export function createRunnerState(now = new Date()): RunnerState {
	return {
		version: FORWARD_VERSION,
		firstRunAt: now.toISOString(),
		emitted: [],
		orderEligible: {},
		tradeEligible: {},
	}
}

function loadState(): RunnerState {
	if (!existsSync(STATE_PATH)) return createRunnerState()
	const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<RunnerState>
	if (state.version !== FORWARD_VERSION) {
		throw new Error(
			`Старый forward state (${state.version ?? 'без версии'}). ` +
			`Сохраните/удалите tmp/forward и запустите заново; текущая версия: ${FORWARD_VERSION}`,
		)
	}
	if (!state.firstRunAt || !state.emitted || !state.orderEligible || !state.tradeEligible) {
		throw new Error('Повреждён tmp/forward/state.json — начните новый forward state')
	}
	return state as RunnerState
}

function saveState(state: RunnerState): void {
	mkdirSync(DATA_DIR, { recursive: true })
	// Для чистого долгого форварда id не обрезаем: иначе старые события после
	// сдвига replay-окна могут появиться повторно. 20k строк занимают мало.
	writeFileSync(STATE_PATH, JSON.stringify(state))
}

export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Каузальная rolling median: текущая сетка не входит в собственную median,
 * каждая candidateId учитывается ровно один раз, только прошлые 200 сеток.
 */
export function buildCausalMedianByCandidate(
	outcomes: readonly FibSetupOutcome[],
): Map<string, number | null> {
	const unique = new Map<string, { id: string; at: number; value: number | null }>()
	for (const o of outcomes) {
		if (o.scenario !== 'ote' && o.scenario !== 'deep') continue
		if (!unique.has(o.candidateId)) {
			unique.set(o.candidateId, { id: o.candidateId, at: o.createdAtIndex, value: o.legAtrRatio })
		}
	}
	const sorted = [...unique.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
	const past: number[] = []
	const result = new Map<string, number | null>()
	for (const item of sorted) {
		result.set(item.id, median(past))
		if (item.value != null) {
			past.push(item.value)
			if (past.length > 200) past.shift()
		}
	}
	return result
}

export function replayTrade(
	candles: Candle[],
	fromIndex: number,
	long: boolean,
	entry: number,
	stop: number,
	take: number,
	cancel: number | null,
	timeStopBars: number | null,
): ReplayResult {
	const risk = Math.abs(entry - stop)
	if (risk <= 0) return { status: 'cancelled', cancelIndex: null }
	let fillIndex = -1
	for (let i = Math.max(0, fromIndex); i < candles.length; i++) {
		const c = candles[i]!
		// Resting entry проверяется раньше cancel: если оба уровня в одной
		// OHLC-свече, точный путь неизвестен, но заявка уже существовала.
		if (long ? c.low <= entry : c.high >= entry) { fillIndex = i; break }
		if (cancel != null && (long ? c.high >= cancel : c.low <= cancel)) return { status: 'cancelled', cancelIndex: i }
	}
	if (fillIndex < 0) return { status: 'pending' }
	const net0 = -fillCostR(entry, BINGX_MAKER_RATE, 1, risk)
	for (let i = fillIndex; i < candles.length; i++) {
		const c = candles[i]!
		if (long ? c.low <= stop : c.high >= stop) {
			return { status: 'done', fillIndex, exitIndex: i, result: 'stop', netR: net0 - 1 - fillCostR(stop, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk) }
		}
		if (long ? c.high >= take : c.low <= take) {
			return { status: 'done', fillIndex, exitIndex: i, result: 'tp', netR: net0 + Math.abs(take - entry) / risk - fillCostR(take, BINGX_MAKER_RATE, 1, risk) }
		}
		if (timeStopBars != null && i - fillIndex >= timeStopBars) {
			const gross = (long ? c.close - entry : entry - c.close) / risk
			return { status: 'done', fillIndex, exitIndex: i, result: 'timestop', netR: net0 + gross - fillCostR(c.close, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk) }
		}
	}
	return { status: 'open', fillIndex }
}

function selectedCanonOutcomes(outcomes: readonly FibSetupOutcome[]): FibSetupOutcome[] {
	const seen = new Set<string>()
	const result: FibSetupOutcome[] = []
	for (const o of outcomes) {
		if (o.stopMode !== 'zero' || (o.scenario !== 'ote' && o.scenario !== 'deep')) continue
		const key = `${o.scenario}|${o.candidateId}`
		if (seen.has(key)) continue
		seen.add(key)
		result.push(o)
	}
	return result.sort((a, b) => a.createdAtIndex - b.createdAtIndex || a.candidateId.localeCompare(b.candidateId) || a.scenario.localeCompare(b.scenario))
}

function oppositeExpiryIndex(
	outcome: FibSetupOutcome,
	events: ReturnType<typeof runAnalysis>['events'],
): number | null {
	const opposite = outcome.direction === 'long' ? 'down' : 'up'
	for (const e of events) {
		if (e.confirmIndex > outcome.createdAtIndex && e.direction === opposite) return e.confirmIndex
	}
	return null
}

function riskRevisionId(orderId: string, freshBars: number): string {
	if (freshBars >= 16) return `amend16|${orderId}`
	if (freshBars >= 4) return `amend4|${orderId}`
	return `setup|${orderId}`
}

function eventTime(candles: Candle[], index: number): string {
	return new Date(candles[index]!.timestamp).toISOString()
}

/** Первый 5m touch внутри HTF-бара. null = LTF-окно не покрывает бар. */
export function firstLtfTouch(
	ltf: Candle[] | null,
	htfOpen: number,
	htfMs: number,
	long: boolean,
	entry: number,
): { offset: number; at: number } | null {
	if (!ltf) return null
	const bars = ltf.filter((c) => c.timestamp >= htfOpen && c.timestamp < htfOpen + htfMs)
	for (let i = 0; i < bars.length; i++) {
		const c = bars[i]!
		if (long ? c.low <= entry : c.high >= entry) return { offset: i, at: c.timestamp }
	}
	return null
}

/**
 * Один детерминированный replay symbol|tf. writeEvent отделён для тестов.
 */
export function processWindow(
	state: RunnerState,
	symbol: string,
	timeframe: string,
	candles: Candle[],
	writeEvent: (event: SignalEvent) => void = (event) => appendFileSync(JOURNAL_PATH, JSON.stringify(event) + '\n'),
	now: () => string = () => new Date().toISOString(),
	ltfCandles: Candle[] | null = null,
): SignalEvent[] {
	const emittedBeforeCycle = new Set(state.emitted)
	const emitted = new Set(state.emitted)
	const output: SignalEvent[] = []
	const snapshot = runAnalysis(candles)
	const candidates = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
	const outcomes = selectedCanonOutcomes(snapshot.fibLifecycle.outcomes)
	const medians = buildCausalMedianByCandidate(outcomes)
	const tfMs = TF_MS[timeframe]
	if (tfMs == null) throw new Error(`Unknown timeframe: ${timeframe}`)
	const firstRunMs = Date.parse(state.firstRunAt)

	const emit = (event: Omit<SignalEvent, 'version' | 'observedAt'>): boolean => {
		if (emitted.has(event.id)) return false
		const full: SignalEvent = { ...event, version: FORWARD_VERSION, observedAt: now() }
		emitted.add(full.id)
		state.emitted.push(full.id)
		writeEvent(full)
		output.push(full)
		return true
	}

	for (const outcome of outcomes) {
		const candidate = candidates.get(outcome.candidateId)
		const variant = candidate?.variants[outcome.variantMode]
		if (!candidate || !variant) continue
		const p0 = variant.levels.find((l) => l.ratio === 0)?.price
		const p100 = variant.levels.find((l) => l.ratio === 100)?.price
		if (p0 == null || p100 == null) continue
		const atL = (ratio: number): number => gridLevelPrice(p0, p100, ratio)
		const config = BATTLE_CONFIG.canon.find((c) => c.scenario === outcome.scenario)
		if (!config) continue
		const stream: 'ote' | 'deep' = config.scenario
		const long = outcome.direction === 'long'
		const created = outcome.createdAtIndex
		const createdBar = candles[created]
		if (!createdBar) continue
		const orderId = `${symbol}|${timeframe}|${outcome.scenario}|${createdBar.timestamp}|${outcome.direction}`
		const setupId = `setup|${orderId}`
		const med = medians.get(outcome.candidateId) ?? null
		const setupRisk = canonRiskMultiplier(1, outcome.legAtrRatio, med)
		const setupKnownAt = createdBar.timestamp + tfMs
		if (!(orderId in state.orderEligible)) state.orderEligible[orderId] = setupKnownAt >= firstRunMs
		emit({
			type: 'setup', id: setupId, orderId, at: new Date(setupKnownAt).toISOString(),
			symbol, timeframe, stream, direction: outcome.direction,
			entry: atL(config.entry), stop: atL(config.stop), take: atL(config.take), riskMult: Number(setupRisk.toFixed(2)),
			forwardEligible: state.orderEligible[orderId] === true,
		})

		const entryIndex = outcome.entered ? outcome.entryIndex : null
		const scanEnd = entryIndex != null ? entryIndex - 1 : candles.length - 1
		let cancelIndex: number | null = null
		let cancelReason: SignalEvent['reason']
		for (let i = created + 1; i <= scanEnd; i++) {
			const c = candles[i]
			if (!c) continue
			if (long ? c.low <= p0 : c.high >= p0) {
				cancelIndex = i
				cancelReason = 'price-invalidated'
				break
			}
			// Исполнимая bigbar-семантика: close бара можно использовать лишь
			// до touch. На touch-баре fill всегда важнее post-close bigbar.
			// Тело, перекрывшее входную зону, одновременно касается entry,
			// поэтому отдельной pre-touch отмены здесь обычно не возникает.
		}
		const expiry = oppositeExpiryIndex(outcome, snapshot.events)
		if (expiry != null && expiry <= scanEnd && (cancelIndex == null || expiry < cancelIndex)) {
			cancelIndex = expiry
			cancelReason = 'opposite-event'
		}

		if (cancelIndex != null) {
			emit({
				type: 'cancel', id: `cancel|${orderId}`, orderId, at: eventTime(candles, cancelIndex),
				symbol, timeframe, stream, direction: outcome.direction,
				entry: atL(config.entry), stop: atL(config.stop), take: atL(config.take), riskMult: 0, reason: cancelReason!,
				forwardEligible: state.orderEligible[orderId] === true,
			})
			continue
		}

		// Amend публикуется на close предыдущего бара, чтобы новый размер
		// существовал до потенциального fill на freshBars=4/16.
		for (const boundary of [4, 16] as const) {
			const priorIndex = created + boundary - 1
			if (priorIndex >= candles.length) continue
			if (entryIndex != null && entryIndex < boundary + created) continue
			const risk = canonRiskMultiplier(boundary, outcome.legAtrRatio, med)
			emit({
				type: 'amend', id: `amend${boundary}|${orderId}`, orderId,
				at: new Date(candles[priorIndex]!.timestamp + tfMs).toISOString(),
				symbol, timeframe, stream, direction: outcome.direction,
				entry: atL(config.entry), stop: atL(config.stop), take: atL(config.take), riskMult: Number(risk.toFixed(2)),
				forwardEligible: state.orderEligible[orderId] === true,
			})
		}

		if (entryIndex == null || outcome.entryPrice == null) continue
		const freshBars = entryIndex - created
		const riskMult = canonRiskMultiplier(freshBars, outcome.legAtrRatio, med)
		const requiredRevision = riskRevisionId(orderId, freshBars)
		const entry = atL(config.entry), stop = atL(config.stop), take = atL(config.take)
		const gateTouch = firstLtfTouch(ltfCandles, candles[entryIndex]!.timestamp, tfMs, long, entry)
		if (gateTouch?.offset === 0) {
			state.tradeEligible[orderId] = false
			emit({
				type: 'cancel', id: `cancel|${orderId}`, orderId, at: new Date(gateTouch.at).toISOString(),
				symbol, timeframe, stream, direction: outcome.direction,
				entry, stop, take, riskMult: 0, reason: 'first-5-touch', forwardEligible: false,
			})
			continue
		}
		// Без LTF-доказательства fill остаётся catch-up и не входит в clean forward.
		const gatePassed = gateTouch != null && gateTouch.offset >= BATTLE_CONFIG.entryGate.skipFirstBars
		const tradeEligible = state.orderEligible[orderId] === true && emittedBeforeCycle.has(requiredRevision) && gatePassed
		state.tradeEligible[orderId] = tradeEligible
		emit({
			type: 'signal', id: `signal|${orderId}`, orderId, at: eventTime(candles, entryIndex),
			symbol, timeframe, stream, direction: outcome.direction,
			entry, stop, take, riskMult: Number(riskMult.toFixed(2)), forwardEligible: tradeEligible,
		})
		const canon = replayTrade(candles, entryIndex, long, entry, stop, take, null, config.timeStopBars)
		if (canon.status === 'done') {
			emit({
				type: 'outcome', id: `outcome|${orderId}`, orderId, at: eventTime(candles, canon.exitIndex),
				symbol, timeframe, stream, direction: outcome.direction,
				entry, stop, take, riskMult: Number(riskMult.toFixed(2)), forwardEligible: tradeEligible,
				result: canon.result, netR: Number(canon.netR.toFixed(3)), holdBars: canon.exitIndex - canon.fillIndex,
			})
		}

	}
	return output
}

export interface ForwardReport {
	forwardOutcomes: SignalEvent[]
	backfillOutcomes: SignalEvent[]
	shadowOutcomes: SignalEvent[]
	shadowBackfill: SignalEvent[]
	pendingOrders: SignalEvent[]
	openTrades: SignalEvent[]
}

export function buildForwardReport(events: readonly SignalEvent[]): ForwardReport {
	const current = events.filter((e) => e.version === FORWARD_VERSION)
	const lastOrderEvent = new Map<string, SignalEvent>()
	const signals = new Map<string, SignalEvent>()
	const outcomes = new Map<string, SignalEvent>()
	for (const e of current) {
		if (e.type === 'setup' || e.type === 'amend' || e.type === 'cancel' || e.type === 'signal') lastOrderEvent.set(e.orderId, e)
		if (e.type === 'signal') signals.set(e.orderId, e)
		if (e.type === 'outcome') outcomes.set(e.orderId, e)
	}
	const closed = [...outcomes.values()]
	return {
		forwardOutcomes: closed.filter((e) => e.forwardEligible === true && e.shadow !== true),
		backfillOutcomes: closed.filter((e) => e.forwardEligible !== true && e.shadow !== true),
		shadowOutcomes: closed.filter((e) => e.forwardEligible === true && e.shadow === true),
		shadowBackfill: closed.filter((e) => e.forwardEligible !== true && e.shadow === true),
		pendingOrders: [...lastOrderEvent.values()].filter((e) =>
			(e.type === 'setup' || e.type === 'amend') && e.shadow !== true && e.forwardEligible === true && !signals.has(e.orderId)),
		openTrades: [...signals.values()].filter((e) => e.shadow !== true && e.forwardEligible === true && !outcomes.has(e.orderId)),
	}
}

function readJournal(): SignalEvent[] {
	if (!existsSync(JOURNAL_PATH)) return []
	const text = readFileSync(JOURNAL_PATH, 'utf8').trim()
	if (!text) return []
	return text.split('\n').map((line) => JSON.parse(line) as SignalEvent)
}

function durationText(fromIso: string): string {
	const ms = Math.max(0, Date.now() - Date.parse(fromIso))
	const hours = Math.floor(ms / 3_600_000)
	const minutes = Math.floor((ms % 3_600_000) / 60_000)
	return `${hours}ч ${minutes}м`
}

function printStreamStats(pool: SignalEvent[]): void {
	for (const stream of ['deep', 'ote'] as const) {
		const rows = pool.filter((e) => e.stream === stream)
		if (rows.length === 0) continue
		const total = rows.reduce((sum, e) => sum + (e.netR ?? 0), 0)
		const weighted = rows.reduce((sum, e) => sum + (e.netR ?? 0) * e.riskMult, 0)
		const wins = rows.filter((e) => (e.netR ?? 0) > 0).length
		console.log(`  ${stream.padEnd(6)} n=${String(rows.length).padStart(3)} | total=${total.toFixed(1)}R | avg=${(total / rows.length).toFixed(3)}R (бенч. ${BATTLE_CONFIG.benchmarks[stream].toFixed(3)}) | WR=${(100 * wins / rows.length).toFixed(1)}% | weighted=${weighted.toFixed(1)}R`)
	}
}

function printReport(): void {
	const state = loadState()
	const events = readJournal()
	const report = buildForwardReport(events)
	console.log('=== FORWARD STATUS ===')
	console.log(`версия: ${FORWARD_VERSION}`)
	console.log(`старт:  ${state.firstRunAt}`)
	console.log(`работает: ${durationText(state.firstRunAt)}`)
	console.log(`ожидают входа: ${report.pendingOrders.length} | открытых позиций: ${report.openTrades.length}`)
	console.log(`боевых закрытых: ${report.forwardOutcomes.length} | backfill: ${report.backfillOutcomes.length}`)
	console.log('\n=== ЧИСТЫЙ БОЕВОЙ FORWARD (Deep + OTE) ===')
	if (report.forwardOutcomes.length === 0) console.log('  пока нет закрытых сделок')
	else printStreamStats(report.forwardOutcomes)
	console.log('\n=== BACKFILL / ПРОПУЩЕННЫЕ ПРИ ПРОСТОЕ (не входят в forward) ===')
	if (report.backfillOutcomes.length === 0) console.log('  нет')
	else printStreamStats(report.backfillOutcomes)
	if (report.openTrades.length > 0) {
		console.log('\n=== ОТКРЫТЫЕ ПОЗИЦИИ ===')
		for (const e of report.openTrades) console.log(`  ${e.stream} ${e.direction} ${e.symbol} ${e.timeframe} @ ${e.entry} risk x${e.riskMult}`)
	}
	if (report.pendingOrders.length > 0) {
		console.log('\n=== ОЖИДАЮТ ВХОДА ===')
		for (const e of report.pendingOrders.slice(-30)) console.log(`  ${e.stream} ${e.direction} ${e.symbol} ${e.timeframe} @ ${e.entry} risk x${e.riskMult}`)
		if (report.pendingOrders.length > 30) console.log(`  ... ещё ${report.pendingOrders.length - 30}`)
	}
	console.log('\nПримечание: weighted R использует raw riskMult и пока не является портфельным PnL.')
}

async function notifyTelegram(events: SignalEvent[]): Promise<void> {
	const token = process.env.TELEGRAM_BOT_TOKEN
	const chatId = process.env.TELEGRAM_CHAT_ID
	if (!token || !chatId) return
	const now = Date.now()
	const fresh = events.filter((e) => now - Date.parse(e.at) < NOTIFY_MAX_AGE_MS)
	for (const e of fresh) {
		const arrow = e.direction === 'long' ? 'LONG' : 'SHORT'
		let text: string
		if (e.shadow) {
			text = `SHADOW ${e.type.toUpperCase()} MIRROR ${arrow}\n${e.symbol} ${e.timeframe}\nentry ${e.entry} / stop ${e.stop} / take ${e.take}` +
				(e.netR != null ? `\nрезультат ${e.netR.toFixed(2)}R` : '') + '\nНЕ ТОРГОВАТЬ — риск 0'
		} else switch (e.type) {
			case 'setup': text = `SETUP ${e.stream} ${arrow}\n${e.symbol} ${e.timeframe}\nлимит ${e.entry}\nстоп ${e.stop}\nтейк ${e.take}\nриск x${e.riskMult}\nFIRST-5 GATE: первые 5m каждого ${e.timeframe}-бара заявка выключена`; break
			case 'amend': text = `AMEND ${e.stream} ${arrow}\n${e.symbol} ${e.timeframe}\nизмени размер заявки: риск x${e.riskMult}`; break
			case 'cancel': text = `CANCEL ${e.stream} ${arrow}\n${e.symbol} ${e.timeframe}\nсними лимит ${e.entry}\nпричина: ${e.reason}`; break
			case 'signal': text = `FILL ${e.stream} ${arrow}\n${e.symbol} ${e.timeframe}\nвход ${e.entry}\nстоп ${e.stop}\nтейк ${e.take}\nриск x${e.riskMult}\nforward: ${e.forwardEligible ? 'да' : 'нет (catch-up)'}`; break
			default: text = `RESULT ${e.stream} ${arrow}\n${e.symbol} ${e.timeframe}\n${e.result} ${e.netR!.toFixed(2)}R (${e.holdBars} bars)\nforward: ${e.forwardEligible ? 'да' : 'нет'}`
		}
		try {
			await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }),
			})
		} catch (error) {
			console.error('[telegram]', (error as Error).message)
		}
	}
}

async function cycle(state: RunnerState, fixture: boolean): Promise<void> {
	const all: SignalEvent[] = []
	if (fixture) {
		const candles = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Candle[]
		all.push(...processWindow(state, 'BTC/USDT', '15m', candles))
	} else {
		for (const symbol of SYMBOLS) {
			let ltf: Candle[]
			try {
				const ltfMs = TF_MS[BATTLE_CONFIG.entryGate.timeframe]!
				ltf = (await fetchCandlesPaginated(symbol, BATTLE_CONFIG.entryGate.timeframe, 500, 'futures'))
					.filter((c) => c.timestamp + ltfMs <= Date.now())
			} catch (error) {
				console.error(`[${symbol} 5m]`, (error as Error).message)
				continue
			}
			for (const timeframe of TIMEFRAMES) {
				try {
					const candles = await fetchCandlesPaginated(symbol, timeframe, WINDOW, 'futures')
					const tfMs = TF_MS[timeframe]!
					all.push(...processWindow(state, symbol, timeframe,
						candles.filter((c) => c.timestamp + tfMs <= Date.now()), undefined, undefined, ltf))
				} catch (error) {
					console.error(`[${symbol} ${timeframe}]`, (error as Error).message)
				}
			}
		}
	}
	saveState(state)
	if (all.length > 0) {
		console.log(`${new Date().toISOString()} новых событий: ${all.length}`)
		for (const e of all) console.log(`  ${e.type.padEnd(7)} ${e.stream.padEnd(6)} ${e.direction.padEnd(5)} ${e.symbol} ${e.timeframe}${e.netR != null ? ` ${e.netR}R` : ''}${e.shadow ? ' [SHADOW]' : ''}${e.forwardEligible === false ? ' [backfill]' : ''}`)
	}
	await notifyTelegram(all)
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2)
	if (argv.includes('--report')) { printReport(); return }
	mkdirSync(DATA_DIR, { recursive: true })
	const fixture = argv.includes('--fixture')
	const state = loadState()
	await cycle(state, fixture)
	if (argv.includes('--once') || fixture) { printReport(); return }
	const intervalMs = TF_MS[BATTLE_CONFIG.entryGate.timeframe]!
	console.log(`форвард запущен: версия ${FORWARD_VERSION}, ${SYMBOLS.length} монет × ${TIMEFRAMES.join('/')}, цикл 5m, first-5 gate включён`)
	for (;;) {
		const now = Date.now()
		const next = Math.floor(now / intervalMs) * intervalMs + intervalMs + 10_000
		await new Promise((done) => setTimeout(done, next - now))
		await cycle(state, false)
	}
}

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
	main().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
