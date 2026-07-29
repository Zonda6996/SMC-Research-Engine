// apexAnchors6.ts — Zonda Apex, шестой заход: форма весов и база нормировки.
//
// Закрыто: линия = mean*exp(+-k*s), k = 5.6 и 9.6; средняя = alma(hlc3, 200)
// (ошибка 0.02-0.05% на шести свежих барах 29.07).
//
// Не закрыто: s. В v5 выяснилось, что уровень требует окна ~233, а скорость
// изменения — окна ~293 при фиксированной форме весов alma. Противоречие
// снимается, если распустить саму форму весов: смещение колокола и его ширину.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const K_IN = 5.6
const K_OUT = 9.6

const RULE: string[] = [
	'1. Отбор — по максимуму абсолютной ошибки сразу по всем 12 замерам s (три даты, два ТФ).',
	'2. Порог уровня: максимум <= 3%.',
	'3. Порог траектории: наклон серии 29.07 в пределах 1 п.п. от целевого.',
	'4. Принятым считается только кандидат, выполнивший оба порога одновременно.',
	'5. При разнице в пределах 0.5% предпочитаются период 200, смещение 0.85 и ширина 6',
	'   — то есть стандартная alma с периодом из настроек вендора.',
	'6. Средняя не подбирается: alma(hlc3, 200), смещение 0.85, ширина 6.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number }
type Tf = '5m' | '4h'
type Norm = 'close' | 'mean' | 'ownBar'

type Lines = { mean: number; inUp?: number; inDn?: number; outUp?: number; outDn?: number }
type Anchor = { id: string; tf: Tf; tMs: number; day: '20.07' | '28.07' | '29.07'; lines: Lines }

const ANCHORS: Anchor[] = [
	{ id: '5m@20.07-12', tf: '5m', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 64250.82, inUp: 64835.88, inDn: 63671.03 } },
	{ id: '4h@20.07-12', tf: '4h', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 63533.87, inUp: 67351.71, inDn: 59932.45 } },
	{ id: '5m@28.07-08', tf: '5m', tMs: Date.UTC(2026, 6, 28, 8), day: '28.07', lines: { mean: 63385.64, inUp: 63764.37, inDn: 63009.16, outUp: 64036.28, outDn: 62741.61 } },
	{ id: '4h@28.07-08', tf: '4h', tMs: Date.UTC(2026, 6, 28, 8), day: '28.07', lines: { mean: 64805.28, inUp: 68107.36, inDn: 61663.29, outUp: 70568.52, outDn: 59512.72 } },
	{ id: '5m@28.07-16', tf: '5m', tMs: Date.UTC(2026, 6, 28, 16), day: '28.07', lines: { mean: 63400.23, inUp: 63959.28, inDn: 62846.06, outUp: 64361.62, outDn: 62453.19 } },
	{ id: '4h@28.07-16', tf: '4h', tMs: Date.UTC(2026, 6, 28, 16), day: '28.07', lines: { mean: 64818.43, inUp: 68110.28, inDn: 61685.69, outUp: 70563.46, outDn: 59541.15 } },
	{ id: '5m@29.07-06:40', tf: '5m', tMs: Date.UTC(2026, 6, 29, 6, 40), day: '29.07', lines: { mean: 63906.09, inUp: 64394.55, inDn: 63421.32 } },
	{ id: '5m@29.07-06:50', tf: '5m', tMs: Date.UTC(2026, 6, 29, 6, 50), day: '29.07', lines: { mean: 63912.68, inUp: 64398.78, inDn: 63430.26 } },
	{ id: '5m@29.07-06:55', tf: '5m', tMs: Date.UTC(2026, 6, 29, 6, 55), day: '29.07', lines: { mean: 63916.51, inUp: 64401.12, inDn: 63435.55 } },
	{ id: '5m@29.07-07:00', tf: '5m', tMs: Date.UTC(2026, 6, 29, 7, 0), day: '29.07', lines: { mean: 63920.66, inUp: 64403.55, inDn: 63441.39 } },
	{ id: '5m@29.07-07:05', tf: '5m', tMs: Date.UTC(2026, 6, 29, 7, 5), day: '29.07', lines: { mean: 63925.13, inUp: 64406.18, inDn: 63447.67 } },
	{ id: '5m@29.07-07:10', tf: '5m', tMs: Date.UTC(2026, 6, 29, 7, 10), day: '29.07', lines: { mean: 63929.92, inUp: 64409.01, inDn: 63454.39 } },
]

