// forwardRunner.ts — форвард-тест боевого конфига (SPEC 12).
//
// Торговля «на бумаге»: тянет закрытые свечи Binance USDT-M futures,
// строит сетки тем же пайплайном, что и бэктест (runAnalysis), находит
// сетапы СТРОГО по battleConfig и пишет сигналы/исходы в JSONL-журнал.
// Ни одного ордера не ставит — только записывает предсказания до исхода.
//
// Архитектура (стейтлес-реплей): каждый цикл окно последних N свечей
// пересчитывается детерминированно; событие (сигнал/исход) эмитится в
// журнал, только если его id ещё не эмитился (Set в state). Это даёт
// бесплатный catch-up: выключил ноут — при следующем запуске окно
// доигрывается с того же места, ничего не теряется.
//
// Потоки (все параметры из battleConfig, дублировать константы нельзя):
//   canon deep/ote: touch-вход, стоп/тейк по ratio, bigbar-фильтр,
//     тайм-стоп 20 баров (ote), сайзинг canonRiskMultiplier (медиана
//     swing/ATR — скользящая по последним 200 сеткам symbol|tf).
//   reverse mirror/fade141 (только ote-сетки, после канон-входа ote):
//     mirror-лимитка на 100 с бара канон-входа, fade-лимитка на 141 с
//     бара создания сетки; first-fill-wins, отмена за 0.
//
// Телеграм (опционально): TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID в env —
// уведомление о каждом свежем событии (не старше 2ч; catch-up молчит,
// чтобы не спамить историей). Пользователь оценивает сетап на TV и
// решает сам — раннер только информирует.
//
// Запуск:
//   npm run forward            — вечный цикл (интервал = младший ТФ)
//   npm run forward -- --once  — один проход и выход
//   npm run forward -- --report — сводка по журналу
//   npm run forward -- --fixture — смоук на локальной фикстуре

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { bigbarCovered, BINGX_MAKER_RATE, BINGX_SLIP_RATE, BINGX_TAKER_RATE } from '../../src/core/analysis/entryModels.js'
import { fillCostR } from '../../src/core/analysis/takeLadders.js'
import { BATTLE_CONFIG, canonRiskMultiplier, gridLevelPrice, reverseRiskMultiplier } from '../../src/strategy/battleConfig.js'
import { fetchCandlesPaginated, TF_MS } from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../../tmp/forward')
const STATE_PATH = join(DATA_DIR, 'state.json')
const JOURNAL_PATH = join(DATA_DIR, 'signals.jsonl')
const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT', 'ADA/USDT',
	'AVAX/USDT', 'LINK/USDT', 'SUI/USDT', 'TON/USDT', 'NEAR/USDT', 'APT/USDT', 'LTC/USDT']
const TIMEFRAMES = ['15m', '30m', '1h']
/** Окно реплея: достаточно для структуры + катч-ап нескольких дней. */
const WINDOW = 3000
/** События старше этого срока не шлются в Telegram (catch-up тишина). */
const NOTIFY_MAX_AGE_MS = 2 * 3600_000

const ENTRY_ZONES: Record<string, [number, number]> = { ote: [61.8, 78.6], deep: [23.6, 38.2] }

interface RunnerState {
	/** id уже эмитированных событий (кап 20000, FIFO). */
	emitted: string[]
	/** Скользящий пул swing/ATR последних сеток per symbol|tf (кап 200). */
	swingPool: Record<string, number[]>
	/**
	 * ISO-время первого запуска. События с барами ДО этого момента —
	 * бэкфилл (мини-бэктест окна), ПОСЛЕ — честный форвард. Отчёт
	 * разделяет эти пулы: в зачёт форварда идёт только второй.
	 */
	firstRunAt?: string
}

interface SignalEvent {
	type: 'signal' | 'outcome'
	id: string
	at: string
	symbol: string
	timeframe: string
	stream: 'deep' | 'ote' | 'mirror' | 'fade141'
	direction: 'long' | 'short'
	entry: number
	stop: number
	take: number
	riskMult: number
	/** outcome-поля */
	result?: 'tp' | 'stop' | 'timestop'
	netR?: number
	holdBars?: number
}

function loadState(): RunnerState {
	const state: RunnerState = existsSync(STATE_PATH)
		? (JSON.parse(readFileSync(STATE_PATH, 'utf8')) as RunnerState)
		: { emitted: [], swingPool: {} }
	// Миграция стейтов до firstRunAt: считаем форвардом всё с этого момента.
	if (state.firstRunAt == null) state.firstRunAt = new Date().toISOString()
	return state
}

