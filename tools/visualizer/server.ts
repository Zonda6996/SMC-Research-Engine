// server.ts
//
// Мини-сервер визуализатора на голом Node http (без новых backend-зависимостей).
// Отдаёт статический HTML/JS из public/ и endpoint /api/analyze.
// НЕ часть пайплайна — измерительный инструмент (см. SPEC, раздел визуализатора).
//
// Запуск: npx tsx tools/visualizer/server.ts
// Открыть: http://localhost:7788

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { BinanceService } from '../../src/services/BinanceService.js'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { probeSwingBreaches, type BreachMode } from './lastSwingBreachProbe.js'
import { probeActiveLevelPool } from './activeLevelPoolProbe.js'
import {
	probeProtectedBreaches,
	classifyBreaches,
	classifySwingBreaches as classifySwing,
} from './breachClassifier.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, 'public')
const PORT = 7788
const WINDOW = 2

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
	mode?: string | undefined
	source?: string | undefined
	market?: string | undefined
}

function parseQuery(qs: string): AnalyzeQuery {
	const params = new URLSearchParams(qs)
	return {
		symbol: params.get('symbol') ?? undefined,
		timeframe: params.get('timeframe') ?? undefined,
		limit: params.get('limit') ?? undefined,
		mode: params.get('mode') ?? undefined,
		source: params.get('source') ?? undefined,
		market: params.get('market') ?? undefined,
	}
}

const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

/** Фикстура читается из файла — воспроизводимость без похода на биржу. */
function loadFixtureCandles(): import('../../src/models/price/Candle.js').Candle[] {
	return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
}

/** Максимум свечей за один запрос к Binance (лимит их API). */
const BINANCE_PAGE_LIMIT = 1000
/** Потолок визуализатора — защита от случайной загрузки мегаистории. */
const MAX_CANDLES = 5000

const TF_MS: Record<string, number> = {
	'1m': 60_000,
	'5m': 300_000,
	'15m': 900_000,
	'30m': 1_800_000,
	'1h': 3_600_000,
	'4h': 14_400_000,
	'1d': 86_400_000,
}

/**
 * Постраничная загрузка: Binance отдаёт максимум 1000 свечей за запрос,
 * для больших лимитов идём страницами от рассчитанного `since` вперёд.
 * Только для визуализатора — пайплайн работает со своим сервисом.
 */
