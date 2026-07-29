// apexAnchors.ts — калибровка полос Zonda Apex по четырём ОДНОВРЕМЕННЫМ якорям.
//
// ДАННЫЕ: Binance SPOT, архивы data.binance.vision. Фид опознан как спот —
// совпадение до цента по OHLC на всех четырёх ТФ. Скрипт проверяет это сам,
// сверяя бар из архива со значениями со скрина, ДО любой подгонки.
//
// ЯКОРЯ: все четыре сняты с ОДНОГО бара, открытие 20.07.2026 12:00 UTC
// (на скринах подпись 17:00 при часовом поясе пользователя UTC+5). Признак
// одного бара: одинаковая цена открытия 65002.00 и вложенные диапазоны.
//
// ПОДСКАЗКА ВЕНДОРА содержит пять значений: три линии полос (средняя, верх,
// низ) и два сигнальных плота BUY/SELL, равных 0.00 при отсутствии сигнала на
// баре. Скрытых линий нет, поэтому какая пара полос видна — внутренняя (5.6)
// или внешняя (9.6) — из скрина не определить, и множитель здесь неизвестное.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { sliceSpec } from './specSlice.js'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'

/** Зафиксировано ДО прогона. Менять только новой секцией SPEC с обоснованием. */
const RULE: string[] = [
	'1. Кандидат средней = (источник, тип, период). Кандидат отклонения = (мера, период) при общем множителе k.',
	'2. Побеждает минимум МАКСИМАЛЬНОЙ по якорям абсолютной ошибки, а не средней: формула должна попадать во все ТФ сразу.',
	'3. Порог приёмки max|err| <= 5%. Не прошло — вывод остаётся отрицательным, подгонка не принимается.',
	'4. Множитель k общий для всех ТФ, перебирается только среди 5.6 и 9.6 из настроек вендора.',
	'5. При разнице в пределах 0.5% предпочитается канонический вариант: период 200 из настроек, затем ATR/RMA по Уайлдеру.',
	'6. Валидация — новыми якорями с других дат, НЕ границей train/test 01.01.2025: это обратная разработка формулы, а не поиск преимущества.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number }
type Tf = '5m' | '15m' | '1h' | '4h'
type SrcKind = 'hlc3' | 'close' | 'hl2' | 'ohlc4'
type MeanKind = 'sma' | 'ema' | 'rma' | 'wma'
type DevKind =
	| 'atrRma'
	| 'atrEma'
	| 'atrSma'
	| 'hlSma'
	| 'stdevHlc3'
	| 'stdevClose'
	| 'madHlc3'
	| 'donchHalf'

const ANCHOR_MS = Date.UTC(2026, 6, 20, 12, 0, 0)
const TFS: Tf[] = ['5m', '15m', '1h', '4h']

type Anchor = {
	/** Средняя линия из подсказки вендора — прямой замер на всех четырёх ТФ. */
	mean: number
	/** Верх/низ полос из подсказки. Есть только там, где снят полный набор линий. */
	upper?: number
	lower?: number
	/** Отклонение из прежних замеров (CONTEXT §0.5). Соглашение по множителю неизвестно. */
	devLegacy?: number
	/** OHLC бара со скрина — для сверки источника данных. */
	ohlc: [number, number, number, number]
}

const ANCHORS: Record<Tf, Anchor> = {
	'5m': { mean: 64250.82, upper: 64835.88, lower: 63671.03, ohlc: [65002.0, 65002.83, 64716.57, 64803.99] },
	'15m': { mean: 64526.7, devLegacy: 176.16, ohlc: [65002.0, 65002.83, 64716.57, 64750.0] },
	'1h': { mean: 64281.12, devLegacy: 240.13, ohlc: [65002.0, 65002.83, 64599.89, 64640.0] },
	'4h': { mean: 63533.87, upper: 67351.71, lower: 59932.45, ohlc: [65002.0, 65666.8, 64077.76, 65598.75] },
}

// ------------------------------------------------------------------ загрузка
const BASE = 'https://data.binance.vision/data/spot'
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06']
const DAYS = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)