function saveState(state: RunnerState): void {
	mkdirSync(DATA_DIR, { recursive: true })
	if (state.emitted.length > 20000) state.emitted = state.emitted.slice(-20000)
	writeFileSync(STATE_PATH, JSON.stringify(state))
}

function median(values: number[]): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Реплей одной виртуальной сделки: лимитка на entry с fromIndex, отмена за
 * cancel до филла, потом стоп/тейк (+опц. тайм-стоп по close). Косты BingX:
 * вход/тейк maker, стоп и тайм-стоп taker+slip. Конвенция конфликтного бара
 * пессимистичная (как в бэктесте): стоп раньше тейка.
 */
function replayTrade(
	candles: Candle[],
	fromIndex: number,
	long: boolean,
	entry: number,
	stop: number,
	take: number,
	cancel: number | null,
	timeStopBars: number | null,
): { status: 'open' | 'cancelled' | 'pending'; fillIndex?: number } | { status: 'done'; fillIndex: number; exitIndex: number; result: 'tp' | 'stop' | 'timestop'; netR: number } {
	const risk = Math.abs(entry - stop)
	if (risk <= 0) return { status: 'cancelled' }
	let fillIndex = -1
	for (let i = fromIndex; i < candles.length; i++) {
		const c = candles[i]!
		if (long ? c.low <= entry : c.high >= entry) { fillIndex = i; break }
		if (cancel != null && (long ? c.high >= cancel : c.low <= cancel)) return { status: 'cancelled' }
	}
	if (fillIndex < 0) return { status: 'pending' }
	const net0 = -fillCostR(entry, BINGX_MAKER_RATE, 1, risk)
	for (let i = fillIndex; i < candles.length; i++) {
		const c = candles[i]!
		if (long ? c.low <= stop : c.high >= stop)
			return { status: 'done', fillIndex, exitIndex: i, result: 'stop', netR: net0 - 1 - fillCostR(stop, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk) }
		if (long ? c.high >= take : c.low <= take)
			return { status: 'done', fillIndex, exitIndex: i, result: 'tp', netR: net0 + Math.abs(take - entry) / risk - fillCostR(take, BINGX_MAKER_RATE, 1, risk) }
		if (timeStopBars != null && i - fillIndex >= timeStopBars) {
			const gross = (long ? c.close - entry : entry - c.close) / risk
			return { status: 'done', fillIndex, exitIndex: i, result: 'timestop', netR: net0 + gross - fillCostR(c.close, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk) }
		}
	}
	return { status: 'open', fillIndex }
}

async function notifyTelegram(events: SignalEvent[]): Promise<void> {
	const token = process.env.TELEGRAM_BOT_TOKEN
	const chatId = process.env.TELEGRAM_CHAT_ID
	if (!token || !chatId || events.length === 0) return
	const now = Date.now()
	const fresh = events.filter((e) => now - Date.parse(e.at) < NOTIFY_MAX_AGE_MS)
	for (const e of fresh) {
		const arrow = e.direction === 'long' ? 'LONG' : 'SHORT'
		const text = e.type === 'signal'
			? `SIGNAL ${e.stream} ${arrow}\n${e.symbol} ${e.timeframe}\nentry ${e.entry}\nstop ${e.stop}\ntake ${e.take}\nrisk x${e.riskMult}`
			: `RESULT ${e.stream} ${arrow} ${e.symbol} ${e.timeframe}\n${e.result} ${e.netR!.toFixed(2)}R (${e.holdBars} bars)`
		try {
			await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chat_id: chatId, text }),
			})
		} catch (err) {
			console.error('[telegram]', (err as Error).message)
		}
	}
}

