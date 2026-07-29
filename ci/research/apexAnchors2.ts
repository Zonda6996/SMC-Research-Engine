// apexAnchors2.ts — калибровка Zonda Apex по структуре, подтверждённой настройками вендора.
//
// ЧТО ИЗВЕСТНО ТОЧНО (со скринов окна настроек):
//   Источник цены = (МАКС+МИН+ЗАКР)/3, то есть hlc3.
//   Lookback Period = 200. Inner Multiplier = 5.6. Outer Amplitude = 9.6.
//   Плоты: Mean, Upper Zone Upper Line, Upper Zone Lower Line,
//          Lower Zone Upper Line, Lower Zone Lower Line + две заливки.
//
// Пять чисел в строке статуса — это ровно эти пять линий. Сигнальных плотов в
// этом индикаторе нет вообще.
//
// КЛЮЧЕВОЕ: четыре линии зон дают отклонение ОДНОЗНАЧНО, без догадок о том,
// какой множитель виден на скрине. Арифметика на живых замерах показала, что полосы
// симметричны НЕ по разности (mean ± k*d), а по отношению:
//     верх = mean * exp(+k*s),  низ = mean * exp(-k*s)
// где s — ОТНОСИТЕЛЬНАЯ (безразмерная) мера разброса. Это объясняет асимметрию
// 5.83% на 4h из прошлого прогона: в лог-шкале она ровно нуль.
//
// Скрипт ничего из этого не принимает на веру: раздел 1 выводит четыре НЕЗАВИСИМЫХ
// оценки s из каждого замера и их разброс. Если модель неверна, разброс будет большим.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const K_IN = 5.6
const K_OUT = 9.6

/** Зафиксировано ДО прогона. */
const RULE: string[] = [
	'1. Подбор идёт ТОЛЬКО на якорях 20.07 (split=fit). Замеры 28.07 (split=test) в подборе НЕ участвуют.',
	'2. Критерий — минимум МАКСИМАЛЬНОЙ абсолютной ошибки по якорям fit, а не средней.',
	'3. Пороги приёмки: средняя линия — max|err| <= 0.2%; отклонение — max|err| <= 3% на fit И <= 3% на test.',
	'4. Параметры из окна настроек считаются истиной: источник hlc3, период 200, множители 5.6 и 9.6.',
	'   Полный перебор периодов всё равно делается — как проверка, что 200 и есть оптимум, а не совпадение.',
	'5. При разнице в пределах 0.5% предпочитается канонический вариант: период 200 и простейшая мера.',
	'6. Граница train/test 01.01.2025 здесь не применяется: это обратная разработка формулы. Роль test играют замеры с другой даты.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number }
type Tf = '5m' | '15m' | '1h' | '4h'
type SrcKind = 'hlc3' | 'close' | 'hl2' | 'ohlc4'
type MeanKind = 'sma' | 'ema' | 'rma' | 'wma'
type SigKind =
	| 'stdevLogRet'
	| 'madLogRet'
	| 'rmsLogRet'
	| 'stdevLogSrc'
	| 'stdevRelSrc'
	| 'atrSmaRel'
	| 'hlSmaRel'
	| 'donchHalfRel'

const TFS: Tf[] = ['5m', '15m', '1h', '4h']

type Lines = { mean: number; inUp?: number; inDn?: number; outUp?: number; outDn?: number }
type Anchor = {
	id: string
	tf: Tf
	tMs: number
	split: 'fit' | 'test'
	lines: Lines
	ohlc?: [number, number, number, number]
}

// Все значения — со строки статуса вендора при наведении на бар (то есть положение
// линий ИМЕННО на этом баре, а не на текущем). Время — открытие бара в UTC.
// Скрины подписаны в часовом поясе пользователя UTC+5, поэтому 21:00 местных = 16:00 UTC.
const ANCHORS: Anchor[] = [
	// --- fit: 20.07.2026 12:00 UTC (17:00 местных), старые скрины.
	// Видна была только одна пара линий; лог-симметрия опознала её как внутреннюю (5.6).
	{
		id: '5m@20.07 12:00',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 64250.82, inUp: 64835.88, inDn: 63671.03 },
		ohlc: [65002.0, 65002.83, 64716.57, 64803.99],
	},
	{
		id: '15m@20.07 12:00',
		tf: '15m',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 64526.7 },
		ohlc: [65002.0, 65002.83, 64716.57, 64750.0],
	},
	{
		id: '1h@20.07 12:00',
		tf: '1h',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 64281.12 },
		ohlc: [65002.0, 65002.83, 64599.89, 64640.0],
	},
	{
		id: '4h@20.07 12:00',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 63533.87, inUp: 67351.71, inDn: 59932.45 },
		ohlc: [65002.0, 65666.8, 64077.76, 65598.75],
	},
	// --- test: 28.07.2026, новые скрины, все пять линий.
	{
		id: '5m@28.07 08:00',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 8, 0),
		split: 'test',
		lines: { mean: 63385.64, inUp: 63764.37, inDn: 63009.16, outUp: 64036.28, outDn: 62741.61 },
		ohlc: [63506.0, 63530.87, 63468.35, 63525.62],
	},
	{
		id: '4h@28.07 08:00',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 8, 0),
		split: 'test',
		lines: { mean: 64805.28, inUp: 68107.36, inDn: 61663.29, outUp: 70568.52, outDn: 59512.72 },
		ohlc: [63506.0, 63593.0, 63294.0, 63450.0],
	},
	{
		id: '5m@28.07 16:00',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 16, 0),
		split: 'test',
		lines: { mean: 63400.23, inUp: 63959.28, inDn: 62846.06, outUp: 64361.62, outDn: 62453.19 },
		ohlc: [63928.46, 63936.0, 63886.0, 63886.01],
	},
	{
		id: '4h@28.07 16:00',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 16, 0),
		split: 'test',
		lines: { mean: 64818.43, inUp: 68110.28, inDn: 61685.69, outUp: 70563.46, outDn: 59541.15 },
		ohlc: [63928.46, 64100.0, 63504.0, 63904.0],
	},
]

