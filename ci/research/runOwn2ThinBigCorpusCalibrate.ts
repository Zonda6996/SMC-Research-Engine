/**
 * OWN2-thinned big-corpus — CALIBRATION (label-free, до любых исходов).
 *
 * Замораживает единственную глобальную константу стопа руки (preregistration §4 + amendments 1–2):
 *   stopSteps* = 0.019 / median( step_i / entry_i ) по всем допущенным сигналам корпуса,
 *   entry_i = open бара signalIndex+1; step_i = 5.5 × atr200_i / stepDivisor(safe=1).
 * В вычислении участвуют ТОЛЬКО цены (никаких исходов сделок). Результат — калибровочный
 * артефакт с SHA-256, который пинуется в reveal-раннере.
 *
 * Preregistration SHA-256: fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886
 * Amendment №1 SHA-256:    6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40
 * Amendment №2 SHA-256:    1be3164acf82854e61fadc25cb4375d43a02628334d9822abde9e6da894dd17e
 * Запуск: npx tsx ci/research/runOwn2ThinBigCorpusCalibrate.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, ARROW_SIGNAL_SPACING_BARS, detectArrowSignalsFromBands, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/own2-thin-bigcorpus-preregistration.md'
const PREREG_SHA256 = 'fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886'
const AMENDMENT1_PATH = 'ci-results/own2-thin-bigcorpus-amendment-1.md'
const AMENDMENT1_SHA256 = '6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40'
const AMENDMENT2_PATH = 'ci-results/own2-thin-bigcorpus-amendment-2.md'
const AMENDMENT2_SHA256 = '1be3164acf82854e61fadc25cb4375d43a02628334d9822abde9e6da894dd17e'
const MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'
const MANIFEST_SHA256 = '5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50'
const DATA_DIR = 'data/own2-thin-bigcorpus'
const OUT_JSON = 'ci-results/own2-thin-bigcorpus-calibration.json'
const OUT_MD = 'ci-results/own2-thin-bigcorpus-calibration.md'
const TARGET_MEDIAN_STOP_PCT = 0.019
const SAFE_STEP_DIVISOR = 1

/** Канонический OWN2 (prereg §4): дефолты движка + явный relVol=1.4 (урок E1). */
export const OWN2_CONFIG = { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 }

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))

interface ManifestSymbol {
	symbol: string
	candleFile: string
	candleSha256: string
	dropped: boolean
}

interface SymbolCalibration {
	symbol: string
	candidates: number
	admitted: number
	usedForRatios: number
	missingNextBar: number
	invalidGeometry: number
	medianRatio: number | null
	impliedStopStepsForThisSymbol: number | null
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function main(): void {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('Immutable preregistration hash mismatch')
	if (fileHash(AMENDMENT1_PATH) !== AMENDMENT1_SHA256) throw new Error('Immutable amendment 1 hash mismatch')
	if (fileHash(AMENDMENT2_PATH) !== AMENDMENT2_SHA256) throw new Error('Immutable amendment 2 hash mismatch')
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('Immutable acquisition manifest hash mismatch')

	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: ManifestSymbol[] }
	const survivors = manifest.symbols.filter((s) => !s.dropped)