/** Один проход по одному symbol|tf: реплей окна, эмиссия новых событий. */
function processWindow(
	state: RunnerState,
	symbol: string,
	timeframe: string,
	candles: Candle[],
): SignalEvent[] {
	const events: SignalEvent[] = []
	const snapshot = runAnalysis(candles)
	const poolKey = `${symbol}|${timeframe}`
	const swingPool = state.swingPool[poolKey] ?? (state.swingPool[poolKey] = [])
	const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
	const emit = (e: SignalEvent): void => {
		if (state.emitted.includes(e.id)) return
		state.emitted.push(e.id)
		appendFileSync(JOURNAL_PATH, JSON.stringify(e) + '\n')
		events.push(e)
	}

	// Один исход на сетку×сценарий (как seenGrids в eval-entry).
	const seenGrids = new Set<string>()
	for (const outcome of snapshot.fibLifecycle.outcomes) {
		if (!outcome.entered || outcome.entryIndex == null || outcome.entryPrice == null) continue
		if (outcome.stopMode !== 'zero') continue
		if (outcome.scenario !== 'ote' && outcome.scenario !== 'deep') continue
		const gridKey = `${outcome.scenario}|${outcome.candidateId}`
		if (seenGrids.has(gridKey)) continue
		seenGrids.add(gridKey)

		const variant = candidateById.get(outcome.candidateId)?.variants[outcome.variantMode]
		if (!variant) continue
		const p0 = variant.levels.find((l) => l.ratio === 0)?.price
		const p100 = variant.levels.find((l) => l.ratio === 100)?.price
		if (p0 == null || p100 == null) continue
		const atL = (ratio: number): number => gridLevelPrice(p0, p100, ratio)
		const zone = ENTRY_ZONES[outcome.scenario]!
		// bigbar-фильтр канона (BATTLE_CONFIG.bigbarFilter).
		if (BATTLE_CONFIG.bigbarFilter &&
			bigbarCovered(snapshot.candles, outcome.createdAtIndex, outcome.entryIndex + 1, atL(zone[0]), atL(zone[1]))) continue

		const setup = BATTLE_CONFIG.canon.find((c) => c.scenario === outcome.scenario)!
		const long = outcome.direction === 'long'
		const entryBar = snapshot.candles[outcome.entryIndex]!
		const gridId = `${symbol}|${timeframe}|${outcome.scenario}|${entryBar.timestamp}|${outcome.direction}`

		// Сайзинг: свежесть + компактность против скользящей медианы пула.
		const med = median(swingPool)
		const mult = canonRiskMultiplier(outcome.entryIndex - outcome.createdAtIndex, outcome.legAtrRatio, med)
		if (outcome.legAtrRatio != null) {
			swingPool.push(outcome.legAtrRatio)
			if (swingPool.length > 200) swingPool.shift()
		}

		const entryP = atL(setup.entry)
		const stopP = atL(setup.stop)
		const takeP = atL(setup.take)
		emit({
			type: 'signal', id: `sig|${gridId}`, at: new Date(entryBar.timestamp).toISOString(),
			symbol, timeframe, stream: outcome.scenario, direction: outcome.direction,
			entry: entryP, stop: stopP, take: takeP, riskMult: Number(mult.toFixed(2)),
		})
		const canon = replayTrade(snapshot.candles, outcome.entryIndex, long, entryP, stopP, takeP, null, setup.timeStopBars)
		if (canon.status === 'done') {
			emit({
				type: 'outcome', id: `out|${gridId}`, at: new Date(snapshot.candles[canon.exitIndex]!.timestamp).toISOString(),
				symbol, timeframe, stream: outcome.scenario, direction: outcome.direction,
				entry: entryP, stop: stopP, take: takeP, riskMult: Number(mult.toFixed(2)),
				result: canon.result, netR: Number(canon.netR.toFixed(3)), holdBars: canon.exitIndex - canon.fillIndex,
			})
		}

		// Реверс-поток: только ote-сетки, после канон-входа (SPEC 7.37/7.38).
		if (outcome.scenario !== 'ote') continue
		const revLong = !long
		const [mirrorCfg, fadeCfg] = [BATTLE_CONFIG.reverse[0]!, BATTLE_CONFIG.reverse[1]!]
		const mirror = replayTrade(snapshot.candles, outcome.entryIndex, revLong,
			atL(mirrorCfg.entry), atL(mirrorCfg.stop), atL(mirrorCfg.take), atL(mirrorCfg.cancelBeyond), null)
		const fade = replayTrade(snapshot.candles, outcome.createdAtIndex + 1, revLong,
			atL(fadeCfg.entry), atL(fadeCfg.stop), atL(fadeCfg.take), atL(fadeCfg.cancelBeyond), null)
		// first-fill-wins: побеждает более ранний филл.
		const mFill = 'fillIndex' in mirror && mirror.fillIndex != null ? mirror.fillIndex : Infinity
		const fFill = 'fillIndex' in fade && fade.fillIndex != null ? fade.fillIndex : Infinity
		if (mFill === Infinity && fFill === Infinity) continue
		const winner = mFill <= fFill
			? { cfg: mirrorCfg, res: mirror, stream: 'mirror' as const }
			: { cfg: fadeCfg, res: fade, stream: 'fade141' as const }
		const res = winner.res
		if (res.status !== 'done' && res.status !== 'open') continue
		const fillBar = snapshot.candles[res.fillIndex!]!
		// SPEC 7.44: сайзинг реверса — свежесть канон-касания. Если реверс
		// зафиллился ДО канон-входа (fade раньше отката), свежесть на тот
		// момент неизвестна — флэт 1.0 (look-ahead исключён).
		const revFresh = res.fillIndex! >= outcome.entryIndex ? outcome.entryIndex - outcome.createdAtIndex : null
		const revMult = reverseRiskMultiplier(revFresh)
		emit({
			type: 'signal', id: `sig|rev|${gridId}`, at: new Date(fillBar.timestamp).toISOString(),
			symbol, timeframe, stream: winner.stream, direction: revLong ? 'long' : 'short',
			entry: atL(winner.cfg.entry), stop: atL(winner.cfg.stop), take: atL(winner.cfg.take),
			riskMult: revMult,
		})
		if (res.status === 'done') {
			emit({
				type: 'outcome', id: `out|rev|${gridId}`, at: new Date(snapshot.candles[res.exitIndex]!.timestamp).toISOString(),
				symbol, timeframe, stream: winner.stream, direction: revLong ? 'long' : 'short',
				entry: atL(winner.cfg.entry), stop: atL(winner.cfg.stop), take: atL(winner.cfg.take),
				riskMult: revMult,
				result: res.result, netR: Number(res.netR.toFixed(3)), holdBars: res.exitIndex - res.fillIndex,
			})
		}
	}
	return events
}

