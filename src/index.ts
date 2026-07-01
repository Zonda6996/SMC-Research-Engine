import { BinanceService } from './services/BinanceService.js'
import { PivotDetector } from './core/PivotDetector.js'
import { SwingEngine } from './core/SwingEngine.js'
import { StructureEngine } from './core/StructureEngine.js'
import { MarketStructureEngine } from './core/MarketStructureEngine.js'
import { LegEngine } from './core/LegEngine.js'
import { ATREngine } from './core/ATREngine.js'
import { LegStrengthEngine } from './core/LegStrengthEngine.js'

async function main() {
	const service = new BinanceService()

	const candles = await service.getCandles({
		symbol: 'BTC/USDT',
		timeframe: '15m',
		limit: 500,
	})

	console.log(`Loaded ${candles.length} candles`)

	const detector = new PivotDetector(2)

	const pivots = detector.detect(candles)
	const swings = new SwingEngine().build(pivots)
	const structure = new StructureEngine().build(swings)
	const market = new MarketStructureEngine().process(structure)
	const legs = new LegEngine().build(structure)
	const atr = new ATREngine().build(candles)
	const legStrength = new LegStrengthEngine().build(legs, atr)

	console.log('\n==============================')
	console.log('STRUCTURE ENGINE')
	console.log('==============================')

	console.log(`Candles   : ${candles.length}`)
	console.log(`Pivots    : ${pivots.length}`)
	console.log(`Swings    : ${swings.length}`)
	console.log(`Structure : ${structure.length}`)
	console.log('')

	console.log('Last structure points:')
	console.log(
		'----------------------------------------------------------------------------',
	)

	for (const point of structure.slice(-25)) {
		console.log(
			`${String(point.index).padStart(4)} | ${point.type
				.toUpperCase()
				.padEnd(4)} | ${point.label.padEnd(7)} | ${new Date(
				point.timestamp,
			).toLocaleString('ru-RU')} | ${point.price.toFixed(2)}`,
		)
	}

	console.log(
		'----------------------------------------------------------------------------',
	)

	console.log()
	console.log('==============================')
	console.log('MARKET STRUCTURE')
	console.log('==============================')

	console.log(`Trend : ${market.trend}`)

	if (market.protectedHigh) {
		console.log(
			`Protected High : ${market.protectedHigh.price.toFixed(2)} (${market.protectedHigh.label})`,
		)
	}

	if (market.protectedLow) {
		console.log(
			`Protected Low  : ${market.protectedLow.price.toFixed(2)} (${market.protectedLow.label})`,
		)
	}

	console.log()
	console.log('==============================')
	console.log('EXTERNAL LEG')
	console.log('==============================')

	if (market.externalLeg) {
		console.log(`Direction : ${market.externalLeg.direction}`)
		console.log(
			'---------------------------------------------------------------------',
		)

		console.log(
			`HIGH | ${market.externalLeg.high.label.padEnd(7)} | ${new Date(
				market.externalLeg.high.timestamp,
			).toLocaleString('ru-RU')} | ${market.externalLeg.high.price.toFixed(2)}`,
		)

		console.log(
			`LOW  | ${market.externalLeg.low.label.padEnd(7)} | ${new Date(
				market.externalLeg.low.timestamp,
			).toLocaleString('ru-RU')} | ${market.externalLeg.low.price.toFixed(2)}`,
		)

		console.log(
			'---------------------------------------------------------------------',
		)
	}

	console.log()
	console.log('==============================')
	console.log('LEGS')
	console.log('==============================')

	console.log(
		'------------------------------------------------------------------------------------------------',
	)

	for (const leg of legs.slice(-10)) {
		console.log(
			`${leg.direction.toUpperCase().padEnd(8)} | ${leg.start.label.padEnd(7)} ${leg.start.price.toFixed(2)} (${new Date(leg.start.timestamp).toLocaleString('ru-RU')})`,
		)

		console.log(`${' '.repeat(10)} ↓`)

		console.log(
			`${' '.repeat(10)} ${leg.end.label.padEnd(7)} ${leg.end.price.toFixed(2)} (${new Date(leg.end.timestamp).toLocaleString('ru-RU')})`,
		)

		console.log(
			'------------------------------------------------------------------------------------------------',
		)
	}

	console.log()
	console.log('==============================')
	console.log('ATR')
	console.log('==============================')

	for (const point of atr.slice(-10)) {
		console.log(
			`${new Date(point.timestamp).toLocaleString('ru-RU')} | ${point.value.toFixed(2)}`,
		)
	}

	console.log()
	console.log('==============================')
	console.log('LEG STRENGTH')
	console.log('==============================')

	for (const item of legStrength.slice(-10)) {
		console.log('----------------------------------------------------------')

		console.log(`${item.leg.direction.toUpperCase()}`)

		console.log(`Range      : ${item.range.toFixed(2)}`)

		console.log(`AverageATR : ${item.averageAtr.toFixed(2)}`)

		console.log(`Strength   : ${item.strength.toFixed(2)} ATR`)
	}
}

main()
