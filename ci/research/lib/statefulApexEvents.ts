import { createHash } from 'node:crypto'

export type ApexEventSide = 'long' | 'short'
export type ApexEventState = 'NEUTRAL' | 'ARMED' | 'EXTENDED' | 'TRACKING' | 'REVERSAL_CONFIRMED' | 'COOLDOWN'
export type ApexSplit = 'train' | 'validation' | 'untouched-oos'

export interface StatefulApexRow {
	timestamp: number
	open: number
	high: number
	low: number
	close: number
	volume: number
	mean: number
	upperOuter: number
	upperInner: number
	lowerInner: number
	lowerOuter: number
}

export interface ApexTransition {
	index: number
	timestamp: number
	from: ApexEventState
	to: ApexEventState
	side: ApexEventSide | null
	reason: 'mean-close-arm' | 'inner-touch' | 'next-bar-below-mean' | 'next-bar-above-mean' | 'reversal-confirmed' | 'emitted' | 'mean-reset' | 'invalid-data-reset' | 'series-end'
}

export interface ApexTrajectoryFeatures {
	side: ApexEventSide
	barsSinceMean: number
	barsSinceInner: number
	currentDepth: number
	maxDepth: number
	newAdverseExtremes: number
	lastExtensionIncrement: number | null
	previousExtensionIncrement: number | null
	recoveryFromExtreme: number
	closeToMeanProgress: number | null
	body: number
	range: number
	upperWick: number
	lowerWick: number
	trueRange: number
	causalRelativeVolume: null
	meanSlope: number | null
	innerWidth: number
	outerWidth: number
	innerWidthChange: number | null
	outerWidthChange: number | null
}

export interface StatefulApexEvent {
	id: string
	side: ApexEventSide
	episodeStartIndex: number
	innerTouchIndex: number
	confirmationIndex: number
	confirmationTimestamp: number
	entryIndex: number | null
	entryTimestamp: number | null
	features: ApexTrajectoryFeatures
}

export interface StatefulApexDetection {
	events: StatefulApexEvent[]
	transitions: ApexTransition[]
}

export interface ApexOutcomeLabel {
	entry: number
	target: number
	stop: number
	oneR: number
	mfeR: number
	maeR: number
	timeToMfeBars: number
	timeToMaeBars: number
	targetBeforeStop: true | false | 'censored'
	exitIndex: number | null
	grossR: number | null
	netR5bps: number | null
	censored: boolean
}

interface Episode {
	side: ApexEventSide
	start: number
	lastMean: number
	innerTouch: number | null
	extreme: number
	newExtremes: number
	lastIncrement: number | null
	previousIncrement: number | null
	previousClose: number
}

const finite = (x: number): boolean => Number.isFinite(x)

export function isValidStatefulApexRow(row: StatefulApexRow): boolean {
	return [row.timestamp, row.open, row.high, row.low, row.close, row.volume, row.mean, row.upperOuter, row.upperInner, row.lowerInner, row.lowerOuter].every(finite)
		&& row.low <= row.high
		&& row.lowerOuter < row.lowerInner
		&& row.lowerInner < row.mean
		&& row.mean < row.upperInner
		&& row.upperInner < row.upperOuter
}

export function statefulApexSplit(symbol: string): ApexSplit {
	const digest = createHash('sha256').update(`apex-state-v1:${symbol}`).digest()
	let remainder = 0
	for (const byte of digest) remainder = (remainder * 256 + byte) % 10
	return remainder <= 5 ? 'train' : remainder <= 7 ? 'validation' : 'untouched-oos'
}

function touchesMean(row: StatefulApexRow): boolean {
	return row.low <= row.mean && row.high >= row.mean
}

function innerTouched(row: StatefulApexRow, side: ApexEventSide): boolean {
	return side === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
}

function adverse(row: StatefulApexRow, side: ApexEventSide): number {
	return side === 'long' ? row.low : row.high
}

function depth(row: StatefulApexRow, side: ApexEventSide, price: number): number {
	const innerDistance = side === 'long' ? row.mean - row.lowerInner : row.upperInner - row.mean
	if (!(innerDistance > 0)) return NaN
	return side === 'long' ? (row.mean - price) / innerDistance : (price - row.mean) / innerDistance
}

function closerToMean(row: StatefulApexRow, previousClose: number): boolean {
	return Math.abs(row.close - row.mean) < Math.abs(previousClose - row.mean)
}

