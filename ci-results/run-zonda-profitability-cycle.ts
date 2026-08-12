import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../src/models/price/Candle.js'
import { APEX_PARAMS, APEX_VERSION } from '../src/core/signals/ApexEngine.js'
import { ARROW_SIGNAL_VERSION, detectArrowSignalCandidates, type ArrowMode, type ArrowSignal } from '../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS, ARROW_TRADE_REPLAY_VERSION, replayArrowSignals, type ArrowTrade } from '../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const MODES: ArrowMode[] = ['safe', 'risk', 'standard']
const TRAIN_FRACTION = 0.65
const ONE_WAY_COST_BPS = 7
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

// PREREGISTRATION — fixed before any result is computed.
const PREREGISTRATION = {
  protocol: 'zonda-runtime-profitability-cycle-1.0',
  trainFraction: TRAIN_FRACTION,
  splitRule: 'per asset/timeframe: first 65% of timestamp span is train; final 35% is OOS',
  universe: ASSETS,
  timeframes: TIMEFRAMES,
  modes: MODES,
  costs: 'BingX VIP0 taker 5 bps + slippage 2 bps = 7 bps per executed side; costR = turnoverNotional * 0.0007 / oneR; funding omitted (not present in local OHLCV caches)',
  execution: 'next-bar open; add then stop then target on ambiguous OHLC bar; runtime mode geometry/management; maxHoldingBars=2000; postExitBars=3',
  hypotheses: [{
    id: 'H1_APEX_CONTRACTION_REGIME',
    definition: 'Keep an OWN2 candidate iff fixed G2 sequenceScore >= 3/4: failed continuation over 8 bars; direction-adjusted Apex mean slope over 8 bars > -0.25 recent-TR; recent 8-bar average range < prior 8-bar average range; directional signal candle. No fitted parameters.',
    source: 'existing preregistered IndependentReversalG2Protocol sequence definition',
  }],
  blockedHypotheses: [
    'Fresh non-top 4h liquidity sweep: existing implementation is STATIC2/FROZEN and is not execution-comparable to current Safe/Risk/Standard runtime; do not splice.',
    'HTF/Fibonacci/POI: no already-validated causal adapter from current OWN2 runtime candidates to these contexts; do not splice.',
  ],
  promotionGate: 'aggregate OOS net mean >= +0.05R, CI shown, acceptable frequency, and positive result not dependent on one asset',
} as const

type Variant = 'baseline' | 'H1_APEX_CONTRACTION_REGIME'
type Split = 'train' | 'oos'
type TradeRow = ArrowTrade & { asset: string; timeframe: string; variant: Variant; split: Split; cluster: string }

function averageRange(candles: readonly Candle[], from: number, until: number): number {
  let sum = 0
  for (let i = from; i < until; i++) sum += candles[i]!.high - candles[i]!.low
  return until > from ? sum / (until - from) : 0
}

function sequenceScore(candles: readonly Candle[], bands: ReturnType<typeof detectArrowSignalCandidates>['bands'], signal: ArrowSignal): number {
  const i = signal.signalIndex, side = signal.side === 'long' ? 1 : -1
  if (i < 16) return 0
  let adverse = side === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  for (let j = i - 8; j < i; j++) adverse = side === 1 ? Math.min(adverse, candles[j]!.low) : Math.max(adverse, candles[j]!.high)
  const c = candles[i]!
  const failedContinuation = side === 1 ? c.low >= adverse && c.close > c.open : c.high <= adverse && c.close < c.open
  let trSum = 0
  for (let j = i - 7; j <= i; j++) {
    const x = candles[j]!, p = candles[j - 1]!
    trSum += Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close))
  }
  const meanSlopeAtr = side * (bands[i]!.mean - bands[i - 8]!.mean) / Math.max(trSum / 8, Number.EPSILON)
  const contraction = averageRange(candles, i - 8, i) < averageRange(candles, i - 16, i - 8)
  const directional = side === 1 ? c.close > c.open : c.close < c.open
  return Number(failedContinuation) + Number(meanSlopeAtr > -0.25) + Number(contraction) + Number(directional)
}

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}
function quantile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null
  const a = [...xs].sort((x, y) => x - y), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p)
  return a[lo]! + (a[hi]! - a[lo]!) * (p - lo)
}
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296) }
function bootstrapCI(values: readonly number[], seedSalt: string): [number | null, number | null] {
  if (values.length < 2) return [null, null]
  const hash = createHash('sha256').update(seedSalt).digest().readUInt32LE(0)
  const random = rng(BOOTSTRAP_SEED ^ hash), means: number[] = []
  for (let b = 0; b < BOOTSTRAP_SAMPLES; b++) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!; means.push(sum / values.length) }
  return [quantile(means, 0.025), quantile(means, 0.975)]
}
function maxDrawdown(values: readonly number[]): number { let equity = 0, peak = 0, dd = 0; for (const v of values) { equity += v; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity) } return dd }
function summarize(rows: readonly TradeRow[], includeCosts: boolean, seedSalt: string) {
  const ordered = [...rows].sort((a, b) => a.entryAt - b.entryAt || a.asset.localeCompare(b.asset))
  const values = ordered.map(t => includeCosts ? t.netR : t.grossR)
  const gains = values.filter(x => x > 0).reduce((a, b) => a + b, 0), losses = -values.filter(x => x < 0).reduce((a, b) => a + b, 0)
  const full = rows.filter(t => t.outcome === 'full-tp').length, partial = rows.filter(t => t.outcome === 'partial-be' || t.outcome === 'partial-stop').length, stop = rows.filter(t => t.outcome === 'stop').length
  const finalized = full + partial + stop
  const from = ordered[0]?.entryAt ?? null, to = ordered.at(-1)?.entryAt ?? null
  const months = from != null && to != null ? Math.max(1 / 30.4375, (to - from) / (30.4375 * 86400000)) : null
  const ci = bootstrapCI(values, seedSalt)
  return {
    signals: rows.length, finalized, open: rows.filter(t => t.outcome === 'open').length, timeout: rows.filter(t => t.outcome === 'timeout').length,
    outcomes: { full, terminalPartial: partial, partialBe: rows.filter(t => t.outcome === 'partial-be').length, partialStop: rows.filter(t => t.outcome === 'partial-stop').length, stop },
    totalR: values.reduce((a, b) => a + b, 0), meanR: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, medianR: median(values),
    ci95MeanR: ci, profitFactor: losses > 0 ? gains / losses : gains > 0 ? 'Infinity' : null,
    positiveRate: values.length ? values.filter(x => x > 0).length / values.length : null,
    vendorStyleWR: finalized ? (full + partial) / finalized : 0, maxDrawdownR: maxDrawdown(values),
    holdingBars: { mean: rows.length ? rows.reduce((s, t) => s + t.holdingBars, 0) / rows.length : null, median: median(rows.map(t => t.holdingBars)) },
    tradesPerMonth: months ? rows.length / months : null,
    clusters: new Set(rows.map(t => t.cluster)).size,
  }
}

