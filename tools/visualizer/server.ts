// server.ts
//
// Мини-сервер визуализатора на голом Node http (без новых backend-зависимостей).
// Отдаёт статический HTML/JS из public/ и endpoint /api/analyze.
// НЕ часть пайплайна — измерительный инструмент (см. SPEC, раздел визуализатора).
//
// Переработан под текущий канон (SPEC 7.22–7.24, 15.07.2026):
//   - сделки = пул ote+deep, стоп zero, regime-фильтр, дедуп по сетке —
//     та же логика, что --eval-entry в runBatch;
//   - три модели входа (touch / closeConfirm / candleConfirm) с костами
//     BingX и выходами t100-only — из src/core/analysis/entryModels.ts;
//   - bigbar-метка (тело одной свечи перекрыло входную зону);
//   - старые слои A/B-пробников и cooldown-комбо УДАЛЕНЫ из ответа:
//     они относились к закрытым исследованиям (SPEC 7.19 и раньше).
//
// Запуск: npx tsx tools/visualizer/server.ts
// Открыть: http://localhost:7788

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, resolve } from 'node:path'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { detectRefinedPoi, REFINED_POI_VERSION } from '../../src/core/confirmation/RefinedPoiEngine.js'
import { detectLiquidityPoi, LIQUIDITY_POI_VERSION } from '../../src/core/confirmation/LiquidityPoiCalibration.js'
import { detectLiquidityHeatmap, LIQUIDITY_HEATMAP_VERSION } from '../../src/core/liquidity/LiquidityHeatmapEngine.js'
import { bigbarCovered } from '../../src/core/analysis/entryModels.js'
import { BATTLE_CONFIG, canonRiskMultiplier, gridLevelPrice } from '../../src/strategy/battleConfig.js'
import { buildCausalMedianByCandidate, firstLtfTouch, FORWARD_VERSION, replayTrade } from '../forward/forwardRunner.js'
import { aggregateCandles, fetchCandlesPaginated, MAX_CANDLES_LTF, TF_MS } from '../shared/candleFetcher.js'
import { plannedFullStop } from '../shared/executionCostGate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, 'public')
const PORT = 7788

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
}

interface AnalyzeQuery {
	symbol?: string | undefined
	timeframe?: string | undefined
	limit?: string | undefined
	source?: string | undefined
	market?: string | undefined
	until?: string | undefined
	contextTf?: string | undefined
	historyBars?: string | undefined
}

function parseQuery(qs: string): AnalyzeQuery {
	const params = new URLSearchParams(qs)
	return {
		symbol: params.get('symbol') ?? undefined,
		timeframe: params.get('timeframe') ?? undefined,
		limit: params.get('limit') ?? undefined,
		source: params.get('source') ?? undefined,
		market: params.get('market') ?? undefined,
		until: params.get('until') ?? undefined,
		contextTf: params.get('contextTf') ?? undefined,
		historyBars: params.get('historyBars') ?? undefined,
	}
}

const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

/** Фикстура читается из файла — воспроизводимость без похода на биржу. */
function loadFixtureCandles(): import('../../src/models/price/Candle.js').Candle[] {
	return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
	const body = JSON.stringify(data)
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
	res.end(body)
}

/** Кэш списка символов: топ по объёму меняется медленно, час — достаточно. */
let symbolsCache: { symbols: string[]; fetchedAt: number } | null = null
const SYMBOLS_CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Топ-100 USDT-пар по суточному объёму с Binance USDT-M futures.
 * Публичный endpoint, без API-ключей.
 */
async function fetchTopSymbols(): Promise<string[]> {
	if (symbolsCache && Date.now() - symbolsCache.fetchedAt < SYMBOLS_CACHE_TTL_MS) {
		return symbolsCache.symbols
	}
	const { default: ccxt } = await import('ccxt')
	let tickers
	try {
		tickers = await new ccxt.binanceusdm().fetchTickers()
	} catch {
		tickers = await new ccxt.binance().fetchTickers()
	}
	const symbols = Object.values(tickers)
		.filter((t) => t.symbol?.endsWith('/USDT:USDT') || t.symbol?.endsWith('/USDT'))
		.map((t) => ({
			symbol: (t.symbol ?? '').replace(':USDT', ''),
			volume: Number(t.quoteVolume ?? 0),
		}))
		.filter((t) => t.symbol && t.volume > 0)
		.sort((a, b) => b.volume - a.volume)
		.slice(0, 100)
		.map((t) => t.symbol)
	symbolsCache = { symbols, fetchedAt: Date.now() }
	return symbols
}