function urlsFor(tf: Tf): string[] {
	return [
		...MONTHS.map((m) => `${BASE}/monthly/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${m}.zip`),
		...DAYS.map((d) => `${BASE}/daily/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${d}.zip`),
	]
}

async function cached(url: string): Promise<string | null> {
	const file = `${CACHE}/${url.split('/').pop()!}`
	if (existsSync(file)) return file
	const r = await fetch(url)
	if (!r.ok) {
		console.log(`MISS ${r.status} ${url}`)
		return null
	}
	writeFileSync(file, Buffer.from(await r.arrayBuffer()))
	return file
}

function parseZip(file: string): Cndl[] {
	const csv = execFileSync('unzip', ['-p', file], { maxBuffer: 1 << 28 }).toString()
	const out: Cndl[] = []
	for (const line of csv.split('\n')) {
		if (!line) continue
		const p = line.split(',')
		if (p.length < 5) continue
		let t = Number(p[0])
		if (!Number.isFinite(t)) continue // строка заголовка в новых архивах
		// в архивах после 2025 время в микросекундах
		if (t > 1e14) t = Math.floor(t / 1000)
		const c: Cndl = { t, o: Number(p[1]), h: Number(p[2]), l: Number(p[3]), c: Number(p[4]) }
		if (Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c)) out.push(c)
	}
	return out
}

async function load(tf: Tf): Promise<Cndl[]> {
	const all: Cndl[] = []
	for (const u of urlsFor(tf)) {
		const f = await cached(u)
		if (f) all.push(...parseZip(f))
	}
	const seen = new Set<number>()
	const uniq: Cndl[] = []
	for (const c of all) {
		if (seen.has(c.t)) continue
		seen.add(c.t)
		uniq.push(c)
	}
	uniq.sort((a, b) => a.t - b.t)
	return uniq
}

// -------------------------------------------------------------------- меры
const srcAt = (c: Cndl, k: SrcKind): number =>
	k === 'hlc3' ? (c.h + c.l + c.c) / 3 : k === 'close' ? c.c : k === 'hl2' ? (c.h + c.l) / 2 : (c.o + c.h + c.l + c.c) / 4

/** Значение средней на баре i. Каузально: только бары <= i. */
function meanAt(x: number[], i: number, n: number, kind: MeanKind): number {
	if (i + 1 < n) return NaN
	if (kind === 'sma') {
		let s = 0
		for (let k = 0; k < n; k++) s += x[i - k]!
		return s / n
	}
	if (kind === 'wma') {
		let s = 0
		let w = 0
		for (let k = 0; k < n; k++) {
			const ww = n - k
			s += x[i - k]! * ww
			w += ww
		}
		return s / w
	}
	const a = kind === 'rma' ? 1 / n : 2 / (n + 1)
	let v = x[0]!
	for (let j = 1; j <= i; j++) v += a * (x[j]! - v)
	return v
}

function trueRange(c: Cndl[]): number[] {
	return c.map((x, i) =>
		i === 0
			? x.h - x.l
			: Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c)),
	)
}