// ------------------------------------------------------------------ загрузка
const BASE = 'https://data.binance.vision/data/spot'
const MONTHS: string[] = []
for (const m of [9, 10, 11, 12]) MONTHS.push(`2025-${String(m).padStart(2, '0')}`)
for (const m of [1, 2, 3, 4, 5, 6]) MONTHS.push(`2026-${String(m).padStart(2, '0')}`)
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)

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
		if (!Number.isFinite(t)) continue
		if (t > 1e14) t = Math.floor(t / 1000)
		const c: Cndl = { t, o: Number(p[1]), h: Number(p[2]), l: Number(p[3]), c: Number(p[4]) }
		if (Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c)) out.push(c)
	}
	return out
}

async function load(tf: Tf): Promise<Cndl[]> {
	const urls = [
		...MONTHS.map((m) => `${BASE}/monthly/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${m}.zip`),
		...DAYS.map((d) => `${BASE}/daily/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${d}.zip`),
	]
	const all: Cndl[] = []
	for (const u of urls) {
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

function winStdev(x: number[], i: number, n: number): number {
	let s = 0
	let q = 0
	for (let k = 0; k < n; k++) {
		const v = x[i - k]!
		s += v
		q += v * v
	}
	const m = s / n
	return Math.sqrt(Math.max(0, q / n - m * m))
}

function winMad(x: number[], i: number, n: number): number {
	let s = 0
	for (let k = 0; k < n; k++) s += x[i - k]!
	const m = s / n
	let d = 0
	for (let k = 0; k < n; k++) d += Math.abs(x[i - k]! - m)
	return d / n
}

function winRms(x: number[], i: number, n: number): number {
	let q = 0
	for (let k = 0; k < n; k++) q += x[i - k]! * x[i - k]!
	return Math.sqrt(q / n)
}

function winMean(x: number[], i: number, n: number): number {
	let s = 0
	for (let k = 0; k < n; k++) s += x[i - k]!
	return s / n
}

type Series = {
	tf: Tf
	candles: Cndl[]
	src: Record<SrcKind, number[]>
	logRet: number[]
	logSrc: number[]
	tr: number[]
	hl: number[]
}

/** Значение относительной меры разброса на баре i, окно n. Безразмерная. */
function sigAt(s: Series, i: number, n: number, kind: SigKind): number {
	if (i + 1 < n || i < 1) return NaN
	const px = srcAt(s.candles[i]!, 'hlc3')
	switch (kind) {
		case 'stdevLogRet':
			return winStdev(s.logRet, i, n)
		case 'madLogRet':
			return winMad(s.logRet, i, n)
		case 'rmsLogRet':
			return winRms(s.logRet, i, n)
		case 'stdevLogSrc':
			return winStdev(s.logSrc, i, n)
		case 'stdevRelSrc':
			return winStdev(s.src.hlc3, i, n) / winMean(s.src.hlc3, i, n)
		case 'atrSmaRel':
			return winMean(s.tr, i, n) / px
		case 'hlSmaRel':
			return winMean(s.hl, i, n) / px
		case 'donchHalfRel': {
			let hi = -Infinity
			let lo = Infinity
			for (let k = 0; k < n; k++) {
				const c = s.candles[i - k]!
				if (c.h > hi) hi = c.h
				if (c.l < lo) lo = c.l
			}
			return (hi - lo) / 2 / px
		}
		default:
			return NaN
	}
}

const SRCS: SrcKind[] = ['hlc3', 'close', 'hl2', 'ohlc4']
const MEAN_KINDS: MeanKind[] = ['sma', 'ema', 'rma', 'wma']
const SIG_KINDS: SigKind[] = [
	'stdevLogRet',
	'madLogRet',
	'rmsLogRet',
	'stdevLogSrc',
	'stdevRelSrc',
	'atrSmaRel',
	'hlSmaRel',
	'donchHalfRel',
]
const PERIODS: number[] = []
for (let n = 10; n <= 400; n += 1) PERIODS.push(n)
for (let n = 420; n <= 1200; n += 20) PERIODS.push(n)

const pct = (got: number, want: number): number => ((got - want) / want) * 100
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'н/д')
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : 'н/д')
const f6 = (x: number): string => (Number.isFinite(x) ? x.toFixed(6) : 'н/д')

