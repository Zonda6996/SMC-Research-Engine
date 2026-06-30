import { BinanceService } from './services/BinanceService.js'
import { PivotDetector } from './core/PivotDetector.js'
import { SwingEngine } from './core/SwingEngine.js'
import { StructureEngine } from './core/StructureEngine.js'

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

	for (const point of structure.slice(-15)) {
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
}

main()
