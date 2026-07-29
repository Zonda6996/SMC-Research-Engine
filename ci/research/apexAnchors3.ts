// apexAnchors3.ts — Zonda Apex, третий заход.
//
// Что уже доказано в v2:
//  - полосы логарифмически симметричны: верх = mean*exp(+k*s), низ = mean*exp(-k*s);
//  - множители 5.6 и 9.6 из настроек верны (внутренние и внешние линии дают одно s);
//  - все восемь баров сошлись со спотовым архивом до цента.
//
// Что не сошлось и зачем этот файл:
//  - при периоде 200 ни одна из четырёх простых средних не попадает в порог;
//    лучшие подбором — wma 133-135, то есть эффективный лаг около 45-50 баров.
//    При заявленном периоде 200 такой лаг дают быстрые семейства: hull, linreg,
//    alma, треугольная. Добавлены здесь.
//  - отклонение: не была проверена главная гипотеза — разброс ОСТАТКОВ вокруг
//    средней в лог-шкале, s = stdev(ln(src/ma)). Тогда одна пара тип-период
//    объясняет и среднюю, и ширину одновременно (раздел 5).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const K_IN = 5.6
const K_OUT = 9.6

const RULE: string[] = [
	'1. Подбор только на якорях 20.07 (fit). Замеры 28.07 (test) в подборе не участвуют.',
	'2. Критерий — минимум МАКСИМАЛЬНОЙ абсолютной ошибки по fit, не средней.',
	'3. Пороги: средняя <= 0.2%; отклонение <= 3% на fit И <= 3% на test.',
	'4. Совместный кандидат (раздел 5) считается принятым только если оба порога выполнены одновременно.',
	'5. При разнице в пределах 0.5% предпочитается период 200 и более простой тип.',
	'6. Граница train/test 01.01.2025 не применяется: это обратная разработка формулы.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number }
type Tf = '5m' | '15m' | '1h' | '4h'
type SrcKind = 'hlc3' | 'close' | 'hl2' | 'ohlc4'
type MaKind = 'sma' | 'ema' | 'rma' | 'wma' | 'hma' | 'tma' | 'lsma' | 'alma'
type ResKind = 'stdev' | 'mad' | 'rms'

const TFS: Tf[] = ['5m', '15m', '1h', '4h']
const SRCS: SrcKind[] = ['hlc3', 'close', 'hl2', 'ohlc4']
const MA_KINDS: MaKind[] = ['sma', 'ema', 'rma', 'wma', 'hma', 'tma', 'lsma', 'alma']
const CHEAP: MaKind[] = ['sma', 'ema', 'rma', 'wma']
const RES_KINDS: ResKind[] = ['stdev', 'mad', 'rms']

type Lines = { mean: number; inUp?: number; inDn?: number; outUp?: number; outDn?: number }
type Anchor = { id: string; tf: Tf; tMs: number; split: 'fit' | 'test'; lines: Lines }

const ANCHORS: Anchor[] = [
	{ id: '5m@20.07-12', tf: '5m', tMs: Date.UTC(2026, 6, 20, 12), split: 'fit', lines: { mean: 64250.82, inUp: 64835.88, inDn: 63671.03 } },
	{ id: '15m@20.07-12', tf: '15m', tMs: Date.UTC(2026, 6, 20, 12), split: 'fit', lines: { mean: 64526.7 } },
	{ id: '1h@20.07-12', tf: '1h', tMs: Date.UTC(2026, 6, 20, 12), split: 'fit', lines: { mean: 64281.12 } },
	{ id: '4h@20.07-12', tf: '4h', tMs: Date.UTC(2026, 6, 20, 12), split: 'fit', lines: { mean: 63533.87, inUp: 67351.71, inDn: 59932.45 } },
	{
		id: '5m@28.07-08',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 8),
		split: 'test',
		lines: { mean: 63385.64, inUp: 63764.37, inDn: 63009.16, outUp: 64036.28, outDn: 62741.61 },
	},
	{
		id: '4h@28.07-08',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 8),
		split: 'test',
		lines: { mean: 64805.28, inUp: 68107.36, inDn: 61663.29, outUp: 70568.52, outDn: 59512.72 },
	},
	{
		id: '5m@28.07-16',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 16),
		split: 'test',
		lines: { mean: 63400.23, inUp: 63959.28, inDn: 62846.06, outUp: 64361.62, outDn: 62453.19 },
	},
	{
		id: '4h@28.07-16',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 16),
		split: 'test',
		lines: { mean: 64818.43, inUp: 68110.28, inDn: 61685.69, outUp: 70563.46, outDn: 59541.15 },
	},
]

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

