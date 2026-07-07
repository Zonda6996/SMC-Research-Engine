/**
 * Одноразовый скрипт: тянем 500 свечей с Binance и сохраняем в JSON-файл.
 * Использование: npx tsx scripts/save-fixture.ts
 *
 * Результат — tests/fixtures/btcusdt-15m-500.json,
 * фиксированный снапшот для офлайн-тестов пайплайна.
 */

import { writeFileSync } from 'node:fs'
import { BinanceService } from '../src/services/BinanceService.js'

async function main() {
	const service = new BinanceService()
	const candles = await service.getCandles({
		symbol: 'BTC/USDT',
		timeframe: '15m',
		limit: 500,
	})

	const outPath = new URL('../tests/fixtures/btcusdt-15m-500.json', import.meta.url)
	writeFileSync(outPath, JSON.stringify(candles, null, 2))

	console.log(
		`Saved ${candles.length} candles to ${outPath.pathname}`,
	)
}

main()