/** Значение меры разброса на баре i. */
function devAt(c: Cndl[], tr: number[], i: number, n: number, kind: DevKind): number {
	if (i + 1 < n) return NaN
	switch (kind) {
		case 'atrRma':
			return meanAt(tr, i, n, 'rma')
		case 'atrEma':
			return meanAt(tr, i, n, 'ema')
		case 'atrSma':
			return meanAt(tr, i, n, 'sma')
		case 'hlSma': {
			let s = 0
			for (let k = 0; k < n; k++) s += c[i - k]!.h - c[i - k]!.l
			return s / n
		}
		case 'stdevHlc3':
		case 'stdevClose': {
			const hlc3 = kind === 'stdevHlc3'
			let s = 0
			let q = 0
			for (let k = 0; k < n; k++) {
				const x = c[i - k]!
				const v = hlc3 ? srcAt(x, 'hlc3') : x.c
				s += v
				q += v * v
			}
			const m = s / n
			return Math.sqrt(Math.max(0, q / n - m * m))
		}
		case 'madHlc3': {
			let s = 0
			for (let k = 0; k < n; k++) s += srcAt(c[i - k]!, 'hlc3')
			const m = s / n
			let d = 0
			for (let k = 0; k < n; k++) d += Math.abs(srcAt(c[i - k]!, 'hlc3') - m)
			return d / n
		}
		case 'donchHalf': {
			let hi = -Infinity
			let lo = Infinity
			for (let k = 0; k < n; k++) {
				const x = c[i - k]!
				if (x.h > hi) hi = x.h
				if (x.l < lo) lo = x.l
			}
			return (hi - lo) / 2
		}
		default:
			return NaN
	}
}

// ------------------------------------------------------------------- сетки
const SRCS: SrcKind[] = ['hlc3', 'close', 'hl2', 'ohlc4']
const MEAN_KINDS: MeanKind[] = ['sma', 'ema', 'rma', 'wma']
const MEAN_PERIODS = [50, 75, 100, 150, 200, 250, 300]
const DEV_KINDS: DevKind[] = ['atrRma', 'atrEma', 'atrSma', 'hlSma', 'stdevHlc3', 'stdevClose', 'madHlc3', 'donchHalf']
const DEV_PERIODS = [10, 14, 20, 30, 50, 75, 100, 150, 200, 250, 300, 400, 600, 800, 1200, 2400]
const MULTS = [5.6, 9.6]
/** Гипотеза «окно во времени»: 200 баров часа, приведённые к каждому ТФ. */
const TIME_QUARTET: Record<Tf, number> = { '5m': 2400, '15m': 800, '1h': 200, '4h': 50 }
const BARS_QUARTET: Record<Tf, number> = { '5m': 200, '15m': 200, '1h': 200, '4h': 200 }

const pct = (got: number, want: number): number => ((got - want) / want) * 100
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'н/д')
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : 'н/д')

type Loaded = { tf: Tf; candles: Cndl[]; tr: number[]; i0: number; src: Record<SrcKind, number[]> }