const srcAt = (c: Cndl, k: SrcKind): number =>
	k === 'hlc3' ? (c.h + c.l + c.c) / 3 : k === 'close' ? c.c : k === 'hl2' ? (c.h + c.l) / 2 : (c.o + c.h + c.l + c.c) / 4

// ---- оконные средние в одной точке ----
function sma(x: number[], i: number, n: number): number {
	let s = 0
	for (let k = 0; k < n; k++) s += x[i - k]!
	return s / n
}

function wma(x: number[], i: number, n: number): number {
	let s = 0
	let w = 0
	for (let k = 0; k < n; k++) {
		const ww = n - k
		s += x[i - k]! * ww
		w += ww
	}
	return s / w
}

function lsma(x: number[], i: number, n: number): number {
	let sy = 0
	let sty = 0
	const tbar = (n - 1) / 2
	let stt = 0
	for (let k = 0; k < n; k++) {
		const t = n - 1 - k
		const v = x[i - k]!
		sy += v
		sty += (t - tbar) * v
		stt += (t - tbar) * (t - tbar)
	}
	const b = stt === 0 ? 0 : sty / stt
	return sy / n + b * tbar
}

function alma(x: number[], i: number, n: number): number {
	const m = 0.85 * (n - 1)
	const s = n / 6
	let num = 0
	let den = 0
	for (let j = 0; j < n; j++) {
		const w = Math.exp(-((j - m) * (j - m)) / (2 * s * s))
		num += w * x[i - (n - 1) + j]!
		den += w
	}
	return num / den
}

function tma(x: number[], i: number, n: number): number {
	const p = Math.ceil(n / 2)
	const q = n - p + 1
	if (i + 1 < p + q - 1) return NaN
	let s = 0
	for (let k = 0; k < q; k++) s += sma(x, i - k, p)
	return s / q
}

function hma(x: number[], i: number, n: number): number {
	const half = Math.max(1, Math.floor(n / 2))
	const m = Math.max(1, Math.floor(Math.sqrt(n)))
	if (i + 1 < n + m) return NaN
	const raw: number[] = []
	for (let k = m - 1; k >= 0; k--) raw.push(2 * wma(x, i - k, half) - wma(x, i - k, n))
	let s = 0
	let w = 0
	for (let k = 0; k < m; k++) {
		const ww = m - k
		s += raw[m - 1 - k]! * ww
		w += ww
	}
	return s / w
}

/** Рекурсивные средние — одним проходом до i. */
function recAt(x: number[], i: number, n: number, kind: 'ema' | 'rma'): number {
	const a = kind === 'rma' ? 1 / n : 2 / (n + 1)
	let v = x[0]!
	for (let j = 1; j <= i; j++) v += a * (x[j]! - v)
	return v
}

function maAt(x: number[], i: number, n: number, kind: MaKind): number {
	if (i + 1 < n) return NaN
	switch (kind) {
		case 'sma':
			return sma(x, i, n)
		case 'wma':
			return wma(x, i, n)
		case 'ema':
			return recAt(x, i, n, 'ema')
		case 'rma':
			return recAt(x, i, n, 'rma')
		case 'lsma':
			return lsma(x, i, n)
		case 'alma':
			return alma(x, i, n)
		case 'tma':
			return tma(x, i, n)
		case 'hma':
			return hma(x, i, n)
		default:
			return NaN
	}
}

// ---- простые безразмерные меры ----
function winMean(x: number[], i: number, n: number): number {
	let s = 0
	for (let k = 0; k < n; k++) s += x[i - k]!
	return s / n
}

type Series = { tf: Tf; candles: Cndl[]; src: Record<SrcKind, number[]>; tr: number[] }

/** Разброс остатков ln(src/ma) в окне n вокруг средней того же типа и периода. */
function resSpread(x: number[], i: number, n: number, kind: MaKind, res: ResKind): number {
	if (i + 1 < 2 * n) return NaN
	const e: number[] = []
	for (let k = 0; k < n; k++) {
		const m = maAt(x, i - k, n, kind)
		if (!Number.isFinite(m) || m <= 0) return NaN
		e.push(Math.log(x[i - k]! / m))
	}
	if (res === 'rms') {
		let q = 0
		for (const v of e) q += v * v
		return Math.sqrt(q / e.length)
	}
	let s = 0
	for (const v of e) s += v
	const mu = s / e.length
	if (res === 'mad') {
		let d = 0
		for (const v of e) d += Math.abs(v - mu)
		return d / e.length
	}
	let q = 0
	for (const v of e) q += (v - mu) * (v - mu)
	return Math.sqrt(q / e.length)
}

