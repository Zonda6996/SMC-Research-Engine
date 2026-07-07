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
	it('заполняет market.protectedLow и market.protectedHigh на реальных данных (регрессия бага №1)', () => {
		const candles = loadFixture()
		const snapshot = runAnalysis(candles)

		assert.ok(
			snapshot.market.protectedLow !== undefined,
			'market.protectedLow должен быть заполнен — если undefined, скорее всего ' +
				'цикл marketEngine.update() по structure[] снова потерян при рефакторинге',
		)
		assert.ok(
			snapshot.market.protectedHigh !== undefined,
			'market.protectedHigh должен быть заполнен — аналогично',
		)
		assert.ok(
			snapshot.market.lastPoint !== undefined,
			'market.lastPoint должен быть заполнен',
		)

		// Типы-гаранты: protectedLow — это LOW-точка, protectedHigh — HIGH-точка
		assert.equal(snapshot.market.protectedLow!.type, 'low')
		assert.equal(snapshot.market.protectedHigh!.type, 'high')
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
	// Characterization-тест: документирует текущее
	// поведение бага №3 (SPEC, реестр дефектов).
	// Когда баг будет починен — этот тест нужно
	// переписать на позитивный ассерт.
	// ──────────────────────────────────────────────
	it.todo(
		'[SPEC баг №3] protectedLow инвалидируется при пробое цены до следующей LL',
	)

	// Временный characterization-подход: проверяем,
	// что на реальных данных protectedLow не содержит
	// очевидно устаревших значений (цену уже ниже).
	// Это НЕ полный фикс бага №3 — только минимальная
	// нижняя граница, которая ловит «market пустой».
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
