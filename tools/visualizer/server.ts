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
import { computeRegimeMetrics } from '../../src/core/analysis/regimeMetrics.js'
import { DEFAULT_REGIME_FILTER, passesRegimeFilter } from '../../src/core/analysis/regimeFilter.js'
import { replayEntryModel, bigbarCovered, type EntryModelId } from '../../src/core/analysis/entryModels.js'
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

/** Входные зоны сетки по сценариям — та же карта, что в runBatch --eval-entry. */
const ENTRY_ZONES: Record<string, [number, number]> = { ote: [61.8, 78.6], deep: [23.6, 38.2] }
const MODELS: EntryModelId[] = ['touch', 'closeConfirm', 'candleConfirm']

/**
 * Сделки канонического пула с тремя моделями входа — зеркало --eval-entry
 * (SPEC 7.24). Каждая сделка несёт полный набор для отрисовки: уровни
 * сетки, вход/стоп/тейк, индексы входа-выхода каждой модели, bigbar.
 */
function buildTrades(snapshot: ReturnType<typeof runAnalysis>) {
	const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
	const pool = snapshot.fibLifecycle.outcomes.filter((o) =>
		(o.scenario === 'ote' || o.scenario === 'deep') && o.stopMode === 'zero' &&
		(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
	const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
	const seenGrids = new Set<string>()
	const trades: unknown[] = []
	for (const outcome of pool) {
		if (!outcome.entered || outcome.entryIndex == null || outcome.entryPrice == null) continue
		const gridKey = `${outcome.scenario}|${outcome.candidateId}`
		if (seenGrids.has(gridKey)) continue
		seenGrids.add(gridKey)
		const candidate = candidateById.get(outcome.candidateId)
		const cVariant = candidate?.variants[outcome.variantMode]
		if (!candidate || !cVariant) continue
		const levelPrice = (ratio: number): number | null =>
			cVariant.levels.find((l) => l.ratio === ratio)?.price ?? null
		const tp = levelPrice(100)
		const zone = ENTRY_ZONES[outcome.scenario]
		if (tp == null || zone == null) continue
		const zoneNearPrice = levelPrice(zone[0])
		const zoneFarPrice = levelPrice(zone[1])
		if (zoneNearPrice == null || zoneFarPrice == null) continue
		const models: Record<string, unknown> = {}
		for (const m of MODELS) {
			const r = replayEntryModel(snapshot.candles, outcome, tp, m)
			models[m] = {
				status: r.status,
				netR: r.netR,
				entryPrice: r.entryPrice,
				entryIndex: r.entryIndex ?? null,
				exitIndex: r.exitIndex ?? null,
				exitPrice: r.exitPrice ?? null,
				exitReason: r.exitReason ?? null,
			}
		}
		trades.push({
			id: gridKey,
			candidateId: outcome.candidateId,
			scenario: outcome.scenario,
			direction: outcome.direction,
			trigger: outcome.trigger,
			createdAtIndex: outcome.createdAtIndex,
			touchIndex: outcome.entryIndex,
			level: outcome.entryPrice,
			stop: outcome.stopPrice,
			tp,
			// +1: свеча касания входит в окно (тот же фикс, что в runBatch).
			bigbar: bigbarCovered(snapshot.candles, outcome.createdAtIndex, outcome.entryIndex + 1, zoneNearPrice, zoneFarPrice),
			gridLevels: cVariant.levels.map((l) => ({ ratio: l.ratio, price: l.price })),
			legStart: { index: cVariant.start.index, price: cVariant.start.price },
			legEnd: { index: candidate.end.index, price: candidate.end.price },
			models,
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