function featurePayload(rows: readonly StatefulApexRow[], i: number, episode: Episode): ApexTrajectoryFeatures {
	const row = rows[i]!
	const previous = rows[i - 1]
	const side = episode.side
	const inner = side === 'long' ? row.lowerInner : row.upperInner
	const outer = side === 'long' ? row.lowerOuter : row.upperOuter
	const prevInner = previous == null ? null : side === 'long' ? previous.lowerInner : previous.upperInner
	const prevOuter = previous == null ? null : side === 'long' ? previous.lowerOuter : previous.upperOuter
	const currentDepth = depth(row, side, row.close)
	const maxDepth = depth(row, side, episode.extreme)
	const priorDistance = Math.abs(episode.previousClose - row.mean)
	const currentDistance = Math.abs(row.close - row.mean)
	return {
		side,
		barsSinceMean: i - episode.lastMean,
		barsSinceInner: i - episode.innerTouch!,
		currentDepth,
		maxDepth,
		newAdverseExtremes: episode.newExtremes,
		lastExtensionIncrement: episode.lastIncrement,
		previousExtensionIncrement: episode.previousIncrement,
		recoveryFromExtreme: side === 'long' ? row.close - episode.extreme : episode.extreme - row.close,
		closeToMeanProgress: priorDistance > 0 ? (priorDistance - currentDistance) / priorDistance : null,
		body: row.close - row.open,
		range: row.high - row.low,
		upperWick: row.high - Math.max(row.open, row.close),
		lowerWick: Math.min(row.open, row.close) - row.low,
		trueRange: previous == null ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close)),
		// TODO(preregistration): relative-volume lookback/denominator is not frozen in Track S.
		causalRelativeVolume: null,
		meanSlope: previous == null ? null : row.mean - previous.mean,
		innerWidth: Math.abs(row.mean - inner),
		outerWidth: Math.abs(row.mean - outer),
		innerWidthChange: previous == null || prevInner == null ? null : Math.abs(row.mean - inner) - Math.abs(previous.mean - prevInner),
		outerWidthChange: previous == null || prevOuter == null ? null : Math.abs(row.mean - outer) - Math.abs(previous.mean - prevOuter),
	}
}

export function detectStatefulApexEvents(rows: readonly StatefulApexRow[]): StatefulApexDetection {
	const events: StatefulApexEvent[] = []
	const transitions: ApexTransition[] = []
	const runtime: { state: ApexEventState; episode: Episode | null } = { state: 'NEUTRAL', episode: null }
	let lastMeanTouch = -1

	const move = (i: number, to: ApexEventState, reason: ApexTransition['reason'], side = runtime.episode?.side ?? null): void => {
		transitions.push({ index: i, timestamp: rows[i]?.timestamp ?? rows.at(-1)?.timestamp ?? 0, from: runtime.state, to, side, reason })
		runtime.state = to
	}
	const reset = (i: number, reason: 'mean-reset' | 'invalid-data-reset'): void => {
		if (runtime.state !== 'NEUTRAL') move(i, 'NEUTRAL', reason)
		runtime.episode = null
	}

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		if (!isValidStatefulApexRow(row)) {
			reset(i, 'invalid-data-reset')
			lastMeanTouch = i
			continue
		}
		const meanTouch = touchesMean(row)

		if (runtime.state === 'COOLDOWN') {
			if (meanTouch) { reset(i, 'mean-reset'); lastMeanTouch = i }
			continue
		}

		if ((runtime.state === 'EXTENDED' || runtime.state === 'TRACKING' || runtime.state === 'REVERSAL_CONFIRMED') && meanTouch) {
			reset(i, 'mean-reset')
			lastMeanTouch = i
			continue
		}

		if (runtime.state === 'NEUTRAL' || runtime.state === 'ARMED') {
			if (meanTouch) lastMeanTouch = i
			const side: ApexEventSide | null = row.close < row.mean ? 'long' : row.close > row.mean ? 'short' : null
			if (side != null && lastMeanTouch >= 0 && (runtime.state === 'NEUTRAL' || runtime.episode?.side !== side)) {
				runtime.episode = { side, start: i, lastMean: lastMeanTouch, innerTouch: null, extreme: adverse(row, side), newExtremes: 0, lastIncrement: null, previousIncrement: null, previousClose: row.close }
				move(i, 'ARMED', 'mean-close-arm', side)
			}
			if (runtime.state === 'ARMED' && runtime.episode != null && innerTouched(row, runtime.episode.side)) {
				runtime.episode.innerTouch = i
				runtime.episode.extreme = adverse(row, runtime.episode.side)
				runtime.episode.previousClose = row.close
				move(i, 'EXTENDED', 'inner-touch')
			}
			continue
		}

		const episode = runtime.episode
		if (runtime.state === 'EXTENDED' && episode != null) {
			const remainsBeyondMean = episode.side === 'long' ? row.close < row.mean : row.close > row.mean
			if (!remainsBeyondMean) { reset(i, 'mean-reset'); continue }
			const nextExtreme = adverse(row, episode.side)
			const isNew = episode.side === 'long' ? nextExtreme < episode.extreme : nextExtreme > episode.extreme
			if (isNew) {
				episode.previousIncrement = episode.lastIncrement
				episode.lastIncrement = episode.side === 'long' ? episode.extreme - nextExtreme : nextExtreme - episode.extreme
				episode.extreme = nextExtreme
				episode.newExtremes++
			}
			episode.previousClose = rows[i - 1]!.close
			move(i, 'TRACKING', episode.side === 'long' ? 'next-bar-below-mean' : 'next-bar-above-mean')
			continue
		}

		if (runtime.state === 'TRACKING' && episode != null) {
			const nextExtreme = adverse(row, episode.side)
			const isNew = episode.side === 'long' ? nextExtreme < episode.extreme : nextExtreme > episode.extreme
			if (isNew) {
				episode.previousIncrement = episode.lastIncrement
				episode.lastIncrement = episode.side === 'long' ? episode.extreme - nextExtreme : nextExtreme - episode.extreme
				episode.extreme = nextExtreme
				episode.newExtremes++
			}
			if (!isNew && closerToMean(row, rows[i - 1]!.close)) {
				move(i, 'REVERSAL_CONFIRMED', 'reversal-confirmed')
				const entryIndex = i + 1 < rows.length ? i + 1 : null
				events.push({
					id: `${row.timestamp}:${episode.side}`,
					side: episode.side,
					episodeStartIndex: episode.start,
					innerTouchIndex: episode.innerTouch!,
					confirmationIndex: i,
					confirmationTimestamp: row.timestamp,
					entryIndex,
					entryTimestamp: entryIndex == null ? null : rows[entryIndex]!.timestamp,
					features: featurePayload(rows, i, episode),
				})
				move(i, 'COOLDOWN', 'emitted')
			}
		}
	}
	return { events, transitions }
}

