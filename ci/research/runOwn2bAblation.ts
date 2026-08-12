/**
 * OWN2b: ablation of the OWN2 failure + Nikita's BE insight.
 *
 * Nikita's chart read (LINK 2h): after partial fix the vendor moves stop to
 * BREAKEVEN. Price returning to entry exits the trade at ~0 -> state frees ->
 * next signal can fire. That makes a trade-state cooldown viable: trades
 * resolve in hours-days, not weeks. Also matches "safe mode" stats he sent
 * (WR 89.4%, stops 10.6% - our P25/S12+BE replay profile, vs risk mode).
 *
 * Ablation arms (all on FWD1 1h/2h series, recall vs forward arrows):
 *  A. OWN1 baseline (reference: 20.5% recall, ~12 sig/mo)
 *  B. OWN2 raw extension only, NO state (was never measured alone)
 *  C. OWN2 raw + state with BE-after-partial machinery (fast resolution)
 *  D. OWN1 + state with BE machinery (does state help the body trigger?)
 *  E. B relaxed (pen >= -0.6, dist >= 2%, vol >= 1.2) raw-only - sensitivity
 * For each arm: recall, acceptance, signals/month, standalone economics
 * (its own machinery: BE arms use P25/S12/BE, raw arms use P25/S12).
 * EXPLORATORY. Gross R.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma } from './lib/ggiCorrectedReplay.js'
import { replayVar1Trade, type Var1Config } from './runVar1ExitSweep.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import { own2Raw, type Own2Signal } from './runOwn2ExtensionTrigger.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'

const P_NOBE: Var1Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }
const P_BE: Var1Config = { partialFrac: 0.25, breakeven: true, stopMult: 12, addOn: false }
const POST_EXIT_BARS = 3

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
interface FwdTrade { symbol: string; tfMin: number; side: 1 | -1; timeMs: number }

function own2RawRelaxed(rows: readonly ExactIndicatorRow[]): Own2Signal[] {
	const out: Own2Signal[] = []
	for (let i = 21; i < rows.length; i++) {
		const r = rows[i]!
		if (!Number.isFinite(r.mean) || !Number.isFinite(r.upperInner) || !Number.isFinite(r.lowerInner) || r.mean <= 0) continue
		let volSum = 0
		for (let k = i - 20; k < i; k++) volSum += rows[k]!.volume
		const volRatio = volSum > 0 ? r.volume / (volSum / 20) : 0
		if (volRatio < 1.2) continue
		const distMeanPct = (Math.abs(r.close - r.mean) / r.mean) * 100
		if (distMeanPct < 2.0) continue
		for (const side of [1, -1] as const) {
			const half = side === 1 ? r.mean - r.lowerInner : r.upperInner - r.mean
			if (half <= 0) continue
			const band = side === 1 ? r.lowerInner : r.upperInner
			const pen = side === 1 ? (band - r.close) / half : (r.close - band) / half
			const correctSide = side === 1 ? r.close < r.mean : r.close > r.mean
			if (correctSide && pen >= -0.6) out.push({ idx: i, side })
		}
	}
	return out
}

function withState(rows: readonly ExactIndicatorRow[], tr55: readonly number[], raw: readonly Own2Signal[], cfg: Var1Config): Own2Signal[] {
	const out: Own2Signal[] = []
	let blockedUntil = -1
	for (const s of raw) {
		if (s.idx <= blockedUntil) continue
		const t = replayVar1Trade(rows, tr55, s.idx, s.side, cfg)
		out.push(s)
		if (t && t.exitIndex != null) blockedUntil = t.exitIndex + POST_EXIT_BARS
		else blockedUntil = rows.length
	}
	return out
}

interface ArmStat { both: number; ggiOnly: number; ownOnly: number; n: number; sumR: number; p: number; s: number; f: number; sigPerMo: number[] }
const armStat = (): ArmStat => ({ both: 0, ggiOnly: 0, ownOnly: 0, n: 0, sumR: 0, p: 0, s: 0, f: 0, sigPerMo: [] })

async function main() {
	const trades = (JSON.parse(readFileSync(resolve('ci-results/fwd1-telegram-forward-audit.json'), 'utf8')) as { trades: FwdTrade[] }).trades
	const arms: Record<string, ArmStat> = { A_own1: armStat(), B_ext_raw: armStat(), C_ext_state_be: armStat(), D_own1_state_be: armStat(), E_ext_relaxed_raw: armStat() }
	const files = readdirSync(resolve('data/gate-cache')).filter((f) => /^[A-Z0-9]+_(60|120)m\.json$/u.test(f))
	for (const file of files) {
		const m = /^([A-Z0-9]+)_(\d+)m\.json$/u.exec(file)!
		const symbol = m[1]!
		const tfMin = Number(m[2]!)
		const ggi = trades.filter((t) => t.symbol === symbol && t.tfMin === tfMin)
		if (ggi.length === 0) continue
		const klines = (JSON.parse(readFileSync(resolve('data/gate-cache', file), 'utf8')) as { rows: Kline[] }).rows
		if (klines.length < 300) continue
		const rows = buildRows(klines)
		const tr55 = trueRangeSma(rows, 55)
		const bSma = bodySma20(rows)
		const tfMs = tfMin * 60_000
		const idxByOpen = new Map<number, number>()
		for (let i = 0; i < rows.length; i++) idxByOpen.set(rows[i]!.timestamp, i)
		const ggiIdx: Array<{ idx: number; side: 1 | -1 }> = []
		for (const g of ggi) {
			const openT = Math.floor(g.timeMs / tfMs) * tfMs - tfMs
			const idx = idxByOpen.get(openT)
			if (idx != null) ggiIdx.push({ idx, side: g.side })
		}
		const spanMonths = (rows[rows.length - 1]!.timestamp - rows[0]!.timestamp) / (30 * 86_400_000)
		const ext = own2Raw(rows)
		const extRelaxed = own2RawRelaxed(rows)
		const own1 = own1Signals(rows, bSma, 1.5, 10, 0, rows.length).map((s) => ({ idx: s.idx, side: s.side }))
		const armSignals: Record<string, { sigs: Own2Signal[]; cfg: Var1Config }> = {
			A_own1: { sigs: own1, cfg: P_NOBE },
			B_ext_raw: { sigs: ext, cfg: P_NOBE },
			C_ext_state_be: { sigs: withState(rows, tr55, ext, P_BE), cfg: P_BE },
			D_own1_state_be: { sigs: withState(rows, tr55, own1, P_BE), cfg: P_BE },
			E_ext_relaxed_raw: { sigs: extRelaxed, cfg: P_NOBE },
		}
		for (const [arm, { sigs, cfg }] of Object.entries(armSignals)) {
			const st = arms[arm]!
			const matched = new Set<number>()
			for (const s of sigs) {
				const g = ggiIdx.find((x) => Math.abs(x.idx - s.idx) <= 2 && x.side === s.side)
				if (g) { st.both++; matched.add(g.idx) } else st.ownOnly++
				const t = replayVar1Trade(rows, tr55, s.idx, s.side, cfg)
				if (t && t.outcome !== 'End mark') {
					st.n++; st.sumR += t.grossR
					if (t.outcome === 'Partial') st.p++
					else if (t.outcome === 'Stop') st.s++
					else st.f++
				}
			}
			st.ggiOnly += ggiIdx.filter((g) => !matched.has(g.idx)).length
			if (spanMonths > 1) st.sigPerMo.push(sigs.length / spanMonths)
		}
	}
	const md: string[] = []
	md.push('# OWN2b - ablation: extension trigger, trade-state, BE machinery (Nikita LINK-2h insight)')
	md.push('')
	md.push(`State cooldown: trade open -> blocked, + ${POST_EXIT_BARS} bars after exit. BE arms use P25/S12/breakeven=true (vendor "safe mode" hypothesis).`)
	md.push('')
	md.push('| arm | recall | acceptance | sig/mo (med) | n trades | mean R | WR | P/S/F |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const [arm, st] of Object.entries(arms)) {
		const rec = st.both + st.ggiOnly > 0 ? ((st.both / (st.both + st.ggiOnly)) * 100).toFixed(1) : '-'
		const acc = st.both + st.ownOnly > 0 ? ((st.both / (st.both + st.ownOnly)) * 100).toFixed(1) : '-'
		const spm = st.sigPerMo.sort((a, b) => a - b)[Math.floor(st.sigPerMo.length / 2)]?.toFixed(1) ?? '-'
		const wr = st.n > 0 ? (((st.p + st.f) / st.n) * 100).toFixed(1) : '-'
		md.push(`| ${arm} | ${rec}% | ${acc}% | ${spm} | ${st.n} | ${st.n ? (st.sumR / st.n).toFixed(4) : '-'} | ${wr}% | ${st.p}/${st.s}/${st.f} |`)
	}
	md.push('')
	md.push('Vendor reference: ~2-3 arrows/month/series; safe-mode stats WR 89.4%, stops 10.6%, partial 42%, full fix 47%.')
	writeFileSync(resolve('ci-results/own2b-ablation.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/own2b-ablation.json'), JSON.stringify(arms, null, 1))
	console.log(md.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
