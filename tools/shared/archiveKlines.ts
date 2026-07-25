// archiveKlines.ts
//
// Полная история klines из архивов data.binance.vision (задание §0.5: потолок API
// ≈ 208 дней 15m при 60k×5m — архивы снимают его без лимитов и пагинации).
// НЕ часть пайплайна — слой данных инструментов (визуализатор, диагностика).
//
// Устройство: monthly-архивы + daily-архивы текущего (и недостающего прошлого) месяца;
// ZIP распаковывается НАТИВНО через zlib (без зависимостей и без системного unzip —
// переносимо на любую ОС пользователя: «склонировал и запустил»); CSV парсится с
// нормализацией таймстампов (с 2025 года Binance пишет их в МИКРОсекундах);
// распарсенные периоды кэшируются на диск (архивы иммутабельны — кэш вечный),
// отсутствующие файлы (404: будущее, делистинг, свежий день) помнятся в памяти процесса.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import type { Candle } from '../../src/models/price/Candle.js'
import { TF_MS, type MarketKind } from './candleFetcher.js'

const BASE_URL = 'https://data.binance.vision/data'
const DEFAULT_CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../tmp/viz-archive-cache')
const DAY_MS = 86_400_000

export interface ArchiveOptions {
	/** Подмена сети для тестов; по умолчанию — глобальный fetch. */
	fetchImpl?: typeof fetch
	/** Папка дискового кэша распарсенных периодов (в тестах — временная). */
	cacheDir?: string
	/** Параллельность скачивания архивов. */
	parallel?: number
}

/** 'BTC/USDT' | 'BTC/USDT:USDT' | 'btcusdt' → 'BTCUSDT' (имя архива). */
export function archiveSymbol(symbol: string): string {
	return symbol.split(':')[0]!.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

/**
 * Распаковка ZIP нативным Node: читаем central directory (сигнатура EOCD с конца файла),
 * для каждой записи — local header и данные (stored как есть, deflate — inflateRawSync).
 * Возвращает конкатенацию содержимого всех записей (в архивах Binance запись одна — CSV).
 * ZIP64 не поддерживаем осознанно: месячный архив 15m ≈ 1 МБ, до лимитов ZIP далеко.
 */
export function unzipCsv(buf: Buffer): string {
	// EOCD (0x06054b50) ищем с конца: у файла может быть комментарий до 64КБ.
	let eocd = -1
	const scanFrom = Math.max(0, buf.length - 65_557)
	for (let i = buf.length - 22; i >= scanFrom; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
	}
	if (eocd < 0) throw new Error('ZIP: EOCD не найден (файл повреждён или не ZIP)')
	const count = buf.readUInt16LE(eocd + 10)
	let offset = buf.readUInt32LE(eocd + 16)
	const parts: string[] = []
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP: повреждена central directory')
		const method = buf.readUInt16LE(offset + 10)
		const compressedSize = buf.readUInt32LE(offset + 20)
		const nameLen = buf.readUInt16LE(offset + 28)
		const extraLen = buf.readUInt16LE(offset + 30)
		const commentLen = buf.readUInt16LE(offset + 32)
		const localOffset = buf.readUInt32LE(offset + 42)
		if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 не поддерживается (неожиданно большой архив)')
		// Local header: длины имени/extra могут отличаться от central — читаем свои.
		if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP: повреждён local header')
		const lNameLen = buf.readUInt16LE(localOffset + 26)
		const lExtraLen = buf.readUInt16LE(localOffset + 28)
		const dataStart = localOffset + 30 + lNameLen + lExtraLen
		const raw = buf.subarray(dataStart, dataStart + compressedSize)
		if (method === 0) parts.push(raw.toString('utf8'))
		else if (method === 8) parts.push(inflateRawSync(raw).toString('utf8'))
		else throw new Error(`ZIP: неподдерживаемый метод сжатия ${method}`)
		offset += 46 + nameLen + extraLen + commentLen
	}
	return parts.join('')
}

/**
 * CSV klines → Candle[]. Колонки: open_time,open,high,low,close,volume,...
 * Заголовок есть не во всех файлах (детект по нечисловому первому полю).
 * open_time с 2025 года — в МИКРОсекундах (детект: > 1e14 → делим на 1000).
 */
export function parseKlinesCsv(text: string): Candle[] {
	const out: Candle[] = []
	for (const line of text.split('\n')) {
		if (!line) continue
		const c = line.split(',')
		if (!c[0] || !/^\d+$/.test(c[0])) continue
		let ts = Number(c[0])
		if (ts > 1e14) ts = Math.round(ts / 1000)
		out.push({ timestamp: ts, open: +c[1]!, high: +c[2]!, low: +c[3]!, close: +c[4]!, volume: +c[5]! })
	}
	return out
}

/**
 * Склейка рядов: приоритет у tail (свежие данные API поверх архивных на перекрытии),
 * сортировка и дедуп по timestamp.
 */
export function mergeCandleSeries(archive: Candle[], tail: Candle[]): Candle[] {
	const byTs = new Map<number, Candle>()
	for (const c of archive) byTs.set(c.timestamp, c)
	for (const c of tail) byTs.set(c.timestamp, c)
	return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp)
}