const P_FULL: number[] = []
for (let n = 10; n <= 400; n += 1) P_FULL.push(n)
for (let n = 420; n <= 1200; n += 20) P_FULL.push(n)
const P_CHEAPGRID: number[] = []
for (let n = 10; n <= 400; n += 1) P_CHEAPGRID.push(n)
const P_RES: number[] = []
for (let n = 20; n <= 400; n += 2) P_RES.push(n)

const pct = (got: number, want: number): number => ((got - want) / want) * 100
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'н/д')
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : 'н/д')
const f6 = (x: number): string => (Number.isFinite(x) ? x.toFixed(6) : 'н/д')

function sigmaFromLines(l: Lines): number {
	const v: number[] = []
	if (l.inUp !== undefined) v.push(Math.log(l.inUp / l.mean) / K_IN)
	if (l.inDn !== undefined) v.push(Math.log(l.mean / l.inDn) / K_IN)
	if (l.outUp !== undefined) v.push(Math.log(l.outUp / l.mean) / K_OUT)
	if (l.outDn !== undefined) v.push(Math.log(l.mean / l.outDn) / K_OUT)
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

async function main(): Promise<void> {
	mkdirSync(CACHE, { recursive: true })
	mkdirSync(OUT, { recursive: true })
	const rep: string[] = []
	const push = (s = ''): void => {
		rep.push(s)
	}

	push('# Zonda Apex — калибровка v3')
	push()
	push(`- прогон ${process.env.GITHUB_RUN_ID ?? 'local'}, ${new Date().toISOString()}`)
	push('- модель из v2 (доказана): верх = mean*exp(+k*s), низ = mean*exp(-k*s), k = 5.6 и 9.6')
	push('- задача v3: найти тип средней и меру s, согласованные на двух датах сразу')
	push()
	push('## Правило отбора (зафиксировано в коде до прогона)')
	push()
	for (const r of RULE) push(r)
	push()

	const series = new Map<Tf, Series>()
	for (const tf of TFS) {
		const candles = await load(tf)
		series.set(tf, {
			tf,
			candles,
			src: {
				hlc3: candles.map((x) => srcAt(x, 'hlc3')),
				close: candles.map((x) => srcAt(x, 'close')),
				hl2: candles.map((x) => srcAt(x, 'hl2')),
				ohlc4: candles.map((x) => srcAt(x, 'ohlc4')),
			} satisfies Record<SrcKind, number[]>,
			tr: candles.map((x, i) =>
				i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - candles[i - 1]!.c), Math.abs(x.l - candles[i - 1]!.c)),
			),
		})
		console.log(`${tf}: ${candles.length} баров`)
	}

	const idx = new Map<string, number>()
	const sigma = new Map<string, number>()
	for (const a of ANCHORS) {
		const i = series.get(a.tf)!.candles.findIndex((c) => c.t === a.tMs)
		if (i >= 0) idx.set(a.id, i)
		const s = sigmaFromLines(a.lines)
		if (Number.isFinite(s)) sigma.set(a.id, s)
	}
	const live = ANCHORS.filter((a) => idx.has(a.id))
	const ids = live.map((a) => a.id)
	const sigLive = live.filter((a) => sigma.has(a.id))
	const sIds = sigLive.map((a) => a.id)

	push('## 1. Целевые значения')
	push()
	push('| замер | split | индекс | средняя | s | s в % цены |')
	push('| --- | --- | --- | --- | --- | --- |')
	for (const a of live) {
		const s = sigma.get(a.id)
		push(
			`| ${a.id} | ${a.split} | ${idx.get(a.id)} | ${f2(a.lines.mean)} | ${s === undefined ? '—' : f6(s)} | ` +
				`${s === undefined ? '—' : f3(s * 100)} |`,
		)
	}
	push()

	// ---------------- 2. средняя: расширенный перебор
	type MC = { src: SrcKind; kind: MaKind; n: number; fitMax: number; testMax: number; errs: Map<string, number> }
	const mcs: MC[] = []
	for (const sk of SRCS)
		for (const mk of MA_KINDS) {
			const grid = CHEAP.includes(mk) ? P_FULL : P_CHEAPGRID
			for (const n of grid) {
				const errs = new Map<string, number>()
				let fitMax = 0
				let testMax = 0
				let ok = true
				for (const a of live) {
					const v = maAt(series.get(a.tf)!.src[sk], idx.get(a.id)!, n, mk)
					if (!Number.isFinite(v)) {
						ok = false
						break
					}
					const e = pct(v, a.lines.mean)
					errs.set(a.id, e)
					if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
					else testMax = Math.max(testMax, Math.abs(e))
				}
				if (ok) mcs.push({ src: sk, kind: mk, n, fitMax, testMax, errs })
			}
		}
	mcs.sort((x, y) => x.fitMax - y.fitMax)
	console.log(`средние: ${mcs.length} кандидатов`)

	const mHead = `| # | источник | тип | период | fit max % | test max % | ${ids.join(' | ')} |`
	const mSep = `| ${Array.from({ length: 6 + ids.length }, () => '---').join(' | ')} |`
	const mRow = (c: MC, k: number): string =>
		`| ${k + 1} | ${c.src} | ${c.kind} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ${ids
			.map((id) => f3(c.errs.get(id) ?? NaN))
			.join(' | ')} |`

	push('## 2. Средняя линия, расширенный набор типов')
	push()
	push(mHead)
	push(mSep)
	mcs.slice(0, 20).forEach((c, k) => push(mRow(c, k)))
	push()
	push('### 2.1. Ровно настройки вендора: hlc3, период 200, все типы')
	push()
	push(mHead)
	push(mSep)
	mcs
		.filter((c) => c.src === 'hlc3' && c.n === 200)
		.sort((x, y) => x.fitMax - y.fitMax)
		.forEach((c, k) => push(mRow(c, k)))
	push()
	push('### 2.2. Лучший период каждого типа на hlc3')
	push()
	push('| тип | лучший период | fit max % | test max % | при периоде 200: fit % / test % |')
	push('| --- | --- | --- | --- | --- |')
	for (const mk of MA_KINDS) {
		const b = mcs.find((c) => c.kind === mk && c.src === 'hlc3')
		const at200 = mcs.find((c) => c.kind === mk && c.src === 'hlc3' && c.n === 200)
		if (b)
			push(
				`| ${mk} | ${b.n} | ${f3(b.fitMax)} | ${f3(b.testMax)} | ` +
					`${at200 ? `${f3(at200.fitMax)} / ${f3(at200.testMax)}` : 'н/д'} |`,
			)
	}
	push()

	// ---------------- 3. простые меры s (atr и диапазон, отнесённые к цене)
	type SC = { label: string; n: number; fitMax: number; testMax: number; errs: Map<string, number> }
	const sHead = `| # | мера | период | fit max % | test max % | ${sIds.join(' | ')} |`
	const sSep = `| ${Array.from({ length: 5 + sIds.length }, () => '---').join(' | ')} |`
	const sRow = (c: SC, k: number): string =>
		`| ${k + 1} | ${c.label} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ${sIds
			.map((id) => f3(c.errs.get(id) ?? NaN))
			.join(' | ')} |`

	const simple: SC[] = []
	for (const n of P_FULL) {
		const errs = new Map<string, number>()
		let fitMax = 0
		let testMax = 0
		let ok = true
		for (const a of sigLive) {
			const s = series.get(a.tf)!
			const i = idx.get(a.id)!
			if (i + 1 < n) {
				ok = false
				break
			}
			const v = winMean(s.tr, i, n) / s.src.hlc3[i]!
			const e = pct(v, sigma.get(a.id)!)
			errs.set(a.id, e)
			if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
			else testMax = Math.max(testMax, Math.abs(e))
		}
		if (ok) simple.push({ label: 'atr/цена', n, fitMax, testMax, errs })
	}
	simple.sort((x, y) => x.fitMax - y.fitMax)
	push('## 3. Простая мера atr/цена — лучшее из v2, повторяется для сравнения')
	push()
	push(sHead)
	push(sSep)
	simple.slice(0, 8).forEach((c, k) => push(sRow(c, k)))
	push()

	// ---------------- 4. отклонение на остатках вокруг средней
	type RC = {
		kind: MaKind
		res: ResKind
		n: number
		fitMax: number
		testMax: number
		meanFit: number
		meanTest: number
		errs: Map<string, number>
	}
	const rcs: RC[] = []
	for (const mk of MA_KINDS)
		for (const rk of RES_KINDS)
			for (const n of P_RES) {
				const errs = new Map<string, number>()
				let fitMax = 0
				let testMax = 0
				let ok = true
				for (const a of sigLive) {
					const v = resSpread(series.get(a.tf)!.src.hlc3, idx.get(a.id)!, n, mk, rk)
					if (!Number.isFinite(v)) {
						ok = false
						break
					}
					const e = pct(v, sigma.get(a.id)!)
					errs.set(a.id, e)
					if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
					else testMax = Math.max(testMax, Math.abs(e))
				}
				if (!ok) continue
				const mc = mcs.find((c) => c.src === 'hlc3' && c.kind === mk && c.n === n)
				rcs.push({
					kind: mk,
					res: rk,
					n,
					fitMax,
					testMax,
					meanFit: mc ? mc.fitMax : NaN,
					meanTest: mc ? mc.testMax : NaN,
					errs,
				})
			}
	rcs.sort((x, y) => x.fitMax - y.fitMax)
	console.log(`остатки: ${rcs.length} кандидатов`)

	const rHead = `| # | тип средней | разброс | период | s fit % | s test % | средняя fit % | средняя test % | ${sIds.join(' | ')} |`
	const rSep = `| ${Array.from({ length: 8 + sIds.length }, () => '---').join(' | ')} |`
	const rRow = (c: RC, k: number): string =>
		`| ${k + 1} | ${c.kind} | ${c.res} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ${f3(c.meanFit)} | ` +
		`${f3(c.meanTest)} | ${sIds.map((id) => f3(c.errs.get(id) ?? NaN)).join(' | ')} |`

	push('## 4. Отклонение как разброс остатков ln(src/ma) — главная гипотеза v3')
	push()
	push(rHead)
	push(rSep)
	rcs.slice(0, 25).forEach((c, k) => push(rRow(c, k)))
	push()
	push('### 4.1. Ровно период 200')
	push()
	push(rHead)
	push(rSep)
	rcs
		.filter((c) => c.n === 200)
		.sort((x, y) => x.fitMax - y.fitMax)
		.forEach((c, k) => push(rRow(c, k)))
	push()

	// ---------------- 5. совместный подбор
	const joint = rcs
		.filter((c) => Number.isFinite(c.meanFit))
		.map((c) => ({ c, worstFit: Math.max(c.fitMax / 3, c.meanFit / 0.2), worstTest: Math.max(c.testMax / 3, c.meanTest / 0.2) }))
		.sort((x, y) => x.worstFit - y.worstFit)
	push('## 5. Совместный кандидат: одна пара тип-период объясняет и среднюю, и ширину')
	push()
	push('Ошибки нормированы на свои пороги (средняя 0.2%, s 3%), единица означает ровно порог.')
	push()
	push('| # | тип | разброс | период | средняя fit % | s fit % | средняя test % | s test % | худший fit в порогах | худший test в порогах |')
	push(`| ${Array.from({ length: 10 }, () => '---').join(' | ')} |`)
	joint.slice(0, 20).forEach((j, k) => {
		const c = j.c
		push(
			`| ${k + 1} | ${c.kind} | ${c.res} | ${c.n} | ${f3(c.meanFit)} | ${f3(c.fitMax)} | ${f3(c.meanTest)} | ` +
				`${f3(c.testMax)} | ${f3(j.worstFit)} | ${f3(j.worstTest)} |`,
		)
	})
	push()
	push('## 6. Вердикт')
	push()
	const bm = mcs[0]
	const br = rcs[0]
	const bj = joint[0]
	if (bm)
		push(
			`- средняя лучшая ${bm.src}/${bm.kind}/${bm.n}: fit ${f3(bm.fitMax)}%, test ${f3(bm.testMax)}%, порог 0.2% — ` +
				`${bm.fitMax <= 0.2 && bm.testMax <= 0.2 ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}`,
		)
	if (br)
		push(
			`- s лучшее на остатках ${br.kind}/${br.res}/${br.n}: fit ${f3(br.fitMax)}%, test ${f3(br.testMax)}%, порог 3% — ` +
				`${br.fitMax <= 3 && br.testMax <= 3 ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}`,
		)
	if (bj)
		push(
			`- совместный ${bj.c.kind}/${bj.c.res}/${bj.c.n}: худший fit ${f3(bj.worstFit)} порога, худший test ${f3(bj.worstTest)} порога — ` +
				`${bj.worstFit <= 1 && bj.worstTest <= 1 ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}`,
		)
	push()

	writeFileSync(`${OUT}/apex-anchors3.md`, rep.join('\n'))
	console.log(`готово: ${OUT}/apex-anchors3.md`)
}

await main()