async function fetchCandlesPaginated(
	symbol: string,
	timeframe: string,
	limit: number,
	market: 'spot' | 'futures' = 'spot',
): Promise<import('../../src/models/price/Candle.js').Candle[]> {
	const capped = Math.min(limit, MAX_CANDLES)

	if (capped <= BINANCE_PAGE_LIMIT && market === 'spot') {
		return new BinanceService().getCandles({ symbol, timeframe, limit: capped })
	}

	const tfMs = TF_MS[timeframe]
	if (!tfMs) throw new Error(`Unknown timeframe: ${timeframe}`)

	// ccxt внутри BinanceService не принимает since и не умеет фьючерсы —
	// используем ccxt напрямую (инструментальный код, не пайплайн).
	// binanceusdm = USDT-M perpetual futures: у низколиквидных альтов (PEPE и
	// т.п.) фьючерсные свечи чище спотовых — меньше рваных фитилей.
	const { default: ccxt } = await import('ccxt')
	const exchange = market === 'futures' ? new ccxt.binanceusdm() : new ccxt.binance()
	const since = Date.now() - capped * tfMs

	const all: number[][] = []
	let cursor = since
	while (all.length < capped) {
		const page = await exchange.fetchOHLCV(symbol, timeframe, cursor, BINANCE_PAGE_LIMIT)
		if (page.length === 0) break
		all.push(...(page as number[][]))
		const lastTs = Number(page[page.length - 1]![0])
		const nextCursor = lastTs + tfMs
		if (nextCursor <= cursor) break // защита от зацикливания
		cursor = nextCursor
	}

	return all.slice(-capped).map(([timestamp, open, high, low, close, volume]) => ({
		timestamp: Number(timestamp),
		open: Number(open),
		high: Number(high),
		low: Number(low),
		close: Number(close),
		volume: Number(volume),
	}))
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
	const body = JSON.stringify(data)
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
	res.end(body)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
	const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

	// CORS для локальной разработки (если HTML открывают отдельно).
	res.setHeader('Access-Control-Allow-Origin', '*')

	// /api/analyze?symbol=BTC/USDT&timeframe=15m&limit=500&mode=two
	if (url.pathname === '/api/analyze') {
		try {
			const q = parseQuery(url.search)
			const symbol = q.symbol ?? 'BTC/USDT'
			const timeframe = q.timeframe ?? '15m'
			const limit = Number(q.limit ?? 500)
			const mode: BreachMode = q.mode === 'single' ? 'single' : 'two'
			const market = q.market === 'futures' ? 'futures' : 'spot'

			const useFixture = q.source !== 'fresh'
			const candles = useFixture
				? loadFixtureCandles()
				: await fetchCandlesPaginated(symbol, timeframe, limit, market)
			const snapshot = runAnalysis(candles)

			// Слой A: protected-пробои. Эмулируем через probeProtectedBreaches с
			// выбранным mode (совпадает со snapshot.market.breached при mode='two').
			const protectedBreaches = probeProtectedBreaches(
				snapshot.structure,
				snapshot.candles,
				WINDOW,
				mode,
			)
			const layerA = classifyBreaches(
				protectedBreaches,
				snapshot.market.trendHistory,
				'protected',
			)

			// Слой B: swing-пробои (изолированный пробник).
			const swingBreaches = probeSwingBreaches(
				snapshot.structure,
				snapshot.candles,
				WINDOW,
				mode,
			)
			const layerB = classifySwing(swingBreaches, snapshot.market.trendHistory)

			// Слой C: пул активных уровней — каждый swing живёт до своего слома,
			// «важный уровень слева» не вытесняется свежими.
			const poolBreaches = probeActiveLevelPool(
				snapshot.structure,
				snapshot.candles,
				WINDOW,
				mode,
			)
			const layerC = classifySwing(poolBreaches, snapshot.market.trendHistory)

			// Совпадения: одна и та же свеча подтверждения + тот же уровень цены.
			const matched = layerA.filter((a) =>
				layerB.some((b) => b.confirmIndex === a.confirmIndex && b.levelPrice === a.levelPrice),
			)

			// Уникальные для B (нет совпадения по confirmIndex+price в A).
			const uniqueB = layerB.filter((b) =>
				!layerA.some((a) => a.confirmIndex === b.confirmIndex && a.levelPrice === b.levelPrice),
			)

			sendJson(res, 200, {
				dataset: { symbol, timeframe, limit, candleCount: candles.length, mode },
				candles: snapshot.candles,
				structure: snapshot.structure,
				trendHistory: snapshot.market.trendHistory,
				finalTrend: snapshot.market.trend,
				protectedHigh: snapshot.market.protectedHigh ?? null,
				protectedLow: snapshot.market.protectedLow ?? null,
				// Все protected-уровни для отрисовки сегментов (из breached + активные).
				protectedSegments: buildProtectedSegments(
					protectedBreaches,
					snapshot.market.protectedHigh ?? null,
					snapshot.market.protectedLow ?? null,
					snapshot.candles.length,
				),
				layers: {
					A: layerA,
					B: layerB,
					C: layerC,
					matched,
					uniqueB,
					// Уникальные для C относительно A — то, что теряет вариант 1.
					uniqueC: layerC.filter((c) =>
						!layerA.some((a) => a.confirmIndex === c.confirmIndex && a.levelPrice === c.levelPrice),
					),
				},
				counts: {
					A: layerA.length,
					B: layerB.length,
					C: layerC.length,
					matched: matched.length,
					uniqueB: uniqueB.length,
					byTypeA: countByType(layerA),
					byTypeB: countByType(layerB),
					byTypeC: countByType(layerC),
				},
			})
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.error('[api/analyze] error:', message)
			sendJson(res, 500, { error: message })
		}
		return
	}

	// Статика из public/.
	let filePath = join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname)
	if (!existsSync(filePath)) {
		sendJson(res, 404, { error: `Not found: ${url.pathname}` })
		return
	}

	const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
	const body = readFileSync(filePath)
	res.writeHead(200, { 'Content-Type': mime })
	res.end(body)
})

function countByType(events: { type: string }[]): { bos: number; choch: number; unlabeled: number } {
	return events.reduce(
		(acc, e) => {
			if (e.type === 'bos') acc.bos++
			else if (e.type === 'choch') acc.choch++
			else acc.unlabeled++
			return acc
		},
		{ bos: 0, choch: 0, unlabeled: 0 },
	)
}

/**
 * Строит сегменты protected-уровней для отрисовки:
 * { price, type, startIndex, endIndex } — от возникновения до слома/конца данных.
 */
function buildProtectedSegments(
	breaches: { level: { price: number; type: 'high' | 'low'; index: number }; confirmIndex: number }[],
	activeHigh: { index: number; price: number; type: 'high' | 'low' } | null,
	activeLow: { index: number; price: number; type: 'high' | 'low' } | null,
	totalCandles: number,
): { price: number; type: 'high' | 'low'; startIndex: number; endIndex: number }[] {
	const segments: { price: number; type: 'high' | 'low'; startIndex: number; endIndex: number }[] = []

	for (const b of breaches) {
		segments.push({
			price: b.level.price,
			type: b.level.type,
			startIndex: b.level.index,
			endIndex: b.confirmIndex,
		})
	}

	if (activeHigh) {
		segments.push({
			price: activeHigh.price,
			type: 'high',
			startIndex: activeHigh.index,
			endIndex: totalCandles - 1,
		})
	}
	if (activeLow) {
		segments.push({
			price: activeLow.price,
			type: 'low',
			startIndex: activeLow.index,
			endIndex: totalCandles - 1,
		})
	}

	return segments
}

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		console.error(`\n  Port ${PORT} is already in use. Kill it first:\n`)
		console.error(`    Windows:  netstat -ano | findstr :${PORT}`)
		console.error(`              taskkill /PID <pid> /F\n`)
		console.error(`    Or change PORT in tools/visualizer/server.ts\n`)
	} else {
		console.error('Server error:', err.message)
	}
	process.exit(1)
})

server.listen(PORT, () => {
	console.log(`\n  BOS/CHoCH visualizer → http://localhost:${PORT}\n`)
})
