import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runAnalysis } from '../src/core/analysis/runAnalysis.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'
import { MarketStructureEngine } from '../src/core/builders/MarketStructureEngine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'fixtures', 'btcusdt-15m-500.json')

/**
 * Загружает реальные свечи из фикстуры (офлайн, без сети).
 */
function loadFixture(): Candle[] {
	return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Candle[]
}

describe('runAnalysis pipeline', () => {
	it('market-движок получает данные на реальных данных (регрессия бага №1)', () => {
		const candles = loadFixture()
		const snapshot = runAnalysis(candles)

		// Намерение теста: поймать потерю цикла marketEngine.update() по
		// structure[] при рефакторинге (баг №1). Раньше он проверял
		// protectedLow/protectedHigh на !== undefined, но после фикса бага №3
		// (инвалидация по закрытию свечи) эти поля законно могут быть undefined
		// на финале данных — последний уровень пробит до конца фикстуры, и новая
		// HH/LL не успела его перевыставить. Поэтому стабильный индикатор того,
		// что движок вообще отработал — lastPoint (последняя structure-точка) и
		// аккумулирующий массив breached[].
		assert.ok(
			snapshot.market.lastPoint !== undefined,
			'market.lastPoint должен быть заполнен — если undefined, цикл ' +
				'marketEngine.update() по structure[] снова потерян при рефакторинге',
		)
		assert.ok(
			Array.isArray(snapshot.market.breached),
			'market.breached должен быть массивом (появился в фиксе бага №3)',
		)

		// На 500 реальных свечей движок гарантированно фиксирует хотя бы один
		// пробой защищаемого уровня — это и есть симптом того, что цикл update()
		// дёргался и инвалидация работает.
		assert.ok(
			snapshot.market.breached.length > 0,
			'на реальных данных обязаны быть пробитые protected-уровни',
		)

		// Баг №4: trend + trendHistory. Эволюция по точкам — фундамент для
		// будущего look-ahead-free BOS/CHoCH (баг №5). trendHistory должна быть
		// 1-в-1 со structure (запись на каждую точку), trend — финальное значение.
		assert.ok(
			Array.isArray(snapshot.market.trendHistory),
			'market.trendHistory должен быть массивом (фикс бага №4)',
		)
		assert.equal(
			snapshot.market.trendHistory.length,
			snapshot.structure.length,
			'trendHistory 1-1 со structure (запись на каждую точку)',
		)
		assert.ok(
			snapshot.market.trend !== undefined,
			'market.trend должен быть заполнен финальным значением',
		)

		// Тип-гаранты для активных уровней (если есть): protectedLow — это
		// LOW-точка, protectedHigh — HIGH-точка.
		if (snapshot.market.protectedLow) {
			assert.equal(snapshot.market.protectedLow.type, 'low')
		}
		if (snapshot.market.protectedHigh) {
			assert.equal(snapshot.market.protectedHigh.type, 'high')
		}
	})

	it('пайплайн отрабатывает без ошибок и возвращает ожидаемые топологии', () => {
		const candles = loadFixture()
		const snapshot = runAnalysis(candles)

		// Свечи прошли через весь пайплайн без падений
		assert.equal(snapshot.candles.length, 500)

		// Пивоты — подмножество свечей (строгий фильтр, window=2)
		assert.ok(snapshot.pivots.length > 0, 'должны быть пивоты')
		assert.ok(snapshot.pivots.length < 500, 'пивотов меньше, чем свечей')

		// Свинги — схлопнутые пивоты (меньше или равно пивотам)
		assert.ok(snapshot.swings.length > 0, 'должны быть свинги')
		assert.ok(snapshot.swings.length <= snapshot.pivots.length)

		// Структура — 1-в-1 со свингами, только с лейблами
		assert.equal(
			snapshot.structure.length,
			snapshot.swings.length,
			'количество точек структуры = количеству свингов',
		)

		// ATR: первые period свечей — seed, поэтому ATR.length < candles.length
		assert.ok(
			snapshot.atr.length > 0,
			'должны быть ATR-точки',
		)
		assert.ok(
			snapshot.atr.length < snapshot.candles.length,
			'ATR-точек меньше, чем свечей (seed-окно)',
		)

		// Swing legs — между каждой соседней парой structure, значит structure.length - 1
		assert.equal(
			snapshot.swingLegs.length,
			snapshot.structure.length - 1,
			'swing legs между каждой соседней парой structure',
		)

		// Leg strength: НЕ строго 1-1 со swing legs — LegStrengthEngine
		// сознательно пропускает ноги без единой ATR-точки внутри
		// (ноги, целиком попадающие в seed-окно ATR). Поэтому <=, но не сильно меньше.
		assert.ok(
			snapshot.legStrength.length <= snapshot.swingLegs.length,
			'leg strength не может быть больше числа swing legs',
		)
		assert.ok(
			snapshot.legStrength.length >= snapshot.swingLegs.length - 2,
			'пропущено может быть только несколько первых ног (seed-окно ATR)',
		)

		// Leg contexts — по одному на каждый structural leg
		assert.equal(
			snapshot.legContexts.length,
			snapshot.structuralLegs.length,
			'leg contexts 1-1 с structural legs',
		)
	})

	// ──────────────────────────────────────────────
	// Баг №3 (инвалидация protectedHigh/protectedLow
	// при пробое ценой) закрыт отдельным тест-файлом
	// tests/market-structure.test.ts — прямой unit-тест
	// MarketStructureEngine на синтетических данных.
	// ──────────────────────────────────────────────

	// На реальных данных активный protected-уровень (если он есть) должен
	// реально принадлежать массиву structure — это нижняя граница,
	// гарантирующая, что движок не хранит «висячие» точки.
	it('на реальных данных protectedLow — это LOW-точка из structure', () => {
		const candles = loadFixture()
		const snapshot = runAnalysis(candles)

		// protectedLow должен реально принадлежать массиву structure
		if (snapshot.market.protectedLow) {
			const found = snapshot.structure.some(
				(p: StructurePoint) => p === snapshot.market.protectedLow,
			)
			assert.ok(found, 'protectedLow должен быть одной из точек structure')
		}
	})
})