const BASE = 'https://data.binance.vision/data/spot'
const MONTHS: string[] = []
for (const m of [9, 10, 11, 12]) MONTHS.push(`2025-${String(m).padStart(2, '0')}`)
for (const m of [1, 2, 3, 4, 5, 6]) MONTHS.push(`2026-${String(m).padStart(2, '0')}`)
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)
const REST = 'https://data-api.binance.vision'

async function cached(url: string): Promise<string | null> {
	const file = `${CACHE}/${url.split('/').pop()!}`
	if (existsSync(file)) return file
	const r = await fetch(url)
	if (!r.ok) return null
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
		if (Number.isFinite(c.o) && Number.isFinite(c.c)) out.push(c)
	}
	return out
}

async function load(tf: Tf): Promise<Cndl[]> {
	const all: Cndl[] = []
	for (const m of MONTHS) {
		const f = await cached(`${BASE}/monthly/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${m}.zip`)
		if (f) all.push(...parseZip(f))
	}
	for (const d of DAYS) {
		const f = await cached(`${BASE}/daily/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${d}.zip`)
		if (f) all.push(...parseZip(f))
	}
	try {
		const r = await fetch(`${REST}/api/v3/klines?symbol=BTCUSDT&interval=${tf}&startTime=${Date.UTC(2026, 6, 26)}&limit=1000`)
		if (r.ok) {
			for (const row of (await r.json()) as unknown[]) {
				const a = row as unknown[]
				all.push({ t: Number(a[0]), o: Number(a[1]), h: Number(a[2]), l: Number(a[3]), c: Number(a[4]) })
			}
		}
	} catch {
		console.log('REST недоступен')
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

/** Веса колокола: длина n, смещение off (0 = далёко, 1 = самый свежий бар), ширина sig. */
function weights(n: number, off: number, sig: number): Float64Array {
	const m = off * (n - 1)
	const s = n / sig
	const w = new Float64Array(n)
	let sum = 0
	for (let j = 0; j < n; j++) {
		const v = Math.exp(-((j - m) * (j - m)) / (2 * s * s))
		w[j] = v
		sum += v
	}
	for (let j = 0; j < n; j++) w[j]! / sum
	for (let j = 0; j < n; j++) w[j] = w[j]! / sum
	return w
}

function dot(x: number[], i: number, w: Float64Array): number {
	const n = w.length
	if (i + 1 < n) return NaN
	let s = 0
	for (let j = 0; j < n; j++) s += w[j]! * x[i - (n - 1) + j]!
	return s
}

const pct = (got: number, want: number): number => ((got - want) / want) * 100
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

type Ser = {
	candles: Cndl[]
	hlc3: number[]
	/** абсолютный истинный диапазон и его варианты, нормированные по-барно */
	trAbs: number[]
	trOwn: number[]
	hlAbs: number[]
	hlOwn: number[]
}

async function main(): Promise<void> {
	mkdirSync(CACHE, { recursive: true })
	mkdirSync(OUT, { recursive: true })
	const rep: string[] = []
	const push = (s = ''): void => {
		rep.push(s)
	}

	push('# Zonda Apex — калибровка v6: форма весов и база нормировки')
	push()
	push(`- прогон ${process.env.GITHUB_RUN_ID ?? 'local'}, ${new Date().toISOString()}`)
	push('- модель: линия = mean*exp(+-k*s), k = 5.6 и 9.6; средняя = alma(hlc3, 200)')
	push()
	push('## Правило отбора (зафиксировано в коде до прогона)')
	push()
	for (const r of RULE) push(r)
	push()

	const ser = new Map<Tf, Ser>()
	for (const tf of ['5m', '4h'] as Tf[]) {
		const c = await load(tf)
		const trAbs: number[] = []
		const hlAbs: number[] = []
		for (let i = 0; i < c.length; i++) {
			const x = c[i]!
			hlAbs.push(x.h - x.l)
			trAbs.push(
				i === 0
					? x.h - x.l
					: Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c)),
			)
		}
		ser.set(tf, {
			candles: c,
			hlc3: c.map((x) => (x.h + x.l + x.c) / 3),
			trAbs,
			hlAbs,
			trOwn: trAbs.map((v, i) => v / c[i]!.c),
			hlOwn: hlAbs.map((v, i) => v / c[i]!.c),
		})
		console.log(`${tf}: ${c.length} баров`)
	}

	const meanW = weights(200, 0.85, 6)
	const idx = new Map<string, number>()
	const sigma = new Map<string, number>()
	const meanCalc = new Map<string, number>()
	for (const a of ANCHORS) {
		const s = ser.get(a.tf)!
		const i = s.candles.findIndex((c) => c.t === a.tMs)
		if (i < 0) continue
		idx.set(a.id, i)
		meanCalc.set(a.id, dot(s.hlc3, i, meanW))
		const sg = sigmaFromLines(a.lines)
		if (Number.isFinite(sg)) sigma.set(a.id, sg)
	}
	const live = ANCHORS.filter((a) => idx.has(a.id) && sigma.has(a.id))
	const ids = live.map((a) => a.id)
	const seq = live.filter((a) => a.day === '29.07')
	const tTrend = pct(sigma.get(seq[seq.length - 1]!.id)!, sigma.get(seq[0]!.id)!)

	push('## 1. Целевые s и контроль средней')
	push()
	push('| замер | s | s в % | ошибка средней % | цена/средняя % |')
	push('| --- | --- | --- | --- | --- |')
	for (const a of live) {
		const i = idx.get(a.id)!
		const c = ser.get(a.tf)!.candles[i]!.c
		push(
			`| ${a.id} | ${f6(sigma.get(a.id)!)} | ${f3(sigma.get(a.id)! * 100)} | ` +
				`${f3(pct(meanCalc.get(a.id)!, a.lines.mean))} | ${f3(pct(c, a.lines.mean))} |`,
		)
	}
	push()
	push(`Целевой наклон серии 29.07: ${f3(tTrend)}%`)
	push()

	const PERIODS: number[] = []
	for (let n = 120; n <= 400; n += 2) PERIODS.push(n)
	if (!PERIODS.includes(200)) PERIODS.push(200)
	const OFFS: number[] = []
	for (let o = 0.5; o <= 1.0001; o += 0.025) OFFS.push(Math.round(o * 1000) / 1000)
	const SIGS: number[] = []
	for (let g = 2; g <= 12.001; g += 0.5) SIGS.push(g)
	const MEAS: Array<'tr' | 'hl'> = ['tr', 'hl']
	const NORMS: Norm[] = ['close', 'mean', 'ownBar']

	type C = {
		meas: string
		norm: Norm
		n: number
		off: number
		sig: number
		lvl: number
		lvlByDay: Map<string, number>
		trend: number
		errs: Map<string, number>
	}
	const cands: C[] = []

	for (const n of PERIODS)
		for (const off of OFFS)
			for (const sg of SIGS) {
				const w = weights(n, off, sg)
				for (const meas of MEAS)
					for (const norm of NORMS) {
						const errs = new Map<string, number>()
						const vals = new Map<string, number>()
						const lvlByDay = new Map<string, number>()
						let lvl = 0
						let ok = true
						for (const a of live) {
							const s = ser.get(a.tf)!
							const i = idx.get(a.id)!
							let v: number
							if (norm === 'ownBar') {
								v = dot(meas === 'tr' ? s.trOwn : s.hlOwn, i, w)
							} else {
								const abs = dot(meas === 'tr' ? s.trAbs : s.hlAbs, i, w)
								v = abs / (norm === 'close' ? s.candles[i]!.c : meanCalc.get(a.id)!)
							}
							if (!Number.isFinite(v) || v <= 0) {
								ok = false
								break
							}
							vals.set(a.id, v)
							const e = pct(v, sigma.get(a.id)!)
							errs.set(a.id, e)
							lvl = Math.max(lvl, Math.abs(e))
							lvlByDay.set(a.day, Math.max(lvlByDay.get(a.day) ?? 0, Math.abs(e)))
						}
						if (!ok) continue
						const trend = pct(vals.get(seq[seq.length - 1]!.id)!, vals.get(seq[0]!.id)!)
						if (lvl > 25) continue
						cands.push({ meas, norm, n, off, sig: sg, lvl, lvlByDay, trend, errs })
					}
			}
	console.log(`кандидатов: ${cands.length}`)

	const days = ['20.07', '28.07', '29.07']
	const head =
		`| # | мера | нормировка | период | смещение | ширина | уровень % | ` +
		`${days.map((d) => `${d} %`).join(' | ')} | наклон % | ошибка наклона п.п. |`
	const sep = `| ${Array.from({ length: 9 + days.length }, () => '---').join(' | ')} |`
	const row = (c: C, k: number): string =>
		`| ${k + 1} | ${c.meas} | ${c.norm} | ${c.n} | ${c.off} | ${c.sig} | ${f3(c.lvl)} | ` +
		`${days.map((d) => f3(c.lvlByDay.get(d) ?? NaN)).join(' | ')} | ${f3(c.trend)} | ${f3(c.trend - tTrend)} |`

	const both = [...cands]
		.filter((c) => c.lvl <= 3 && Math.abs(c.trend - tTrend) <= 1)
		.sort((x, y) => x.lvl - y.lvl)
	push('## 2. Кандидаты, выполнившие ОБА порога')
	push()
	if (both.length === 0) push('Нет ни одного.')
	else {
		push(head)
		push(sep)
		both.slice(0, 30).forEach((c, k) => push(row(c, k)))
	}
	push()

	const byLvl = [...cands].sort((x, y) => x.lvl - y.lvl)
	push('## 3. Лучшие по уровню')
	push()
	push(head)
	push(sep)
	byLvl.slice(0, 25).forEach((c, k) => push(row(c, k)))
	push()

	const byBoth = [...cands].sort(
		(x, y) => x.lvl / 3 + Math.abs(x.trend - tTrend) - (y.lvl / 3 + Math.abs(y.trend - tTrend)),
	)
	push('## 4. Лучшие по сумме двух критериев (нормированные на свои пороги)')
	push()
	push(head)
	push(sep)
	byBoth.slice(0, 25).forEach((c, k) => push(row(c, k)))
	push()

	push('## 5. Стандартная форма (смещение 0.85, ширина 6) при периоде 200 — все базы')
	push()
	push(head)
	push(sep)
	cands
		.filter((c) => c.n === 200 && c.off === 0.85 && c.sig === 6)
		.forEach((c, k) => push(row(c, k)))
	push()

	push('## 6. Лучшее для каждой базы нормировки')
	push()
	push(head)
	push(sep)
	NORMS.forEach((nm, k) => {
		const b = byBoth.find((c) => c.norm === nm)
		if (b) push(row(b, k))
	})
	push()

	push('## 7. Вердикт')
	push()
	const best = byBoth[0]
	if (best) {
		push(
			`- лучший компромисс: ${best.meas} / ${best.norm} / период ${best.n} / смещение ${best.off} / ширина ${best.sig}` +
				` — уровень ${f3(best.lvl)}%, ошибка наклона ${f3(best.trend - tTrend)} п.п.`,
		)
		push(
			both.length > 0
				? `- ОБА ПОРОГА ВЫПОЛНЕНЫ, кандидатов: ${both.length}`
				: '- ни один кандидат не выполнил оба порога одновременно',
		)
	}
	push()

	writeFileSync(`${OUT}/apex-anchors6.md`, rep.join('\n'))
	console.log(`готово: ${OUT}/apex-anchors6.md`)
}

await main()