/** Bigbar остаётся диагностической меткой, а не фильтром. */
const ENTRY_ZONES: Record<'ote' | 'deep', readonly [number, number]> = {
	ote: [61.8, 78.6],
	deep: [23.6, 38.2],
}

function buildTrades(snapshot: ReturnType<typeof runAnalysis>, ltf5m: import('../../src/models/price/Candle.js').Candle[] | null, htfMs: number) {
	const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
	const seen = new Set<string>()
	const canonOutcomes = snapshot.fibLifecycle.outcomes
		.filter((o) => o.stopMode === 'zero' && (o.scenario === 'ote' || o.scenario === 'deep'))
		.filter((o) => {
			const key = `${o.scenario}|${o.candidateId}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	const medians = buildCausalMedianByCandidate(canonOutcomes)
	const trades: Record<string, unknown>[] = []

	for (const outcome of canonOutcomes) {
		if (!outcome.entered || outcome.entryIndex == null) continue
		const scenario = outcome.scenario as 'ote' | 'deep'
		const config = BATTLE_CONFIG.canon.find((x) => x.scenario === scenario)
		const candidate = candidateById.get(outcome.candidateId)
		const variant = candidate?.variants[outcome.variantMode]
		if (!config || !candidate || !variant) continue
		const p0 = variant.levels.find((l) => l.ratio === 0)?.price
		const p100 = variant.levels.find((l) => l.ratio === 100)?.price
		if (p0 == null || p100 == null) continue
		const at = (ratio: number): number => gridLevelPrice(p0, p100, ratio)
		const entry = at(config.entry), stop = at(config.stop), take = at(config.take)
		const long = outcome.direction === 'long'
		const replay = replayTrade(snapshot.candles, outcome.entryIndex, long, entry, stop, take, null, config.timeStopBars)
		if (replay.status !== 'open' && replay.status !== 'done') continue
		const bigbar = bigbarCovered(snapshot.candles, outcome.createdAtIndex, outcome.entryIndex + 1,
			at(ENTRY_ZONES[scenario][0]), at(ENTRY_ZONES[scenario][1]))
		const freshBars = outcome.entryIndex - outcome.createdAtIndex
		const riskMult = canonRiskMultiplier(freshBars, outcome.legAtrRatio, medians.get(outcome.candidateId) ?? null)
		const gateTouch = firstLtfTouch(ltf5m, snapshot.candles[outcome.entryIndex]!.timestamp, htfMs, long, entry)
		const first5Skipped = gateTouch?.offset === 0
		const id = `${scenario}|${outcome.candidateId}`
		const plannedStop = plannedFullStop(entry, stop)
		const executionCostSkipped = BATTLE_CONFIG.executionCostGate.enabled && plannedStop.netR < -BATTLE_CONFIG.executionCostGate.maxFullStopLossR
		const exitIndex = replay.status === 'done' ? replay.exitIndex : null
		const exitPrice = replay.status === 'done'
			? replay.result === 'stop' ? stop : replay.result === 'tp' ? take : snapshot.candles[replay.exitIndex]?.close ?? null
			: null
		trades.push({
			id, parentId: id, candidateId: outcome.candidateId,
			stream: scenario, scenario, shadow: false,
			direction: outcome.direction, trigger: outcome.trigger,
			createdAtIndex: outcome.createdAtIndex, entryIndex: replay.fillIndex,
			exitIndex, entry, stop, take, exitPrice,
			entryRatio: config.entry, stopRatio: config.stop, takeRatio: config.take,
			stopPct: plannedStop.stopPct, fullStopNetR: plannedStop.netR, costRAtStop: plannedStop.costR,
			result: first5Skipped ? 'first5-skip' : executionCostSkipped ? 'cost-skip' : replay.status === 'done' ? replay.result : 'open',
			/** netR остаётся counterfactual для анализа пропущенного среза. */
			netR: replay.status === 'done' ? replay.netR : null,
			holdBars: replay.status === 'done' ? replay.exitIndex - replay.fillIndex : null,
			riskMult: first5Skipped || executionCostSkipped ? 0 : Number(riskMult.toFixed(2)), freshBars,
			first5Skipped, executionCostSkipped, first5TouchAt: gateTouch?.at ?? null,
			bigbarDiagnostic: bigbar,
			gridLevels: variant.levels.map((l) => ({ ratio: l.ratio, price: l.price })),
			legStart: { index: variant.start.index, price: variant.start.price },
			legEnd: { index: candidate.end.index, price: candidate.end.price },
		})

	}
	return trades
}

/**
 * Кандидаты ручного Decision Lab: первое касание 141/200/241 только пока
 * сетка относится к текущей структуре своего TF.
 *
 * Исторический FibGridCandidate сам по себе не означает «активную сетку»:
 * snapshot хранит архив для бэктеста. Поэтому до touch каузально исключаем:
 * - сетку, после которой уже подтвердилось противоположное событие;
 * - сетку, которую заменила более новая сетка того же направления.
 * Возраст не скрывается: UI отдельно фильтрует ageBars (по умолчанию 200
 * HTF-баров), не меняя боевой lifecycle Deep/OTE.
 */
export function buildReactionCandidates(
	snapshot: ReturnType<typeof runAnalysis>,
	ltf5m: import('../../src/models/price/Candle.js').Candle[] | null,
	ltf15m: import('../../src/models/price/Candle.js').Candle[],
	htfMs: number,
	scope = '',
	minLtfLeftBars = 0,
) {
	const result: Record<string, unknown>[] = []
	const prepared = snapshot.fib.candidates.flatMap((candidate) => {
		const mode = candidate.variants.local ? 'local' as const : candidate.variants.global ? 'global' as const : null
		if (!mode) return []
		const variant = candidate.variants[mode]
		const created = snapshot.candles[candidate.createdAtIndex]
		if (!variant || !created) return []
		return [{ candidate, mode, variant, created, knownAt: created.timestamp + htfMs }]
	})

	for (const item of prepared) {
		const { candidate, mode, variant, created, knownAt } = item
		const p0 = variant.levels.find((x) => x.ratio === 0)?.price
		const p100 = variant.levels.find((x) => x.ratio === 100)?.price
		if (p0 == null || p100 == null) continue
		// LTF можно использовать только если его история покрывает сам момент
		// создания сетки. Иначе первый доступный 5m-бар ошибочно выглядел бы
		// «первым касанием» уровня, который цена прошла задолго до LTF-окна.
		const ltfCoversSetup = ltf5m != null && ltf5m.length > 0 &&
			ltf5m[0]!.timestamp <= knownAt && ltf5m[ltf5m.length - 1]!.timestamp >= knownAt
		const source = ltfCoversSetup ? ltf5m : snapshot.candles
		for (const ratio of [141, 200, 241] as const) {
			const price = gridLevelPrice(p0, p100, ratio)
			// Если extension уже был достигнут до close, на котором сетка стала
			// известна, последующий возврат не является «первым касанием».
			const touchedBeforeKnown = snapshot.candles.slice(Math.max(0, variant.start.index), candidate.createdAtIndex + 1)
				.some((c) => candidate.direction === 'long' ? c.high >= price : c.low <= price)
			if (touchedBeforeKnown) continue
			const touchIndex = source.findIndex((c) => c.timestamp >= knownAt &&
				(candidate.direction === 'long' ? c.high >= price : c.low <= price))
			if (touchIndex < 0) continue
			// Не предлагаем exact-5m кейс у самого левого края загруженного окна:
			// пользователь должен видеть запрошенную историю ДО появления зоны.
			if (ltfCoversSetup && touchIndex < minLtfLeftBars) continue
			const touch = source[touchIndex]!
			const touchHtfIndex = ltfCoversSetup
				? snapshot.candles.findIndex((c) => touch.timestamp >= c.timestamp && touch.timestamp < c.timestamp + htfMs)
				: touchIndex
			if (touchHtfIndex < 0) continue

			// Событие становится известным только после close confirm-свечи.
			// Так мы не используем её будущий close против внутрисвечного 5m touch.
			const oppositeDirection = candidate.direction === 'long' ? 'down' : 'up'
			const expiredBeforeTouch = (snapshot.events ?? []).some((event) => {
				const confirm = snapshot.candles[event.confirmIndex]
				return event.confirmIndex > candidate.createdAtIndex && event.direction === oppositeDirection &&
					confirm != null && confirm.timestamp + htfMs <= touch.timestamp
			})
			if (expiredBeforeTouch) continue

			// На одном исходном TF новая сетка того же направления становится
			// текущей структурой после своего close. Старая больше не предлагается
			// как ручной 141/200/241 setup.
			const supersededBeforeTouch = prepared.some((newer) =>
				newer.candidate.direction === candidate.direction &&
				newer.candidate.createdAtIndex > candidate.createdAtIndex &&
				newer.knownAt <= touch.timestamp)
			if (supersededBeforeTouch) continue

			const touch15mIndex = ltf15m.findIndex((c) => touch.timestamp >= c.timestamp && touch.timestamp < c.timestamp + TF_MS['15m']!)
			const stableId = [scope, candidate.direction, mode, variant.start.timestamp, p0,
				candidate.end.timestamp, p100, created.timestamp, ratio, touch.timestamp].join('|')
			result.push({
				id: stableId,
				candidateId: candidate.id, ratio, levelPrice: price,
				gridDirection: candidate.direction,
				tradeDirection: candidate.direction === 'long' ? 'short' : 'long',
				trigger: candidate.trigger, oppositeSweptBefore: candidate.oppositeSweptBefore,
				createdAt: created.timestamp, knownAt, touchAt: touch.timestamp,
				ageBars: Math.max(1, touchHtfIndex - candidate.createdAtIndex),
				ageMs: Math.max(0, touch.timestamp - knownAt),
				activeAtTouch: true,
				touchHtfIndex, touchLtfIndex: ltfCoversSetup ? touchIndex : null,
				touch15mIndex: touch15mIndex >= 0 ? touch15mIndex : null,
				resolution: ltfCoversSetup ? '5m' : 'htf',
				legStart: { timestamp: variant.start.timestamp, price: variant.start.price },
				legEnd: { timestamp: candidate.end.timestamp, price: candidate.end.price },
				gridLevels: variant.levels.map((x) => ({ ratio: x.ratio, price: x.price })),
			})
		}
	}
	return result.sort((a, b) => Number(b.touchAt) - Number(a.touchAt))
}

/** Protected-уровни: только активные из snapshot — без старых пробников. */
function buildProtectedSegments(
	snapshot: ReturnType<typeof runAnalysis>,
): { price: number; type: 'high' | 'low'; startIndex: number; endIndex: number }[] {
	const segments: { price: number; type: 'high' | 'low'; startIndex: number; endIndex: number }[] = []
	const last = snapshot.candles.length - 1
	const high = snapshot.market.protectedHigh
	const low = snapshot.market.protectedLow
	if (high) segments.push({ price: high.price, type: 'high', startIndex: high.index, endIndex: last })
	if (low) segments.push({ price: low.price, type: 'low', startIndex: low.index, endIndex: last })
	return segments
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
	const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
	res.setHeader('Access-Control-Allow-Origin', '*')

	if (url.pathname === '/api/symbols') {
		try {
			sendJson(res, 200, { symbols: await fetchTopSymbols() })
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.error('[api/symbols] error:', message)
			sendJson(res, 500, { error: message })
		}
		return
	}

	// /api/analyze?symbol=BTC/USDT&timeframe=30m&limit=2000&source=fresh
	if (url.pathname === '/api/analyze') {
		try {
			const q = parseQuery(url.search)
			const symbol = q.symbol ?? 'BTC/USDT'
			const timeframe = q.timeframe ?? '30m'
			const limit = Number(q.limit ?? 2000)
			const market = q.market === 'spot' ? 'spot' : 'futures'
			const parsedUntil = q.until ? Date.parse(`${q.until}T23:59:59.999Z`) : null
			if (q.until && !Number.isFinite(parsedUntil)) throw new Error(`Invalid until date: ${q.until}`)
			const untilMs = parsedUntil == null ? null : Math.min(parsedUntil, Date.now())

			const useFixture = q.source !== 'fresh'
			const candles = useFixture
				? loadFixtureCandles()
				: await fetchCandlesPaginated(symbol, timeframe, limit, market, untilMs)
			const snapshot = runAnalysis(candles)
			const htfMs = TF_MS[timeframe]
			if (!htfMs) throw new Error(`Unknown timeframe: ${timeframe}`)
			// Загружаем не просто replay-хвост, а запрошенный левый контекст.
			// Иначе первый exact-кандидат мог оказаться через 5 свечей от края.
			// Replay разрешает переключение до 4h без новой загрузки, поэтому
			// левую глубину гарантируем сразу для самого старшего контекста.
			const contextTf = '4h'
			const contextMs = TF_MS[contextTf]!
			const historyBars = Math.max(100, Math.min(1_000, Number(q.historyBars ?? 250) || 250))
			const minLtfLeftBars = Math.ceil(historyBars * contextMs / TF_MS['5m']!)
			// Ещё 5000×5m оставляем справа от минимального контекста, чтобы в
			// окне было достаточно candidate touches и будущего для outcome.
			const ltfNeed = Math.min(MAX_CANDLES_LTF, Math.max(timeframe === '4h' ? 30_000 : 10_000, minLtfLeftBars + 5_000))
			const ltf5m = useFixture ? null : await fetchCandlesPaginated(symbol, '5m',
				ltfNeed, market, untilMs, MAX_CANDLES_LTF)
			const ltf15m = ltf5m?.length ? aggregateCandles(ltf5m, '5m', '15m') : []

			sendJson(res, 200, {
				strategy: {
					version: FORWARD_VERSION,
					benchmarks: BATTLE_CONFIG.benchmarks,
					bigbar: 'diagnostic-only',
					entryGate: BATTLE_CONFIG.entryGate,
					executionCostGate: BATTLE_CONFIG.executionCostGate,
					mirror: 'removed',
				},
				dataset: { symbol, timeframe, limit, candleCount: candles.length, ltfCandleCount: ltf5m?.length ?? 0, contextTf, historyBars, source: useFixture ? 'fixture' : 'fresh', until: untilMs == null ? null : new Date(untilMs).toISOString() },
				candles: snapshot.candles,
				ltf5m: ltf5m ?? [],
				ltf15m,
				liquidityHeatmap: { version: LIQUIDITY_HEATMAP_VERSION, pools: detectLiquidityHeatmap(snapshot.candles) },
				liquidityPoi: { version: LIQUIDITY_POI_VERSION, candidates: timeframe === '4h' ? detectLiquidityPoi(snapshot.candles, snapshot.events, { structure: snapshot.structure, protectedHistory: snapshot.market.protectedHistory }) : [] },
				refinedPoi: { version: REFINED_POI_VERSION, candidates: timeframe === '4h' ? detectRefinedPoi(snapshot.candles, snapshot.events, ltf15m) : [] },
				reactionCandidates: buildReactionCandidates(snapshot, ltf5m, ltf15m, htfMs, `${symbol}|${timeframe}`, minLtfLeftBars),
				structure: snapshot.structure,
				trendHistory: snapshot.market.trendHistory,
				finalTrend: snapshot.market.trend,
				events: snapshot.events,
				protectedSegments: buildProtectedSegments(snapshot),
				trades: buildTrades(snapshot, ltf5m, htfMs),
			})
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.error('[api/analyze] error:', message)
			sendJson(res, 500, { error: message })
		}
		return
	}

	// Статика из public/.
	const filePath = join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname)
	if (!existsSync(filePath)) {
		sendJson(res, 404, { error: `Not found: ${url.pathname}` })
		return
	}

	const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
	const body = readFileSync(filePath)
	res.writeHead(200, { 'Content-Type': mime })
	res.end(body)
})

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		console.error(`\n  Port ${PORT} is already in use. Kill it first or change PORT.\n`)
	} else {
		console.error('Server error:', err.message)
	}
	process.exit(1)
})

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
	server.listen(PORT, () => {
		console.log(`\n  Fib Playbook visualizer → http://localhost:${PORT}\n`)
	})
}