async function main(): Promise<void> {
	mkdirSync(CACHE, { recursive: true })
	mkdirSync(OUT, { recursive: true })

	// побочная задача этого прогона: нарезать SPEC для чтения агентом
	try {
		sliceSpec('16.24', '16.33')
		console.log('SPEC нарезан')
	} catch (e) {
		console.log(`SPEC нарезать не удалось: ${String(e)}`)
	}

	const L: Loaded[] = []
	const report: string[] = []
	const push = (s = ''): void => {
		report.push(s)
	}

	push('# Zonda Apex — калибровка по четырём одновременным якорям')
	push()
	push(`- прогон: ${process.env.GITHUB_RUN_ID ?? 'local'}, коммит ${process.env.GITHUB_SHA ?? 'local'}`)
	push(`- дата UTC: ${new Date().toISOString()}`)
	push(`- якорный бар: ${new Date(ANCHOR_MS).toISOString()} (на скринах 17:00 при UTC+5)`)
	push('- источник данных: Binance SPOT, архивы data.binance.vision')
	push()
	push('## Правило отбора (зафиксировано в коде до прогона)')
	push()
	for (const r of RULE) push(`${r}`)
	push()

	// ---------------------------------------------------- сверка источника
	push('## 1. Сверка бара из архива со скрином')
	push()
	push('| ТФ | баров | O архив / скрин | H архив / скрин | L архив / скрин | C архив / скрин | совпало |')
	push('| --- | --- | --- | --- | --- | --- | --- |')
	for (const tf of TFS) {
		const candles = await load(tf)
		const i0 = candles.findIndex((c) => c.t === ANCHOR_MS)
		if (i0 < 0) {
			push(`| ${tf} | ${candles.length} | якорный бар не найден | | | | НЕТ |`)
			continue
		}
		const c = candles[i0]!
		const a = ANCHORS[tf]
		const same =
			Math.abs(c.o - a.ohlc[0]) < 0.011 &&
			Math.abs(c.h - a.ohlc[1]) < 0.011 &&
			Math.abs(c.l - a.ohlc[2]) < 0.011 &&
			Math.abs(c.c - a.ohlc[3]) < 0.011
		push(
			`| ${tf} | ${candles.length} | ${f2(c.o)} / ${f2(a.ohlc[0])} | ${f2(c.h)} / ${f2(a.ohlc[1])} | ` +
				`${f2(c.l)} / ${f2(a.ohlc[2])} | ${f2(c.c)} / ${f2(a.ohlc[3])} | ${same ? 'да' : 'НЕТ'} |`,
		)
		const src = {
			hlc3: candles.map((x) => srcAt(x, 'hlc3')),
			close: candles.map((x) => srcAt(x, 'close')),
			hl2: candles.map((x) => srcAt(x, 'hl2')),
			ohlc4: candles.map((x) => srcAt(x, 'ohlc4')),
		} satisfies Record<SrcKind, number[]>
		L.push({ tf, candles, tr: trueRange(candles), i0, src })
	}
	push()
	push('Если хотя бы одно «НЕТ» — дальше читать бессмысленно, сначала источник.')
	push()

	// ------------------------------------------------------------ симметрия
	push('## 2. Симметрия полос вокруг средней')
	push()
	push('| ТФ | средняя | центр спреда | расхождение | в % | вверх | вниз | асимметрия % |')
	push('| --- | --- | --- | --- | --- | --- | --- | --- |')
	for (const tf of TFS) {
		const a = ANCHORS[tf]
		if (a.upper === undefined || a.lower === undefined) continue
		const mid = (a.upper + a.lower) / 2
		const up = a.upper - a.mean
		const dn = a.mean - a.lower
		push(
			`| ${tf} | ${f2(a.mean)} | ${f2(mid)} | ${f2(mid - a.mean)} | ${f3(pct(mid, a.mean))} | ` +
				`${f2(up)} | ${f2(dn)} | ${f3(((up - dn) / ((up + dn) / 2)) * 100)} |`,
		)
	}
	push()
	push('Модель «средняя ± k·отклонение» строго симметрична. Значимая асимметрия означает, что')
	push('у полос своя база либо верх и низ считаются от разных мер, и одна пара (средняя, отклонение)')
	push('во все три линии не попадёт в принципе.')
	push()

	// ---------------------------------------------------------------- средняя
	type MeanCand = { src: SrcKind; kind: MeanKind; n: number; errs: Partial<Record<Tf, number>>; maxAbs: number }
	const meanCands: MeanCand[] = []
	for (const s of SRCS)
		for (const k of MEAN_KINDS)
			for (const n of MEAN_PERIODS) {
				const errs: Partial<Record<Tf, number>> = {}
				let maxAbs = 0
				let ok = true
				for (const d of L) {
					const v = meanAt(d.src[s], d.i0, n, k)
					if (!Number.isFinite(v)) {
						ok = false
						break
					}
					const e = pct(v, ANCHORS[d.tf].mean)
					errs[d.tf] = e
					maxAbs = Math.max(maxAbs, Math.abs(e))
				}
				if (ok) meanCands.push({ src: s, kind: k, n, errs, maxAbs })
			}
	meanCands.sort((a, b) => a.maxAbs - b.maxAbs)

	push('## 3. Средняя линия — 4 чистых якоря')
	push()
	push('| # | источник | тип | период | 5m % | 15m % | 1h % | 4h % | max abs % |')
	push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
	meanCands.slice(0, 15).forEach((c, k) => {
		push(
			`| ${k + 1} | ${c.src} | ${c.kind} | ${c.n} | ${f3(c.errs['5m'] ?? NaN)} | ${f3(c.errs['15m'] ?? NaN)} | ` +
				`${f3(c.errs['1h'] ?? NaN)} | ${f3(c.errs['4h'] ?? NaN)} | ${f3(c.maxAbs)} |`,
		)
	})
	push()

	// ------------------------------------------------------------- отклонение
	push('## 4. Отклонение — замеры и что из них следует')
	push()
	push('| ТФ | полуспред | dev при k=5.6 | dev при k=9.6 | dev из прежних замеров |')
	push('| --- | --- | --- | --- | --- |')
	const implied: Record<Tf, Partial<Record<number, number>>> = { '5m': {}, '15m': {}, '1h': {}, '4h': {} }
	for (const tf of TFS) {
		const a = ANCHORS[tf]
		if (a.upper !== undefined && a.lower !== undefined) {
			const half = (a.upper - a.lower) / 2
			for (const k of MULTS) implied[tf][k] = half / k
			push(`| ${tf} | ${f2(half)} | ${f2(half / 5.6)} | ${f2(half / 9.6)} | ${a.devLegacy ? f2(a.devLegacy) : '—'} |`)
		} else if (a.devLegacy !== undefined) {
			for (const k of MULTS) implied[tf][k] = a.devLegacy
			push(`| ${tf} | — | ${f2(a.devLegacy)} | ${f2(a.devLegacy)} | ${f2(a.devLegacy)} |`)
		}
	}
	push()
	push('ВАЖНО: у 5m и 4h отклонение выведено из самих линий, у 15m и 1h взято из прежних замеров,')
	push('где соглашение по множителю неизвестно. Поэтому 5m и 4h — первичные, 15m и 1h — перекрёстная проверка.')
	push()

	for (const k of MULTS) {
		type DevCand = { kind: DevKind; n: number; errs: Partial<Record<Tf, number>>; maxAbs: number }
		const cands: DevCand[] = []
		for (const dk of DEV_KINDS)
			for (const n of DEV_PERIODS) {
				const errs: Partial<Record<Tf, number>> = {}
				let maxAbs = 0
				let ok = true
				for (const d of L) {
					const want = implied[d.tf][k]
					if (want === undefined) continue
					const v = devAt(d.candles, d.tr, d.i0, n, dk)
					if (!Number.isFinite(v)) {
						ok = false
						break
					}
					const e = pct(v, want)
					errs[d.tf] = e
					maxAbs = Math.max(maxAbs, Math.abs(e))
				}
				if (ok) cands.push({ kind: dk, n, errs, maxAbs })
			}
		cands.sort((a, b) => a.maxAbs - b.maxAbs)
		push(`### 4.${k === 5.6 ? 1 : 2}. Сетка при k = ${k}`)
		push()
		push('| # | мера | период | 5m % | 15m % | 1h % | 4h % | max abs % |')
		push('| --- | --- | --- | --- | --- | --- | --- | --- |')
		cands.slice(0, 15).forEach((c, i) => {
			push(
				`| ${i + 1} | ${c.kind} | ${c.n} | ${f3(c.errs['5m'] ?? NaN)} | ${f3(c.errs['15m'] ?? NaN)} | ` +
					`${f3(c.errs['1h'] ?? NaN)} | ${f3(c.errs['4h'] ?? NaN)} | ${f3(c.maxAbs)} |`,
			)
		})
		push()
	}

	// ------------------------------------------- бары или время: прямой тест
	push('## 5. Ключевой тест: окно в БАРАХ или во ВРЕМЕНИ')
	push()
	push('Для каждой меры ищется период, точно попадающий в замер, ОТДЕЛЬНО на каждом ТФ.')
	push('Периоды примерно равны по ТФ — окно в барах. Растут обратно пропорционально ТФ')
	push('(порядка 2400 / 800 / 200 / 50) — окно во времени.')
	push()
	for (const k of MULTS) {
		push(`### 5.${k === 5.6 ? 1 : 2}. При k = ${k}`)
		push()
		push('| мера | 5m: период (ошибка %) | 15m | 1h | 4h | вывод |')
		push('| --- | --- | --- | --- | --- | --- |')
		for (const dk of DEV_KINDS) {
			const best: Partial<Record<Tf, { n: number; err: number }>> = {}
			for (const d of L) {
				const want = implied[d.tf][k]
				if (want === undefined) continue
				const top = Math.min(3000, d.i0)
				let bn = NaN
				let be = Infinity
				for (let n = 5; n <= top; n += 5) {
					const v = devAt(d.candles, d.tr, d.i0, n, dk)
					if (!Number.isFinite(v)) continue
					const e = Math.abs(pct(v, want))
					if (e < be) {
						be = e
						bn = n
					}
				}
				if (Number.isFinite(bn)) best[d.tf] = { n: bn, err: be }
			}
			const cell = (tf: Tf): string => {
				const b = best[tf]
				return b ? `${b.n} (${f3(b.err)})` : '—'
			}
			const ns = TFS.map((tf) => best[tf]?.n).filter((n): n is number => n !== undefined)
			let verdict = 'мало данных'
			if (ns.length >= 3) {
				const spread = Math.max(...ns) / Math.min(...ns)
				verdict = spread < 1.6 ? 'бары' : spread > 6 ? 'время' : 'ни то ни то'
			}
			push(`| ${dk} | ${cell('5m')} | ${cell('15m')} | ${cell('1h')} | ${cell('4h')} | ${verdict} |`)
		}
		push()
	}

	// --------------------------------------------- две гипотезы в лоб
	push('## 6. Две гипотезы напрямую')
	push()
	push('| гипотеза | k | мера | 5m % | 15m % | 1h % | 4h % | max abs % |')
	push('| --- | --- | --- | --- | --- | --- | --- | --- |')
	for (const [name, quartet] of [
		['200 баров', BARS_QUARTET],
		['200 часов во времени', TIME_QUARTET],
	] as Array<[string, Record<Tf, number>]>) {
		for (const k of MULTS)
			for (const dk of DEV_KINDS) {
				const errs: Partial<Record<Tf, number>> = {}
				let maxAbs = 0
				for (const d of L) {
					const want = implied[d.tf][k]
					if (want === undefined) continue
					const v = devAt(d.candles, d.tr, d.i0, quartet[d.tf], dk)
					if (!Number.isFinite(v)) continue
					const e = pct(v, want)
					errs[d.tf] = e
					maxAbs = Math.max(maxAbs, Math.abs(e))
				}
				push(
					`| ${name} | ${k} | ${dk} | ${f3(errs['5m'] ?? NaN)} | ${f3(errs['15m'] ?? NaN)} | ` +
						`${f3(errs['1h'] ?? NaN)} | ${f3(errs['4h'] ?? NaN)} | ${f3(maxAbs)} |`,
				)
			}
	}
	push()
	push('## 7. Что дальше')
	push()
	push('Кандидат принимается только при max abs <= 5% одновременно на всех доступных якорях.')
	push('Иначе вывод отрицательный, и нужны новые замеры строки статуса с других дат.')
	push()

	writeFileSync(`${OUT}/apex-anchors.md`, report.join('\n'))
	writeFileSync(
		`${OUT}/apex-anchors.json`,
		JSON.stringify(
			{
				anchorMs: ANCHOR_MS,
				anchors: ANCHORS,
				loaded: L.map((d) => ({ tf: d.tf, bars: d.candles.length, i0: d.i0 })),
				meanTop: meanCands.slice(0, 40),
			},
			null,
			1,
		),
	)
	console.log(`готово: ${OUT}/apex-anchors.md`)
}

await main()
