import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityPoi, LIQUIDITY_POI_VERSION } from '../src/core/confirmation/LiquidityPoiCalibration.js'
import type { Candle } from '../src/models/price/Candle.js'

const TF = 14_400_000
const flat = (n: number, price = 100): Candle[] => Array.from({ length: n }, (_, i) => ({
	timestamp: i * TF, open: price, high: price + 1, low: price - 1, close: price + 0.5, volume: 1,
}))
const mkPool = (o: Record<string, unknown>) => ({
	id: `pool-${Math.random()}`, version: 'v', spanBins: 1, startIndex: 0, lastContributionIndex: 0,
	lastContributionAt: 0, sweptIndex: null, sweptAt: null, contributions: 5, volumeAccumulated: 1,
	notional: 10, remainingNotional: 10, status: 'active', endAt: 0, weight: 0, ...o,
}) as never

it('версия v2.1 заморожена; без пулов зон нет (liquidity-first)', () => {
	assert.equal(LIQUIDITY_POI_VERSION, 'liquidity-poi-2.1-valley-shelves')
	assert.deepEqual(detectLiquidityPoi([]), [])
	assert.deepEqual(detectLiquidityPoi(flat(20), [], {}), [])
	assert.deepEqual(detectLiquidityPoi(flat(20), [], { heatmapPools: [] }), [])
})

it('§16.12: полка рождает зону — far = конец стека, near = край полки (без экстремума рядом)', () => {
	const c = flat(20)
	const shelf = mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, startAt: c[2]!.timestamp, lastContributionAt: c[2]!.timestamp })
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out.length, 1)
	const z = out[0]!
	assert.equal(z.direction, 'short')
	assert.equal(z.zoneClass, 'liquidity-shelf')
	assert.equal(z.near, 104)
	assert.equal(z.far, 106)
	assert.equal(z.eventType, 'shelf-edge')
	assert.equal(z.boundarySource, 'liquidity-cluster')
	assert.equal(z.knownAt, c[2]!.timestamp + TF) // пулы известны на закрытии бара
	assert.equal(z.lifecycleState, 'fresh')
	assert.equal(z.valid, true)
})

it('§16.12/§12.1: near = точный wick невыметенного экстремума перед полкой, если он в пределах допуска', () => {
	const c = flat(20)
	c[5] = { ...c[5]!, high: 103.8 } // фрактал-хай, подтверждён закрытием c7 (known = open(c7)+TF)
	const shelf = mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, startAt: c[8]!.timestamp, lastContributionAt: c[8]!.timestamp })
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out.length, 1)
	assert.equal(out[0]!.near, 103.8)
	assert.equal(out[0]!.eventType, 'shelf+extremum')
	assert.equal(out[0]!.far, 106)
})

it('§16.12/§16.13: значимость — зоны рождают только топ-N полок с долей ≥ shelfMinShare (0.03)', () => {
	const c = flat(20)
	const at = c[2]!.timestamp
	const pools = [
		mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, notional: 10, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 111, bandLow: 110, bandHigh: 112, notional: 8, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 117, bandLow: 116, bandHigh: 118, notional: 6, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 123, bandLow: 122, bandHigh: 124, notional: 0.5, startAt: at, lastContributionAt: at }),
	]
	const out = detectLiquidityPoi(c, [], { heatmapPools: pools })
	assert.equal(out.length, 3)
	assert.ok(out.every(z => Math.min(z.near, z.far) < 120)) // слабая полка 122-124 (0.5 из 24.5 < 3%) зоной не стала
})

it('§16.12: соседние пулы склеиваются в один стек — одна зона на полку', () => {
	const c = flat(20)
	const at = c[2]!.timestamp
	const pools = [
		mkPool({ side: 'sell-side', extremePrice: 104.5, bandLow: 104, bandHigh: 105, notional: 6, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 105.6, bandLow: 105.2, bandHigh: 106, notional: 4, startAt: at, lastContributionAt: at }),
	]
	const out = detectLiquidityPoi(c, [], { heatmapPools: pools })
	assert.equal(out.length, 1)
	assert.equal(out[0]!.near, 104)
	assert.equal(out[0]!.far, 106)
	assert.equal(out[0]!.pivotCount, 2)
})