/** Периоды покрытия [fromMs, untilMs): месяцы целиком + дни хвостового месяца. */
export function planPeriods(fromMs: number, untilMs: number): { months: string[]; days: string[] } {
	const months: string[] = []
	const days: string[] = []
	const from = new Date(fromMs)
	let y = from.getUTCFullYear(), m = from.getUTCMonth()
	// Месяц считается «архивируемым целиком», если он ЗАКОНЧИЛСЯ до untilMs.
	while (Date.UTC(y, m + 1, 1) <= untilMs) {
		months.push(`${y}-${String(m + 1).padStart(2, '0')}`)
		m++
		if (m === 12) { m = 0; y++ }
	}
	// Хвостовой (текущий для untilMs) месяц — дневными архивами до последнего ПОЛНОГО дня.
	const tailStart = Math.max(fromMs, Date.UTC(y, m, 1))
	for (let t = Date.UTC(new Date(tailStart).getUTCFullYear(), new Date(tailStart).getUTCMonth(), new Date(tailStart).getUTCDate()); t + DAY_MS <= untilMs; t += DAY_MS) {
		const d = new Date(t)
		days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`)
	}

	return { months, days }
}

/** 404-промахи (будущие дни, делистинг, ещё не выложенный архив) — память процесса. */
const missing = new Set<string>()

async function loadPeriod(
	sym: string, tf: string, market: MarketKind, kind: 'monthly' | 'daily', period: string, opts: ArchiveOptions,
): Promise<Candle[] | null> {
	const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR
	const cacheFile = join(cacheDir, `${sym}-${tf}-${period}.json`)
	if (existsSync(cacheFile)) {
		try { return JSON.parse(readFileSync(cacheFile, 'utf8')) as Candle[] } catch { /* перекачаем */ }
	}
	const key = `${sym}|${tf}|${period}`
	if (missing.has(key)) return null
	const marketPath = market === 'futures' ? 'futures/um' : 'spot'
	const url = `${BASE_URL}/${marketPath}/${kind}/klines/${sym}/${tf}/${sym}-${tf}-${period}.zip`
	const fetchImpl = opts.fetchImpl ?? fetch
	// Транзиентные 5xx: до 3 попыток с бэкоффом; после — период пропускается с предупреждением
	// (один битый файл не должен ронять 80 хороших; в missing НЕ пишем — следующий процесс дотянет).
	for (let attempt = 0; ; attempt++) {
		const res = await fetchImpl(url)
		if (res.status === 404) { missing.add(key); return null }
		if (!res.ok) {
			if (attempt < 2) { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); continue }
			console.error(`[archiveKlines] пропускаю ${sym}-${tf}-${period}: ${res.status} после ретраев`)
			return null
		}
		const candles = parseKlinesCsv(unzipCsv(Buffer.from(await res.arrayBuffer())))
		mkdirSync(cacheDir, { recursive: true })
		writeFileSync(cacheFile, JSON.stringify(candles))
		return candles
	}
}

/**
 * Полная история klines [fromMs, untilMs) из архивов. Месяц без monthly-архива
 * (свежий, ещё не выложен) добирается дневными архивами. Отсутствующие периоды
 * пропускаются молча (история символа короче окна — нормальная ситуация).
 */
export async function fetchArchiveKlines(
	symbol: string, tf: string, market: MarketKind, fromMs: number, untilMs?: number | null, opts: ArchiveOptions = {},
): Promise<Candle[]> {
	if (!TF_MS[tf]) throw new Error(`Unknown timeframe: ${tf}`)
	const sym = archiveSymbol(symbol)
	const until = untilMs ?? Date.now()
	if (fromMs >= until) return []
	const { months, days } = planPeriods(fromMs, until)
	const jobs: Array<() => Promise<Candle[] | null>> = [
		...months.map((p) => async () => {
			const monthly = await loadPeriod(sym, tf, market, 'monthly', p, opts)
			if (monthly) return monthly
			// monthly отсутствует: либо месяц до листинга символа (дневных тоже нет — проверяем
			// пробами 1-го и 15-го, чтобы не бомбить 30 запросами), либо свежий месяц ещё не
			// выложен целиком — добираем дневными.
			const [y, m] = p.split('-').map(Number)
			const dayId = (t: number) => {
				const d = new Date(t)
				return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
			}
			const monthStart = Date.UTC(y!, m! - 1, 1)
			const probes = await Promise.all([
				loadPeriod(sym, tf, market, 'daily', dayId(monthStart), opts),
				loadPeriod(sym, tf, market, 'daily', dayId(monthStart + 14 * DAY_MS), opts),
			])
			if (!probes[0] && !probes[1]) return []
			const dayJobs: Promise<Candle[] | null>[] = []
			for (let t = monthStart; t < Math.min(until, Date.UTC(y!, m!, 1)); t += DAY_MS) {
				dayJobs.push(loadPeriod(sym, tf, market, 'daily', dayId(t), opts))
			}
			return (await Promise.all(dayJobs)).flatMap((x) => x ?? [])
		}),
		...days.map((p) => () => loadPeriod(sym, tf, market, 'daily', p, opts)),
	]
	const parallel = Math.max(1, opts.parallel ?? 6)
	const results: Candle[][] = []
	for (let i = 0; i < jobs.length; i += parallel) {
		const chunk = await Promise.all(jobs.slice(i, i + parallel).map((j) => j()))
		for (const r of chunk) if (r) results.push(r)
	}
	const tfMs = TF_MS[tf]!
	const byTs = new Map<number, Candle>()
	for (const part of results) for (const c of part) if (c.timestamp >= fromMs && c.timestamp + tfMs <= until) byTs.set(c.timestamp, c)
	return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp)
}