	const ratios: number[] = []
	const perSymbol: SymbolCalibration[] = []
	for (const entry of survivors) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle file hash mismatch`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const bands = computeApexBands(candles)
		const detection = detectArrowSignalsFromBands(candles, bands, OWN2_CONFIG)
		const admitted = admitArrowSignals(detection.candidates as ArrowSignal[], ARROW_SIGNAL_SPACING_BARS)
		const cal: SymbolCalibration = {
			symbol: entry.symbol,
			candidates: detection.candidates.length,
			admitted: admitted.length,
			usedForRatios: 0,
			missingNextBar: 0,
			invalidGeometry: 0,
			medianRatio: null,
			impliedStopStepsForThisSymbol: null,
		}
		const localRatios: number[] = []
		for (const signal of admitted) {
			const next = candles[signal.signalIndex + 1]
			if (next == null) { cal.missingNextBar++; continue }
			if (!(Number.isFinite(signal.atr200) && signal.atr200 > 0 && next.open > 0)) { cal.invalidGeometry++; continue }
			localRatios.push((5.5 * signal.atr200 / SAFE_STEP_DIVISOR) / next.open)
		}
		cal.usedForRatios = localRatios.length
		if (localRatios.length) {
			cal.medianRatio = median(localRatios)
			cal.impliedStopStepsForThisSymbol = TARGET_MEDIAN_STOP_PCT / cal.medianRatio
			ratios.push(...localRatios)
		}
		perSymbol.push(cal)
		console.log(`${entry.symbol}: candidates ${cal.candidates}, admitted ${cal.admitted}, used ${cal.usedForRatios}`)
	}
	if (!ratios.length) throw new Error('Калибровка невозможна: пустой пул отношений')

	const pooledMedianRatio = median(ratios)
	const stopStepsFrozen = TARGET_MEDIAN_STOP_PCT / pooledMedianRatio

	const payload = {
		studyId: 'own2-thin-bigcorpus',
		generatedAt: new Date().toISOString(),
		labelFree: true,
		formula: 'stopSteps* = 0.019 / median(step_i/entry_i); step_i = 5.5*atr200_i/safeStepDivisor; entry_i = open(signalIndex+1)',
		targetMedianStopPctOfPrice: TARGET_MEDIAN_STOP_PCT,
		safeStepDivisor: SAFE_STEP_DIVISOR,
		spacingBars: ARROW_SIGNAL_SPACING_BARS,
		own2Config: OWN2_CONFIG,
		provenance: {
			preregistrationSha256: PREREG_SHA256,
			amendment1Sha256: AMENDMENT1_SHA256,
			amendment2Sha256: AMENDMENT2_SHA256,
			acquisitionManifestSha256: MANIFEST_SHA256,
		},
		pooled: {
			symbols: survivors.length,
			candidatesTotal: perSymbol.reduce((s, x) => s + x.candidates, 0),
			admittedTotal: perSymbol.reduce((s, x) => s + x.admitted, 0),
			ratiosUsed: ratios.length,
			pooledMedianStepOverEntry: pooledMedianRatio,
			stopStepsFrozen,
			expectedMedianStopPctOfPrice: TARGET_MEDIAN_STOP_PCT,
		},
		perSymbol,
	}
	writeFileSync(resolve(OUT_JSON), JSON.stringify(payload, null, 2))

	const md = [
		'# OWN2-thinned big-corpus — calibration freeze (label-free, до исходов)',
		'',
		`- Формула: \`stopSteps* = 0.019 / median(step/entry)\` по всем допущенным (spacing=${ARROW_SIGNAL_SPACING_BARS}) сигналам корпуса.`,
		`- Пул: ${ratios.length} сигналов из ${survivors.length} символов (candidates ${payload.pooled.candidatesTotal} → admitted ${payload.pooled.admittedTotal}).`,
		`- median(step/entry) = ${pooledMedianRatio.toPrecision(10)}.`,
		`- **FROZEN stopSteps* = ${stopStepsFrozen.toPrecision(12)}** (медианная фактическая дистанция стопа ≈ ${(TARGET_MEDIAN_STOP_PCT * 100).toFixed(2)}% цены входа).`,
		'- Участвуют только цены; ни один торговый исход не вычислялся и не просматривался.',
		`- Provenance: prereg ${PREREG_SHA256.slice(0, 8)}…, amendment1 ${AMENDMENT1_SHA256.slice(0, 8)}…, amendment2 ${AMENDMENT2_SHA256.slice(0, 8)}…, manifest ${MANIFEST_SHA256.slice(0, 8)}…`,
		'',
		'| symbol | candidates | admitted | used | median ratio | implied stopSteps (справочно) |',
		'|---|---:|---:|---:|---:|---:|',
		...perSymbol.map((c) => `| ${c.symbol} | ${c.candidates} | ${c.admitted} | ${c.usedForRatios} | ${c.medianRatio?.toPrecision(6) ?? 'n/a'} | ${c.impliedStopStepsForThisSymbol?.toPrecision(5) ?? 'n/a'} |`),
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))

	console.log(`\nSTOP_STEPS FROZEN = ${stopStepsFrozen.toPrecision(12)}`)
	console.log(`calibration JSON SHA-256: ${fileHash(OUT_JSON)}`)
	console.log('Записано: ci-results/own2-thin-bigcorpus-calibration.{json,md}')
}

// Гард: модуль импортируется reveal-раннером ради OWN2_CONFIG — main() должен выполняться только при прямом запуске.
const isDirectRun = process.argv[1] != null && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isDirectRun) main()