/** Четыре независимые оценки s из линий замера. Разброс = проверка модели. */
function sigmaFromLines(l: Lines): { parts: Array<{ tag: string; s: number }>; s: number; spreadPct: number } {
	const parts: Array<{ tag: string; s: number }> = []
	if (l.inUp !== undefined) parts.push({ tag: 'внутр.верх', s: Math.log(l.inUp / l.mean) / K_IN })
	if (l.inDn !== undefined) parts.push({ tag: 'внутр.низ', s: Math.log(l.mean / l.inDn) / K_IN })
	if (l.outUp !== undefined) parts.push({ tag: 'внешн.верх', s: Math.log(l.outUp / l.mean) / K_OUT })
	if (l.outDn !== undefined) parts.push({ tag: 'внешн.низ', s: Math.log(l.mean / l.outDn) / K_OUT })
	const vals = parts.map((p) => p.s)
	const s = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
	const spreadPct = vals.length > 1 ? ((Math.max(...vals) - Math.min(...vals)) / s) * 100 : 0
	return { parts, s, spreadPct }
}

async function main(): Promise<void> {
	mkdirSync(CACHE, { recursive: true })
	mkdirSync(OUT, { recursive: true })

	const rep: string[] = []
	const push = (s = ''): void => {
		rep.push(s)
	}

	push('# Zonda Apex — калибровка v2 (структура из настроек вендора)')
	push()
	push(`- прогон ${process.env.GITHUB_RUN_ID ?? 'local'}, коммит ${process.env.GITHUB_SHA ?? 'local'}, ${new Date().toISOString()}`)
	push('- из настроек: источник hlc3, Lookback 200, Inner 5.6, Outer 9.6')
	push('- модель: верх = mean*exp(+k*s), низ = mean*exp(-k*s), s безразмерное')
	push()
	push('## Правило отбора (зафиксировано в коде до прогона)')
	push()
	for (const r of RULE) push(r)
	push()

	// ------------------------------------------- 1. проверка лог-симметрии
	push('## 1. Проверка модели: четыре независимые оценки s из одного замера')
	push()
	push('Если модель верна, все оценки одного замера совпадут. Разброс — мера ошибки модели.')
	push()
	push('| замер | split | внутр.верх | внутр.низ | внешн.верх | внешн.низ | s итог | разброс % |')
	push('| --- | --- | --- | --- | --- | --- | --- | --- |')
	const sigma = new Map<string, number>()
	for (const a of ANCHORS) {
		const { parts, s, spreadPct } = sigmaFromLines(a.lines)
		if (parts.length === 0) {
			push(`| ${a.id} | ${a.split} | — | — | — | — | только средняя | — |`)
			continue
		}
		sigma.set(a.id, s)
		const get = (tag: string): string => {
			const p = parts.find((x) => x.tag === tag)
			return p ? f6(p.s) : '—'
		}
		push(
			`| ${a.id} | ${a.split} | ${get('внутр.верх')} | ${get('внутр.низ')} | ${get('внешн.верх')} | ` +
				`${get('внешн.низ')} | ${f6(s)} | ${f3(spreadPct)} |`,
		)
	}
	push()
	push('Для сравнения: та же проверка в РАЗНОСТНОЙ модели (mean ± k*d), где d в цене:')
	push()
	push('| замер | d внутр.верх | d внутр.низ | d внешн.верх | d внешн.низ | разброс % |')
	push('| --- | --- | --- | --- | --- | --- |')
	for (const a of ANCHORS) {
		const l = a.lines
		const ds: number[] = []
		const cell: string[] = []
		for (const [v, k] of [
			[l.inUp, K_IN],
			[l.inDn, K_IN],
			[l.outUp, K_OUT],
			[l.outDn, K_OUT],
		] as Array<[number | undefined, number]>) {
			if (v === undefined) {
				cell.push('—')
				continue
			}
			const d = Math.abs(v - l.mean) / k
			ds.push(d)
			cell.push(f2(d))
		}
		if (ds.length === 0) continue
		const spread = ((Math.max(...ds) - Math.min(...ds)) / (ds.reduce((x, y) => x + y, 0) / ds.length)) * 100
		push(`| ${a.id} | ${cell.join(' | ')} | ${f3(spread)} |`)
	}
	push()

	// ---------------------------------------------------- загрузка и сверка
	const series = new Map<Tf, Series>()
	for (const tf of TFS) {
		const candles = await load(tf)
		const src = {
			hlc3: candles.map((x) => srcAt(x, 'hlc3')),
			close: candles.map((x) => srcAt(x, 'close')),
			hl2: candles.map((x) => srcAt(x, 'hl2')),
			ohlc4: candles.map((x) => srcAt(x, 'ohlc4')),
		} satisfies Record<SrcKind, number[]>
		const logRet = candles.map((c, i) => (i === 0 ? 0 : Math.log(c.c / candles[i - 1]!.c)))
		const logSrc = src.hlc3.map((v) => Math.log(v))
		const tr = candles.map((x, i) =>
			i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - candles[i - 1]!.c), Math.abs(x.l - candles[i - 1]!.c)),
		)
		const hl = candles.map((x) => x.h - x.l)
		series.set(tf, { tf, candles, src, logRet, logSrc, tr, hl })
		console.log(`${tf}: ${candles.length} баров`)
	}

	const idx = new Map<string, number>()
	push('## 2. Сверка баров со скринами (проверка источника данных)')
	push()
	push('| замер | индекс | O | H | L | C | совпало |')
	push('| --- | --- | --- | --- | --- | --- | --- |')
	for (const a of ANCHORS) {
		const s = series.get(a.tf)!
		const i = s.candles.findIndex((c) => c.t === a.tMs)
		if (i < 0) {
			push(`| ${a.id} | бар НЕ НАЙДЕН | | | | | НЕТ |`)
			continue
		}
		idx.set(a.id, i)
		const c = s.candles[i]!
		const o = a.ohlc
		const ok =
			o === undefined
				? false
				: Math.abs(c.o - o[0]) < 0.011 &&
					Math.abs(c.h - o[1]) < 0.011 &&
					Math.abs(c.l - o[2]) < 0.011 &&
					Math.abs(c.c - o[3]) < 0.011
		push(`| ${a.id} | ${i} | ${f2(c.o)} | ${f2(c.h)} | ${f2(c.l)} | ${f2(c.c)} | ${ok ? 'да' : 'НЕТ'} |`)
	}
	push()

	// ------------------------------------------------------ 3. средняя линия
	type MC = { src: SrcKind; kind: MeanKind; n: number; fitMax: number; testMax: number; errs: Map<string, number> }
	const mcs: MC[] = []
	for (const sk of SRCS)
		for (const mk of MEAN_KINDS)
			for (const n of PERIODS) {
				const errs = new Map<string, number>()
				let fitMax = 0
				let testMax = 0
				let ok = true
				for (const a of ANCHORS) {
					const i = idx.get(a.id)
					if (i === undefined) continue
					const v = meanAt(series.get(a.tf)!.src[sk], i, n, mk)
					if (!Number.isFinite(v)) {
						ok = false
						break
					}
					const e = pct(v, a.lines.mean)
					errs.set(a.id, e)
					if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
					else testMax = Math.max(testMax, Math.abs(e))
				}
				if (ok && errs.size > 0) mcs.push({ src: sk, kind: mk, n, fitMax, testMax, errs })
			}
	mcs.sort((x, y) => x.fitMax - y.fitMax)

	const anchorIds = ANCHORS.map((a) => a.id)
	const headRow = `| # | источник | тип | период | fit max % | test max % | ${anchorIds.join(' | ')} |`
	const sepRow = `| ${Array.from({ length: 6 + anchorIds.length }, () => '---').join(' | ')} |`

	push('## 3. Средняя линия: подбор на fit, проверка на test')
	push()
	push(headRow)
	push(sepRow)
	mcs.slice(0, 15).forEach((c, k) => {
		const cells = anchorIds.map((id) => f3(c.errs.get(id) ?? NaN))
		push(`| ${k + 1} | ${c.src} | ${c.kind} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ${cells.join(' | ')} |`)
	})
	push()
	push('### 3.1. Только период 200 и источник hlc3 — то есть ровно настройки вендора')
	push()
	push(headRow)
	push(sepRow)
	mcs
		.filter((c) => c.n === 200 && c.src === 'hlc3')
		.forEach((c, k) => {
			const cells = anchorIds.map((id) => f3(c.errs.get(id) ?? NaN))
			push(`| ${k + 1} | ${c.src} | ${c.kind} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ${cells.join(' | ')} |`)
		})
	push()
	push('### 3.2. Лучший период для каждого типа средней на hlc3 (проверка, что 200 — оптимум)')
	push()
	push('| тип | лучший период по fit | fit max % | там же test max % |')
	push('| --- | --- | --- | --- |')
	for (const mk of MEAN_KINDS) {
		const best = mcs.filter((c) => c.kind === mk && c.src === 'hlc3')[0]
		if (best) push(`| ${mk} | ${best.n} | ${f3(best.fitMax)} | ${f3(best.testMax)} |`)
	}
	push()

	// ------------------------------------------------------- 4. отклонение
	const sigAnchors = ANCHORS.filter((a) => sigma.has(a.id) && idx.has(a.id))
	const sigIds = sigAnchors.map((a) => a.id)
	type SC = { kind: SigKind; n: number; fitMax: number; testMax: number; errs: Map<string, number> }
	const scs: SC[] = []
	for (const sg of SIG_KINDS)
		for (const n of PERIODS) {
			const errs = new Map<string, number>()
			let fitMax = 0
			let testMax = 0
			let ok = true
			for (const a of sigAnchors) {
				const v = sigAt(series.get(a.tf)!, idx.get(a.id)!, n, sg)
				if (!Number.isFinite(v)) {
					ok = false
					break
				}
				const e = pct(v, sigma.get(a.id)!)
				errs.set(a.id, e)
				if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
				else testMax = Math.max(testMax, Math.abs(e))
			}
			if (ok && errs.size > 0) scs.push({ kind: sg, n, fitMax, testMax, errs })
		}
	scs.sort((x, y) => x.fitMax - y.fitMax)

	const sHead = `| # | мера | период | fit max % | test max % | ${sigIds.join(' | ')} |`
	const sSep = `| ${Array.from({ length: 5 + sigIds.length }, () => '---').join(' | ')} |`

	push('## 4. Отклонение s: подбор на fit, проверка на test')
	push()
	push('Целевые s взяты из раздела 1, то есть из сам