const all: TradeRow[] = [], cells: any[] = [], sources: any[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
  const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
  const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
  const detection = detectArrowSignalCandidates(candles)
  const start = candles[0]!.timestamp, end = candles.at(-1)!.timestamp, boundary = start + (end - start) * TRAIN_FRACTION
  sources.push({ asset, timeframe, path: path.replace(resolve('.'), '.').replaceAll('\\', '/'), bars: candles.length, from: new Date(start).toISOString(), to: new Date(end).toISOString(), splitAt: new Date(boundary).toISOString() })
  const variants: Array<[Variant, ArrowSignal[]]> = [
    ['baseline', detection.candidates],
    ['H1_APEX_CONTRACTION_REGIME', detection.candidates.filter(s => sequenceScore(candles, detection.bands, s) >= 3)],
  ]
  for (const [variant, candidates] of variants) for (const mode of MODES) {
    const replay = replayArrowSignals(candles, detection.bands, candidates, mode, { oneWayCostBps: ONE_WAY_COST_BPS })
    const rows = replay.trades.map(t => ({ ...t, asset, timeframe, variant, split: (t.signalAt < boundary ? 'train' : 'oos') as Split, cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}` }))
    all.push(...rows)
    for (const split of ['train', 'oos'] as const) {
      const selected = rows.filter(t => t.split === split)
      cells.push({ asset, timeframe, mode, variant, split, gross: summarize(selected, false, `${asset}-${timeframe}-${mode}-${variant}-${split}-gross`), net: summarize(selected, true, `${asset}-${timeframe}-${mode}-${variant}-${split}-net`) })
    }
  }
}

const aggregate: any[] = []
for (const variant of ['baseline', 'H1_APEX_CONTRACTION_REGIME'] as Variant[]) for (const mode of MODES) for (const split of ['train', 'oos'] as Split[]) {
  const rows = all.filter(t => t.variant === variant && t.mode === mode && t.split === split)
  aggregate.push({ variant, mode, split, gross: summarize(rows, false, `${variant}-${mode}-${split}-gross`), net: summarize(rows, true, `${variant}-${mode}-${split}-net`) })
}
const slices: any[] = []
for (const variant of ['baseline', 'H1_APEX_CONTRACTION_REGIME'] as Variant[]) for (const mode of MODES) for (const split of ['train', 'oos'] as Split[]) for (const dimension of ['asset', 'timeframe', 'side'] as const) {
  const keys = dimension === 'asset' ? ASSETS : dimension === 'timeframe' ? TIMEFRAMES : ['long', 'short']
  for (const key of keys) {
    const rows = all.filter(t => t.variant === variant && t.mode === mode && t.split === split && t[dimension] === key)
    slices.push({ variant, mode, split, dimension, key, net: summarize(rows, true, `${variant}-${mode}-${split}-${dimension}-${key}`) })
  }
}

const result = {
  generatedAt: new Date().toISOString(), gitHead: '609ecfee2496f7b5083be7578857ac959943d63d',
  versions: { apex: APEX_VERSION, apexParams: APEX_PARAMS, signal: ARROW_SIGNAL_VERSION, replay: ARROW_TRADE_REPLAY_VERSION, modeConfigs: ARROW_MODE_CONFIGS },
  preregistration: PREREGISTRATION, sources, aggregate, cells, slices,
  notes: ['Funding omitted: local OHLCV cache has no funding series; fee+slippage sensitivity is reported gross vs 7 bps/side.', 'Bootstrap is trade-level deterministic and does not remove correlation; cluster counts are therefore also reported.'],
}
writeFileSync(resolve('temp/zonda-profitability-cycle.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ aggregate, sourceCount: sources.length, tradeRows: all.length }, null, 2))
