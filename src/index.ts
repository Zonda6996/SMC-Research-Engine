import { BinanceService } from '@/services/BinanceService.js'
import { runAnalysis } from '@/core/analysis/runAnalysis.js'
import type { StructurePoint } from './models/structure/StructurePoint.js'
import type { Leg } from './models/legs/Leg.js'
import type { ATRPoint } from '@/models/indicators/ATRPoint.js'
import type { LegStrength } from './models/legs/LegStrength.js'

// ==========================
// Форматирование (только представление, никакой аналитики)
// ==========================

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString('ru-RU')
}

function formatPrice(price: number): string {
	return price.toFixed(2)
}

function structureRow(point: StructurePoint) {
	return {
		index: point.index,
		type: point.type.toUpperCase(),
		label: point.label,
		time: formatTime(point.timestamp),
		price: formatPrice(point.price),
	}
}

function legRow(leg: Leg) {
	return {
		direction: leg.direction.toUpperCase(),
		range: formatPrice(leg.range),
		candles: leg.candles,
		minutes: Math.round(leg.duration / 60000),
		startLabel: leg.start.label,
		startPrice: formatPrice(leg.start.price),
		startTime: formatTime(leg.start.timestamp),
		endLabel: leg.end.label,
		endPrice: formatPrice(leg.end.price),
		endTime: formatTime(leg.end.timestamp),
	}
}

function atrRow(point: ATRPoint) {
	return {
		time: formatTime(point.timestamp),
		value: formatPrice(point.value),
	}
}

function legStrengthRow(item: LegStrength) {
	return {
		direction: item.leg.direction.toUpperCase(),
		range: formatPrice(item.range),
		averageAtr: formatPrice(item.averageAtr),
		strength: `${item.strength.toFixed(2)} ATR`,
		candles: item.leg.candles,
	}
}

async function main() {
	const service = new BinanceService()

	const candles = await service.getCandles({
		symbol: 'ETH/USDT',
		timeframe: '4h',
		limit: 500,
	})

	const snapshot = runAnalysis(candles)

	console.log(`Loaded ${snapshot.candles.length} candles`)
	console.log(
		`Pivots: ${snapshot.pivots.length} | Swings: ${snapshot.swings.length} | Structure: ${snapshot.structure.length}`,
	)

	console.log('\n=== STRUCTURE (last 25) ===')
	console.table(snapshot.structure.slice(-25).map(structureRow))

	console.log('\n=== MARKET STRUCTURE ===')
	console.table({
		protectedHigh: snapshot.market.protectedHigh
			? `${formatPrice(snapshot.market.protectedHigh.price)} (${snapshot.market.protectedHigh.label})`
			: '-',
		protectedLow: snapshot.market.protectedLow
			? `${formatPrice(snapshot.market.protectedLow.price)} (${snapshot.market.protectedLow.label})`
			: '-',
	})

	console.log('\n=== SWING LEGS (last 20) ===')
	console.table(snapshot.swingLegs.slice(-20).map(legRow))

	console.log('\n=== LEG STRENGTH (last 10) ===')
	console.table(snapshot.legStrength.slice(-10).map(legStrengthRow))

	console.log('\n=== STRUCTURAL LEGS (last 10) ===')
	console.table(snapshot.structuralLegs.slice(-10).map(legRow))

	console.log('\n=== LEG CONTEXT ===')

	console.table(
		snapshot.legContexts.slice(-10).map(context => ({
			index: context.index,
			direction: context.leg.direction,
			start: context.leg.start.label,
			end: context.leg.end.label,
			previous: context.previous?.direction ?? '-',
			next: context.next?.direction ?? '-',
			isLast: context.isLast,
		})),
	)
}

main()