export function labelStatefulApexEvent(rows: readonly StatefulApexRow[], event: StatefulApexEvent, oneWayCostBps = 5): ApexOutcomeLabel | null {
	if (event.entryIndex == null) return null
	const entryRow = rows[event.entryIndex]
	const confirmation = rows[event.confirmationIndex]
	if (entryRow == null || confirmation == null || !isValidStatefulApexRow(entryRow) || !isValidStatefulApexRow(confirmation)) return null
	const entry = entryRow.open
	const target = confirmation.mean
	const stop = event.side === 'long' ? confirmation.lowerOuter : confirmation.upperOuter
	const oneR = Math.abs(entry - stop)
	const stopAdverse = event.side === 'long' ? stop < entry : stop > entry
	if (!(oneR > 0) || !stopAdverse) return null
	let mfeR = 0, maeR = 0, timeToMfeBars = 0, timeToMaeBars = 0
	let targetBeforeStop: true | false | 'censored' = 'censored'
	let exitIndex: number | null = null
	for (let i = event.entryIndex; i < rows.length; i++) {
		const row = rows[i]!
		if (!isValidStatefulApexRow(row)) break
		const favorable = event.side === 'long' ? row.high - entry : entry - row.low
		const adverseMove = event.side === 'long' ? entry - row.low : row.high - entry
		if (favorable / oneR > mfeR) { mfeR = favorable / oneR; timeToMfeBars = i - event.entryIndex }
		if (adverseMove / oneR > maeR) { maeR = adverseMove / oneR; timeToMaeBars = i - event.entryIndex }
		const stopHit = event.side === 'long' ? row.low <= stop : row.high >= stop
		const targetHit = event.side === 'long' ? row.high >= target : row.low <= target
		if (stopHit || targetHit) {
			// Frozen conservative convention: stop first when both are inside one bar.
			targetBeforeStop = stopHit ? false : true
			exitIndex = i
			break
		}
	}
	const grossR = targetBeforeStop === 'censored' ? null : targetBeforeStop ? Math.abs(target - entry) / oneR : -1
	const exitPrice = targetBeforeStop === 'censored' ? null : targetBeforeStop ? target : stop
	const costR = exitPrice == null ? null : (entry + exitPrice) * (oneWayCostBps / 10_000) / oneR
	return { entry, target, stop, oneR, mfeR, maeR, timeToMfeBars, timeToMaeBars, targetBeforeStop, exitIndex, grossR, netR5bps: grossR == null || costR == null ? null : grossR - costR, censored: targetBeforeStop === 'censored' }
}
