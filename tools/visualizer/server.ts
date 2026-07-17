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
import { dirname, join, extname } from 'node:path'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { bigbarCovered } from '../../src/core/analysis/entryModels.js'
import { BATTLE_CONFIG, canonRiskMultiplier, gridLevelPrice, reverseRiskMultiplier } from '../../src/strategy/battleConfig.js'
import { buildCausalMedianByCandidate, FORWARD_VERSION, replayTrade } from '../forward/forwardRunner.js'
import { fetchCandlesPaginated } from '../shared/candleFetcher.js'

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
}

function parseQuery(qs: string): AnalyzeQuery {
	const params = new URLSearchParams(qs)
	return {
		symbol: params.get('symbol') ?? undefined,
		timeframe: params.get('timeframe') ?? undefined,
		limit: params.get('limit') ?? undefined,
		source: params.get('source') ?? undefined,
		market: params.get('market') ?? undefined,
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

function buildTrades(snapshot: ReturnType<typeof runAnalysis>) {
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
		const id = `${scenario}|${outcome.candidateId}`
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
			result: replay.status === 'done' ? replay.result : 'open',
			netR: replay.status === 'done' ? replay.netR : null,
			holdBars: replay.status === 'done' ? replay.exitIndex - replay.fillIndex : null,
			riskMult: Number(riskMult.toFixed(2)), freshBars,
			bigbarDiagnostic: bigbar,
			gridLevels: variant.levels.map((l) => ({ ratio: l.ratio, price: l.price })),
			legStart: { index: variant.start.index, price: variant.start.price },
			legEnd: { index: candidate.end.index, price: candidate.end.price },
		})

		if (scenario !== 'ote') continue
		const mirror = BATTLE_CONFIG.reverse[0]
		if (!mirror) continue
		const mirrorReplay = replayTrade(snapshot.candles, outcome.entryIndex + 1, !long,
			at(mirror.entry), at(mirror.stop), at(mirror.take), at(mirror.cancelBeyond), null)
		if (mirrorReplay.status !== 'open' && mirrorReplay.status !== 'done') continue
		const mirrorExit = mirrorReplay.status === 'done' ? mirrorReplay.exitIndex : null
		const mirrorExitPrice = mirrorReplay.status === 'done'
			? mirrorReplay.result === 'stop' ? at(mirror.stop) : at(mirror.take)
			: null
		trades.push({
			id: `${id}|mirror`, parentId: id, candidateId: outcome.candidateId,
			stream: 'mirror', scenario: 'mirror', shadow: true,
			direction: long ? 'short' : 'long', trigger: outcome.trigger,
			createdAtIndex: outcome.entryIndex, entryIndex: mirrorReplay.fillIndex,
			exitIndex: mirrorExit, entry: at(mirror.entry), stop: at(mirror.stop), take: at(mirror.take),
			entryRatio: mirror.entry, stopRatio: mirror.stop, takeRatio: mirror.take,
			exitPrice: mirrorExitPrice,
			result: mirrorReplay.status === 'done' ? mirrorReplay.result : 'open',
			netR: mirrorReplay.status === 'done' ? mirrorReplay.netR : null,
			holdBars: mirrorReplay.status === 'done' ? mirrorReplay.exitIndex - mirrorReplay.fillIndex : null,
			riskMult: 0, suggestedRiskMult: reverseRiskMultiplier(freshBars), freshBars,
			bigbarDiagnostic: false,
			gridLevels: variant.levels.map((l) => ({ ratio: l.ratio, price: l.price })),
			legStart: { index: variant.start.index, price: variant.start.price },
			legEnd: { index: candidate.end.index, price: candidate.end.price },
		})
	}
	return trades
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

			const useFixture = q.source !== 'fresh'
			const candles = useFixture
				? loadFixtureCandles()
				: await fetchCandlesPaginated(symbol, timeframe, limit, market)
			const snapshot = runAnalysis(candles)

			sendJson(res, 200, {
				strategy: {
					version: FORWARD_VERSION,
					benchmarks: BATTLE_CONFIG.benchmarks,
					bigbar: 'diagnostic-only',
					mirror: 'shadow-risk-0',
				},
				dataset: { symbol, timeframe, limit, candleCount: candles.length, source: useFixture ? 'fixture' : 'fresh' },
				candles: snapshot.candles,
				structure: snapshot.structure,
				trendHistory: snapshot.market.trendHistory,
				finalTrend: snapshot.market.trend,
				events: snapshot.events,
				protectedSegments: buildProtectedSegments(snapshot),
				trades: buildTrades(snapshot),
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

server.listen(PORT, () => {
	console.log(`\n  Fib Playbook visualizer → http://localhost:${PORT}\n`)
})