it('§16.10: фитиль за far = отработана насквозь (swept-through), момент = закрытие бара прохода', () => {
	const c = flat(20)
	const shelf = mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, startAt: c[2]!.timestamp, lastContributionAt: c[2]!.timestamp })
	c[12] = { ...c[12]!, high: 106.5 } // проход насквозь, close внутри диапазона
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out[0]!.lifecycleState, 'spent')
	assert.equal(out[0]!.spentReason, 'swept-through')
	assert.equal(out[0]!.spentAt, c[12]!.timestamp + TF)
})

it('§14.6: close телом за far = провалена (failed)', () => {
	const c = flat(20)
	const shelf = mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, startAt: c[2]!.timestamp, lastContributionAt: c[2]!.timestamp })
	c[12] = { ...c[12]!, high: 108, close: 107 }
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out[0]!.lifecycleState, 'failed')
	assert.equal(out[0]!.failedAt, c[12]!.timestamp)
})

it('§16.12: стек снят по объёму (≥50% notional пулов) → отработана (stack-consumed)', () => {
	const c = flat(20)
	const at = c[2]!.timestamp
	const pools = [
		mkPool({ side: 'sell-side', extremePrice: 104.5, bandLow: 104, bandHigh: 105, notional: 6, startAt: at, lastContributionAt: at, sweptAt: c[10]!.timestamp }),
		mkPool({ side: 'sell-side', extremePrice: 105.6, bandLow: 105.2, bandHigh: 106, notional: 4, startAt: at, lastContributionAt: at }),
	]
	const out = detectLiquidityPoi(c, [], { heatmapPools: pools })
	assert.equal(out.length, 1)
	assert.equal(out[0]!.lifecycleState, 'spent')
	assert.equal(out[0]!.spentReason, 'stack-consumed')
	assert.equal(out[0]!.spentAt, c[10]!.timestamp)
})

it('§16.12: ran-away ОТМЕНЁН — касание и уход цены на 5+ ATR не хоронят зону с живым стеком', () => {
	const c = flat(30)
	const shelf = mkPool({ side: 'buy-side', extremePrice: 95, bandLow: 94, bandHigh: 96, startAt: c[2]!.timestamp, lastContributionAt: c[2]!.timestamp })
	c[10] = { ...c[10]!, low: 95.5 } // касание
	for (let i = 11; i < 30; i++) c[i] = { ...c[i]!, open: 110, high: 111, low: 109, close: 110.5 } // уход на ~7 ATR
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out.length, 1)
	assert.equal(out[0]!.lifecycleState, 'fresh')
	assert.equal(out[0]!.valid, true)
	assert.equal(out[0]!.touchCount, 1)
	assert.equal(out[0]!.spentAt, null)
})

it('§16.13: супер-цепь режется по провалу плотности — два горба через тонкий мост = две зоны', () => {
	const c = flat(20)
	const at = c[2]!.timestamp
	// Полосы соприкасаются в одну цепь (разрывы ≤ 0.5 ATR = 1.0), но между горбами ≥3 корзин
	// по 0.4% с массой < 25% пика (мосты по 0.5 при пике ~20 на корзину) — разрез посередине.
	const pools = [
		mkPool({ side: 'sell-side', extremePrice: 100.5, bandLow: 100, bandHigh: 101, notional: 50, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 101.6, bandLow: 101.4, bandHigh: 101.8, notional: 0.5, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 102.8, bandLow: 102.6, bandHigh: 103.0, notional: 0.5, startAt: at, lastContributionAt: at }),
		mkPool({ side: 'sell-side', extremePrice: 104.5, bandLow: 104, bandHigh: 105, notional: 50, startAt: at, lastContributionAt: at }),
	]
	const out = detectLiquidityPoi(c, [], { heatmapPools: pools })
	assert.equal(out.length, 2)
	const nears = out.map(z => z.near).sort((a, b) => a - b)
	assert.deepEqual(nears, [100, 102.6])
	assert.ok(out.every(z => Math.abs(z.near - z.far) < 3)) // мега-зоны 100→105 больше нет
})