function printReport(): void {
	if (!existsSync(JOURNAL_PATH)) { console.log('журнал пуст'); return }
	const lines = readFileSync(JOURNAL_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as SignalEvent)
	const outcomes = lines.filter((e) => e.type === 'outcome')
	const signals = lines.filter((e) => e.type === 'signal')
	const firstRunAt = loadState().firstRunAt!
	console.log(`сигналов: ${signals.length}, исходов: ${outcomes.length}, открыто: ${signals.length - outcomes.length}`)
	console.log(`граница форварда (первый запуск): ${firstRunAt}`)
	const expected: Record<string, number> = { deep: 0.358, ote: 0.244, mirror: 0.347, fade141: 0.347 }
	const pools: [string, SignalEvent[]][] = [
		['BACKFILL (окно до первого запуска — мини-бэктест, НЕ форвард)', outcomes.filter((e) => e.at < firstRunAt)],
		['FORWARD (после первого запуска — честный зачёт)', outcomes.filter((e) => e.at >= firstRunAt)],
	]
	for (const [title, pool] of pools) {
		console.log(`\n=== ${title} ===`)
		if (pool.length === 0) { console.log('  пусто'); continue }
		for (const stream of ['deep', 'ote', 'mirror', 'fade141']) {
			const g = pool.filter((e) => e.stream === stream)
			if (g.length === 0) continue
			const total = g.reduce((a, e) => a + e.netR!, 0)
			const wr = (100 * g.filter((e) => e.netR! > 0).length) / g.length
			const wTotal = g.reduce((a, e) => a + e.netR! * e.riskMult, 0)
			console.log(`  ${stream.padEnd(8)}: n ${g.length}, totalR ${total.toFixed(1)}, avgR ${(total / g.length).toFixed(3)} (ожид. ${expected[stream]!.toFixed(3)}), WR ${wr.toFixed(1)}% | weighted totalR ${wTotal.toFixed(1)}`)
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
			for (const timeframe of TIMEFRAMES) {
				try {
					const candles = await fetchCandlesPaginated(symbol, timeframe, WINDOW, 'futures')
					// Отбрасываем незакрытую последнюю свечу.
					const tfMs = TF_MS[timeframe]!
					const closed = candles.filter((c) => c.timestamp + tfMs <= Date.now())
					all.push(...processWindow(state, symbol, timeframe, closed))
				} catch (err) {
					console.error(`[${symbol} ${timeframe}]`, (err as Error).message)
				}
			}
		}
	}
	saveState(state)
	if (all.length > 0) {
		console.log(`${new Date().toISOString()} новых событий: ${all.length}`)
		for (const e of all) console.log(`  ${e.type} ${e.stream} ${e.direction} ${e.symbol} ${e.timeframe}${e.netR != null ? ` ${e.netR}R` : ''}`)
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
	const intervalMs = TF_MS['15m']!
	console.log(`форвард-раннер запущен: ${SYMBOLS.length} монет × ${TIMEFRAMES.join('/')}, цикл каждые 15m`)
	// Тик — на закрытии 15m-бара + 10s буфер на публикацию свечи биржей.
	for (;;) {
		const now = Date.now()
		const next = Math.floor(now / intervalMs) * intervalMs + intervalMs + 10_000
		await new Promise((r) => setTimeout(r, next - now))
		await cycle(state, false)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