it('§16.13: потолок высоты — far ≤ stackMaxPct (8%) от цены ближнего края, без ATR-ноги', () => {
	const c = flat(20)
	const shelf = mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 100, bandHigh: 110, startAt: c[2]!.timestamp, lastContributionAt: c[2]!.timestamp })
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out.length, 1)
	assert.equal(out[0]!.near, 100)
	assert.equal(out[0]!.far, 108) // min(110, 100 + 0.08×100); ATR=2 на потолок не влияет
})

it('§16.13: свежесть 300 — полка, не кормившаяся 300 баров, гасит зону (retired)', () => {
	const c = flat(310)
	const shelf = mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, startAt: c[2]!.timestamp, lastContributionAt: c[2]!.timestamp })
	const out = detectLiquidityPoi(c, [], { heatmapPools: [shelf] })
	assert.equal(out.length, 1)
	assert.equal(out[0]!.lifecycleState, 'retired')
	assert.equal(out[0]!.retiredAt, c[2]!.timestamp + 300 * TF)
})

it('§16.13: гард высоты — полка, выросшая сильнее 2× вокруг старой узкой зоны, живёт рядом (не дубль)', () => {
	const c = flat(40)
	const a2 = c[2]!.timestamp, a20 = c[20]!.timestamp
	const pools = [
		mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, notional: 5, startAt: a2, lastContributionAt: a2 }),
		// Ре-аккумуляция: полка выросла до 103-108.5 (высота 5.5 > 2×2) — перекрытие 100% старой,
		// но это НЕ «два стопа в одной зоне», а новый объект вокруг неё.
		mkPool({ side: 'sell-side', extremePrice: 104.2, bandLow: 103, bandHigh: 106, notional: 10, startAt: a20, lastContributionAt: a20 }),
		mkPool({ side: 'sell-side', extremePrice: 107.2, bandLow: 105.9, bandHigh: 108.5, notional: 10, startAt: a20, lastContributionAt: a20 }),
	]
	const out = detectLiquidityPoi(c, [], { heatmapPools: pools })
	const senior = out.find(z => z.near === 104)
	const junior = out.find(z => z.near === 103)
	assert.ok(senior && junior)
	assert.equal(senior!.duplicateOf, null)
	assert.equal(junior!.duplicateOf, null) // без гарда §16.13 стал бы дублем (перекрытие 1.0 ≥ 0.6)
})

it('§16.12: существенное обновление пулов полки (novelty ≥ 0.5) перерождает зону; дубль подавляется живой старшей', () => {
	const c = flat(40)
	const a2 = c[2]!.timestamp, a20 = c[20]!.timestamp
	const pools = [
		mkPool({ side: 'sell-side', extremePrice: 105, bandLow: 104, bandHigh: 106, notional: 5, startAt: a2, lastContributionAt: a2 }),
		// Ре-аккумуляция: новый жирный пул в том же месте (novelty 10/15 ≥ 0.5) → новый кандидат.
		mkPool({ side: 'sell-side', extremePrice: 105.5, bandLow: 104.5, bandHigh: 106.5, notional: 10, startAt: a20, lastContributionAt: a20 }),
	]
	const out = detectLiquidityPoi(c, [], { heatmapPools: pools })
	const around104 = out.filter(z => Math.min(z.near, z.far) < 105)
	assert.equal(around104.length, 2)
	const senior = around104.find(z => z.duplicateOf == null)!
	const dup = around104.find(z => z.duplicateOf != null)!
	assert.ok(senior && dup)
	assert.equal(dup.duplicateOf, senior.id) // старшая зона жива — новое поколение подавлено как дубль
	assert.equal(dup.active, false)
	assert.ok(senior.suppressedCount >= 1)
	// Без обновления пулов непрерывно значимая полка эмитится ровно один раз.
	const single = detectLiquidityPoi(c, [], { heatmapPools: [pools[0]!] })
	assert.equal(single.length, 1)
})
