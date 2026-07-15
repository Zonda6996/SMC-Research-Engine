// runBatch.ts
//
// Batch-раннер Fib Playbook: прогоняет матрицу активы × ТФ × конфиги и
// выдаёт сводную таблицу EV (markdown в консоль + CSV в файл).
// Исследовательский инструмент, НЕ часть пайплайна.
//
// Запуск (все параметры опциональны):
//   npx tsx tools/batch/runBatch.ts
//   npx tsx tools/batch/runBatch.ts --symbols BTC/USDT,ETH/USDT,SOL/USDT \
//     --timeframes 15m,30m,1h --limit 20000 --atr 0,5 --market futures
//
// Флаги:
//   --symbols     список пар через запятую (default: BTC/USDT,ETH/USDT,SOL/USDT)
//   --timeframes  список ТФ через запятую (default: 15m,30m,1h)
//   --limit       свечей на прогон, максимум 20000 (default: 20000)
//   --market      spot | futures (default: futures)
//   --atr         пороги min leg size в ATR через запятую (default: 0,5)
//   --fixture     использовать локальную фикстуру вместо биржи (smoke-тест)
//   --no-cache    не использовать дисковый кэш свечей
//   --min-in      минимум входов, чтобы строка попала в сводку (default: 20)
//   --out         путь к CSV (default: tools/batch/results/batch-<timestamp>.csv)
//   --sweep       OFAT-свип настроек детектора BOS/CHoCH: базовый конфиг +
//                 каждая ручка отклоняется по одной (pivotWindow, minLevelAge,
//                 dedup, skipSwept, breachMode). ~11 вариантов на датасет.
//   --variants    выборочный свип: id вариантов через запятую (см. SWEEP_VARIANTS,
//                 например --variants base,pw3,age0). Игнорируется без смысла --sweep.
//   --split       разрезать историю на N последовательных отрезков и посчитать
//                 каждый отдельно (default: 1). Тест на затухание edge во
//                 времени: настоящий edge должен быть виден в каждом отрезке,
//                 а не только в одной удачной фазе рынка.
//   --regime-csv  волна 1 фильтра режима (SPEC 7.15): дополнительный
//                 per-outcome CSV (regime-<stamp>.csv) — строка на каждый
//                 resolved-исход ядра плейбука с 4 метриками режима на момент
//                 создания сетапа. Диагностика перед фильтром.
//   --regime-filter волна 2 (SPEC 7.15): добавить в сводку сценарии
//                 oteRegime/deepRegime — те же исходы минус созданные в
//                 плохом режиме (atrRatio < 0.94 либо chochShare >= 0.5).
//                 Сравнение до/после в одном CSV; breaker не фильтруется.
//                 Вместе с --regime-filter добавляет также *Combo (волна 4,
//                 SPEC 7.17): итоговый плейбук — regime-фильтр, затем cooldown.
//   --fade        волна 5 (SPEC 7.19): вернуть fade141c/fade241nc в сводку и
//                 добавить *Inv (только сетапы из сжатия/пилы — инверсия
//                 фильтра 7.15) и *Combo (инверсия + cooldown). Гипотеза:
//                 fade — зеркальный к deep сетап по режиму рынка.
//   --filters     слой дискреционных фильтров (SPEC 7.20), только с --portfolio:
//                 late,align,extreme,chop,chop-ote через запятую. Формализация
//                 визуального ревью: late (вход у экстремума импульса), align
//                 (против доминирующего тренда), extreme (event-level не экстремум
//                 сегмента), chop (строгий режим-фильтр: effRatio/trendStability),
//                 chop-ote (chop только для OTE — blanket-chop убивает deep,
//                 см. setupFilters.ts). Отрезанные сделки — в ledger со
//                 status=filtered + filteredBy, в консоли foregone netR.
//   --eval-filters  пул-оценка ВСЕХ фильтров без портфеля (SPEC 7.20 iter 2):
//                 avgR срезанных vs пропущенных на одном пуле сделок.
//                 Портфельная симуляция для оценки фильтров некорректна —
//                 композиция (капасити/кулдауны) перемешивает состав сделок.
//   --dedup       волна 3 (SPEC 7.16): дедупликация пересекающихся сетапов.
//                 Добавляет копии ядра по трём правилам: *DedupCd (cooldown —
//                 не создавать сетап пока предыдущая сделка жива), *DedupOp
//                 (one-position — не входить при открытой позиции),
//                 *DedupLo (latest-only — новая сетка отменяет невошедшую
//                 старую). Плюс печать max одновременной экспозиции.
//
// Кэш свечей: tools/batch/cache/*.json — повторный прогон той же матрицы
// не ходит на биржу (удалить каталог = скачать заново).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import type { BosChochConfig } from '../../src/core/events/BosChochEngine.js'
import { fetchCandlesPaginated, MAX_CANDLES, type MarketKind } from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { FibReachRecord, FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'
import { netFullR, netBeR } from '../../src/core/fib/fibCosts.js'
import { computeRegimeMetrics } from '../../src/core/analysis/regimeMetrics.js'
import { passesRegimeFilter, DEFAULT_REGIME_FILTER } from '../../src/core/analysis/regimeFilter.js'
import { applyDedup, maxConcurrentTrades, DEDUP_RULES } from '../../src/core/analysis/dedupFilter.js'
import { outcomeToPortfolioTrade, runPortfolioBacktest, type PortfolioTrade } from '../../src/core/analysis/portfolioBacktest.js'
import { buildSetupFilterContext, firstFailingFilter, SETUP_FILTER_NAMES, type SetupFilterName } from '../../src/core/analysis/setupFilters.js'

// ---------- Свип детектора ----------

/**
 * OFAT (one-factor-at-a-time) свип вокруг принятого базового конфига
 * (SPEC 7.6): каждая ручка отклоняется по одной, остальные на базе.
 * Полная решётка намеренно НЕ строится: 100+ комбинаций на датасет — это
 * гарантированный оверфиттинг и нечитаемый вывод. Если OFAT покажет две
 * перспективные ручки — прицельно прогнать их парную решётку отдельным
 * запуском через --variants.
 */
interface SweepVariant {
	id: string
	config: Partial<BosChochConfig>
}

const SWEEP_VARIANTS: SweepVariant[] = [
	{ id: 'base', config: {} },
	// Окно пивотов — самая фундаментальная ручка: меняет всю структуру.
	// Главная надежда для 4h, где window=2 размечает шум.
	{ id: 'pw3', config: { pivotWindow: 3 } },
	{ id: 'pw5', config: { pivotWindow: 5 } },
	// Возраст уровня: 0 = без фильтра (все уровни), 40 = только старые.
	{ id: 'age0', config: { minLevelAge: 0 } },
	{ id: 'age10', config: { minLevelAge: 10 } },
	{ id: 'age40', config: { minLevelAge: 40 } },
	// Dedup соседних уровней: выкл / агрессивнее базовых 1.2.
	{ id: 'dedupOff', config: { dedupAtrMultiple: null } },
	{ id: 'dedup25', config: { dedupAtrMultiple: 2.5 } },
	// Skip swept: выкл / мягче базовых 0.6 (уровень «прощает» глубокий свип).
	{ id: 'sweptOff', config: { skipSweptAtrMultiple: null } },
	{ id: 'swept12', config: { skipSweptAtrMultiple: 1.2 } },
	// Подтверждение пробоя одной свечой вместо двух.
	{ id: 'single', config: { breachMode: 'single' } },
	// Окно свежести свипа для аннотации oppositeSweptBefore (base = 25).
	// Меняет ТОЛЬКО разрез sweep/noSweep в выводе, отбор событий не трогает:
	// узкое окно = только «CHoCH сразу после стоп-ханта» попадает в sweep-группу.
	{ id: 'swp5', config: { oppositeSweepLookback: 5 } },
	{ id: 'swp10', config: { oppositeSweepLookback: 10 } },
	{ id: 'swp50', config: { oppositeSweepLookback: 50 } },
	// Комбинаци��-кандидаты по итогам OFAT на 1h/2h (age0 — главная ручка,
	// single — второй кандидат): проверка на синергию против одиночных эффектов.
	{ id: 'age0single', config: { minLevelAge: 0, breachMode: 'single' } },
	{ id: 'age0swp10', config: { minLevelAge: 0, oppositeSweepLookback: 10 } },
]

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'cache')
const RESULTS_DIR = join(__dirname, 'results')
const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

// ---------- CLI ----------

interface CliArgs {
	symbols: string[]
	timeframes: string[]
	limit: number
	market: MarketKind
	atrThresholds: number[]
	fixture: boolean
	cache: boolean
	minIn: number
	out: string | null
	variants: SweepVariant[]
	split: number
	/** Walk-forward: правая граница окна данных (ms epoch), null = сейчас. */
	untilMs: number | null
	/** Человекочитаемая метка --until для имён файлов и кеша. */
	untilLabel: string | null
	/**
	 * Волна 1 фильтра режима (SPEC 7.15): писать per-outcome CSV с метриками
	 * режима на момент создания сетапа (ядро плейбука, zero-стоп). Диагностика
	 * ПЕРЕД фильтром: сначала смотрим, разделяет ли хоть одна метрика
	 * победителей и лоссы, порог выбираем по данным.
	 */
	regimeCsv: boolean
	/**
	 * Волна 2 фильтра режима (SPEC 7.15): добавить в сводку фильтрованные
	 * копии сценариев (oteRegime/deepRegime) — те же исходы минус сетапы,
	 * созданные в плохом режиме (atrRatio < 0.94 или chochShare >= 0.5).
	 * Сравнение до/после — в одном CSV на идентичных выборках.
	 */
	regimeFilter: boolean
	/**
	 * Волна 4 (SPEC 7.17): добавить в сводку дедуплицированные копии ядра
	 * по трём правилам (суффиксы DedupCd/DedupOp/DedupLo) + напечатать
	 * максимальную одновременную экспозицию до/после.
	 */
	dedup: boolean
	/**
	 * Волна 5 (SPEC 7.19): вернуть в сводку fade141c/fade241nc и добавить
	 * их копии с ИНВЕРТИРОВАННЫМ фильтром режима (*Inv — только сетапы,
	 * созданные в сжатии/пиле, где ote/deep запрещены) и с инверсией+кулдауном
	 * (*Combo). Гипотеза: fade — зеркальный сетап к deep по режиму.
	 */
		fade: boolean
		/** Хронологический портфель канонического combo по всем датасетам. */
		portfolio: boolean
		initialEquity: number
		riskPct: number
		maxRiskPct: number
		mcRuns: number
		seed: number
		/** Research controls; null keeps the historical baseline unchanged. */
	entryExpiryBars: number | null
	tradeTimeStopBars: number | null
	/**
	 * Подмножество канонических сценариев для портфеля (--scenarios ote,deep).
	 * По умолчанию полный канон: ote,deep,breaker. Неизвестные имена — ошибка,
	 * чтобы опечатка не превращалась в молчаливый прогон полного набора.
	 */
	portfolioScenarios: string[]
	/**
	 * Слой дискреционных фильтров (SPEC 7.20): --filters late,align,extreme,chop.
	 * Применяется к eligible-исходам ПЕРЕД портфелем; отрезанные попадают в
	 * ledger со статусом filtered и именем фильтра в filteredBy. Пустой список
	 * (без флага) = baseline без слоя. Опечатки — ошибка, как в --scenarios.
	 */
	setupFilters: SetupFilterName[]
	/**
	 * Пул-оценка фильтров (SPEC 7.20, итерация 2): --eval-filters. Оценивает
	 * ВСЕ фильтры на уровне пула сделок БЕЗ портфельной симуляции. Урок
	 * прогонов 15.07.2026: портфель (капасити, кулдауны, порядок заполнения
	 * слотов) добавляет композиционный рандом — удаление одной сделки
	 * каскадно переписывает состав всех последующих, и «эффект фильтра»
	 * неотличим от перетасовки. Пул-оценка отвечает на единственный честный
	 * вопрос: отличается ли средний netR срезанных сделок от пропущенных.
	 */
	evalFilters: boolean
	}

function parseArgs(argv: string[]): CliArgs {
	const get = (flag: string): string | null => {
		const i = argv.indexOf(flag)
		return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
	}
	// Guard: --portfolio собирает сделки только на полной истории
	// (period === 'full'), а --split убирает 'full' из прогонов — портфель
	// молча получал 0 сделок и писал пустые CSV. Walk-forward для портфеля
	// делается по monthly-CSV (даты уже в нём) или через --until.
	if (argv.includes('--portfolio') && Number(get('--split') ?? 1) > 1) {
		throw new Error('--portfolio is incompatible with --split: portfolio collects trades only on the full period. Use monthly CSV (per-epoch dates) or --until for walk-forward.')
	}
	// --until 2023-01-01 (или полный ISO): walk-forward на исторических окнах.
	const untilRaw = get('--until')
	let untilMs: number | null = null
	if (untilRaw) {
		const parsed = Date.parse(untilRaw)
		if (Number.isNaN(parsed)) throw new Error(`Bad --until date: ${untilRaw} (expected e.g. 2023-01-01)`)
		untilMs = parsed
	}
	return {
			symbols: (get('--symbols') ?? 'BTC/USDT,ETH/USDT,SOL/USDT,XRP/USDT,BNB/USDT,DOGE/USDT,ADA/USDT,AVAX/USDT,LINK/USDT,SUI/USDT,TON/USDT,NEAR/USDT,APT/USDT,LTC/USDT').split(',').map((s) => s.trim()),
		timeframes: (get('--timeframes') ?? '15m,30m,1h').split(',').map((s) => s.trim()),
		limit: Math.min(Number(get('--limit') ?? MAX_CANDLES), MAX_CANDLES),
		market: get('--market') === 'spot' ? 'spot' : 'futures',
		atrThresholds: (get('--atr') ?? '0,5').split(',').map(Number),
		fixture: argv.includes('--fixture'),
		cache: !argv.includes('--no-cache'),
		minIn: Number(get('--min-in') ?? 20),
		out: get('--out'),
		variants: resolveVariants(argv, get('--variants')),
		split: Math.max(1, Math.min(6, Number(get('--split') ?? 1))),
		untilMs,
		untilLabel: untilRaw ? untilRaw.replace(/[:]/g, '-') : null,
		regimeCsv: argv.includes('--regime-csv'),
		regimeFilter: argv.includes('--regime-filter'),
		dedup: argv.includes('--dedup'),
		fade: argv.includes('--fade'),
		portfolio: argv.includes('--portfolio'),
		initialEquity: Number(get('--initial-equity') ?? 10_000),
		riskPct: Number(get('--risk-pct') ?? 1),
		maxRiskPct: Number(get('--max-risk-pct') ?? 3),
		mcRuns: Math.max(0, Number(get('--mc-runs') ?? 2_000)),
			seed: Number(get('--seed') ?? 42),
			entryExpiryBars: get('--entry-expiry-bars') == null ? null : Math.max(0, Number(get('--entry-expiry-bars'))),
			tradeTimeStopBars: get('--trade-time-stop-bars') == null ? null : Math.max(0, Number(get('--trade-time-stop-bars'))),
			portfolioScenarios: resolvePortfolioScenarios(get('--scenarios')),
			setupFilters: resolveSetupFilters(get('--filters')),
			evalFilters: argv.includes('--eval-filters'),
		}
}

/** --filters late,align — подмножество слоя SPEC 7.20; опечатки падают с ошибкой. */
function resolveSetupFilters(flag: string | null): SetupFilterName[] {
	if (!flag) return []
	const requested = flag.split(',').map((s) => s.trim()).filter(Boolean)
	const unknown = requested.filter((s) => !SETUP_FILTER_NAMES.includes(s as SetupFilterName))
	if (unknown.length > 0 || requested.length === 0) {
		throw new Error(`Bad --filters: ${flag}. Allowed: ${SETUP_FILTER_NAMES.join(', ')}`)
	}
	return requested as SetupFilterName[]
}

const CANONICAL_PORTFOLIO_SCENARIOS = ['ote', 'deep', 'breaker'] as const

/** --scenarios ote,deep — подмножество канона; опечатки падают с ошибкой. */
function resolvePortfolioScenarios(flag: string | null): string[] {
	if (!flag) return [...CANONICAL_PORTFOLIO_SCENARIOS]
	const requested = flag.split(',').map((s) => s.trim()).filter(Boolean)
	const unknown = requested.filter((s) => !CANONICAL_PORTFOLIO_SCENARIOS.includes(s as never))
	if (unknown.length > 0 || requested.length === 0) {
		throw new Error(`Bad --scenarios: ${flag}. Allowed: ${CANONICAL_PORTFOLIO_SCENARIOS.join(', ')}`)
	}
	return requested
}

/** Без --sweep — только base; --sweep — все; --variants id,id — выборочно. */
function resolveVariants(argv: string[], variantsFlag: string | null): SweepVariant[] {
	if (variantsFlag) {
		const ids = variantsFlag.split(',').map((s) => s.trim())
		const unknown = ids.filter((id) => !SWEEP_VARIANTS.some((v) => v.id === id))
		if (unknown.length > 0) {
			throw new Error(`Unknown variants: ${unknown.join(', ')}. Known: ${SWEEP_VARIANTS.map((v) => v.id).join(', ')}`)
		}
		return SWEEP_VARIANTS.filter((v) => ids.includes(v.id))
	}
	if (argv.includes('--sweep')) return SWEEP_VARIANTS
	return [SWEEP_VARIANTS[0]!]
}

// ---------- Данные ----------

async function loadCandles(
	symbol: string,
	timeframe: string,
	limit: number,
	market: MarketKind,
	useCache: boolean,
	untilMs: number | null = null,
	untilLabel: string | null = null,
): Promise<Candle[]> {
	// Окно с --until попадает в ключ кеша — исторические окна не смешиваются
	// со свежими (и между собой).
	const untilKey = untilLabel ? `_until-${untilLabel}` : ''
	const key = `${symbol.replace('/', '-')}_${timeframe}_${limit}_${market}${untilKey}.json`
	const cachePath = join(CACHE_DIR, key)

	if (useCache && existsSync(cachePath)) {
		return JSON.parse(readFileSync(cachePath, 'utf-8'))
	}

	const candles = await fetchCandlesPaginated(symbol, timeframe, limit, market, untilMs)
	if (useCache && candles.length > 0) {
		mkdirSync(CACHE_DIR, { recursive: true })
		writeFileSync(cachePath, JSON.stringify(candles))
	}
	return candles
}

// ---------- Агрегация (та же логика, что в панели Playbook Stats) ----------

interface SliceStats {
	setups: number
	entered: number
	tp1Pct: number | null
	tp2Pct: number | null
	slPct: number | null
	evFull: number | null
	evBe: number | null
	/** Net EV (комиссия + слиппедж, см. fibCosts) — gross не подменяетс����. */
	evFullNet: number | null
	evBeNet: number | null
	/** Доля stopped-сделок, где после стопа цена всё же дошла до TP1. */
	stopTpPct: number | null
	/** Доля entered с maxExtensionRatio ≥ 141/200/241 (только тренд-сценарии). */
	ext141Pct: number | null
	ext200Pct: number | null
	ext241Pct: number | null
	/**
	 * MAE победителей (сделок, достигших TP1) — база для сокращения стопа:
	 * медиана и p90 худшей просадки в R (maeR отрицателен; −1 = полн��й стоп).
	 * Если 90% победителей не проседают глубже −0.5R, стоп можно вдвое короче
	 * ценой ~10% побед — а R каждой сделки удваивается.
	 */
	winMaeMed: number | null
	winMaeP90: number | null
	resolved: number
}

/**
 * EV на сделку в R для двух вариантов менеджмента — идентично формуле UI:
 * full — весь объём на TP1; be — 50% на TP1, безубыток, раннер до TP2.
 * Р��зрешённые сделки: TP1 либо стоп; открытые без TP1 исключаются.
 * Net-варианты — те же формулы за вычетом издержек (fibCosts).
 */
function aggregate(outcomes: FibSetupOutcome[]): SliceStats {
	const entered = outcomes.filter((o) => o.entered)
	const tp1 = entered.filter((o) => o.tp1Hit)
	const tp2 = entered.filter((o) => o.state === 'tp2')
	const stopped = entered.filter((o) => o.state === 'stopped' && !o.tp1Hit)
	const resolved = entered.filter((o) => o.tp1Hit || o.state === 'stopped')

	let fullSum = 0
	let beSum = 0
	let fullNetSum = 0
	let beNetSum = 0
	for (const o of resolved) {
		// Волна 4 (scale-in): лосс = rStop (< 1R по модулю, если добор не
		// сработал); обычные сценарии несут rStop = −1 — формула эквивалентна.
		fullSum += o.tp1Hit ? (o.rTp1 ?? 0) : (o.rStop ?? -1)
		beSum += o.tp1Hit ? 0.5 * (o.rTp1 ?? 0) + (o.state === 'tp2' && o.beIndex == null && o.beAfterTp1 !== true ? 0.5 * (o.rTp2 ?? 0) : 0) : (o.rStop ?? -1)
		fullNetSum += netFullR(o) ?? 0
		beNetSum += netBeR(o) ?? 0
	}

	// «Стоп выбит, затем TP1» — по всем stopped-сделкам (включая tp1Hit-стопы).
	const allStopped = entered.filter((o) => o.state === 'stopped' && o.tpAfterStop != null)
	const stopTp = allStopped.filter((o) => o.tpAfterStop === true)

	// Максимальное достигнутое расширение — только тренд-сценарии несут поле.
	const withExt = entered.filter((o) => o.maxExtensionRatio != null)
	const extPct = (threshold: number) =>
		withExt.length
			? withExt.filter((o) => (o.maxExtensionRatio ?? 0) >= threshold).length / withExt.length
			: null

	// MAE победителей: сортировка по возрастанию (глубже — раньше), p90 —
	// значение, глубже которого просаживаются лишь 10% худших победителей.
	const winMae = tp1
		.map((o) => o.maeR)
		.filter((v): v is number => v != null)
		.sort((a, b) => a - b)
	const quantile = (sorted: number[], q: number): number | null => {
		if (sorted.length === 0) return null
		const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
		return sorted[idx] ?? null
	}

	const pct = (part: number) => (entered.length ? part / entered.length : null)
	return {
		setups: outcomes.length,
		entered: entered.length,
		tp1Pct: pct(tp1.length),
		tp2Pct: pct(tp2.length),
		slPct: pct(stopped.length),
		evFull: resolved.length ? fullSum / resolved.length : null,
		evBe: resolved.length ? beSum / resolved.length : null,
		evFullNet: resolved.length ? fullNetSum / resolved.length : null,
		evBeNet: resolved.length ? beNetSum / resolved.length : null,
		stopTpPct: allStopped.length ? stopTp.length / allStopped.length : null,
		ext141Pct: extPct(141),
		ext200Pct: extPct(200),
		ext241Pct: extPct(241),
		winMaeMed: quantile(winMae, 0.5),
		// 10-й перцентиль по возрастанию = «90% поб��дителей проседают НЕ глубже».
		winMaeP90: quantile(winMae, 0.1),
		resolved: resolved.length,
	}
}

interface ResultRow {
	symbol: string
	timeframe: string
	/** id варианта конфига детектора (base | pw3 | age0 | ...). */
	variant: string
	/** Отрезок истории при --split: 'full' либо '1/3', '2/3', ... (хронологически). */
	period: string
	anchor: string
	trigger: string
	atr: number
	scenario: string
	stopMode: string
	stats: SliceStats
	/**
	 * Разбивка ��о направлению сделки. Ключевой тест на пр��роду edge:
	 * если EV положительный только у лонгов — это ставка на бычий режим
	 * периода; если у обеих сторон — структурное преимущество сетапа.
	 */
	long: SliceStats
	short: SliceStats
	/**
	 * A/B по свипу ликвидности: sweep — перед сломом был прокол
	 * противоположного экстремума (стоп-хант), noSweep — не было.
	 * Гипотеза: развороты (CHoCH) после свипа статистически надёжнее.
	 */
	sweep: SliceStats
	noSweep: SliceStats
}

/** В��е разрезы по одному датасету: якорь × триггер × ATR × сценарий × стоп. */
function sliceDataset(symbol: string, timeframe: string, variant: string, period: string, outcomes: FibSetupOutcome[], atrThresholds: number[]): ResultRow[] {
	const rows: ResultRow[] = []
	const anchors = ['local', 'global'] as const
	const triggers = ['bos', 'choch'] as const
	// Только плейбук (итоги волн 1–4, SPEC 7.10–7.13): ядро ote/deep/breaker
	// со стопом за 0, вариант TP2=200 (цели 141/200/241 остаются в работе)
	// и принятый фильтр breaker161. Отклонённые сценарии (fade-семейство,
	// breaker78, breaker tight, wide-стопы, scale-добор) из батча убраны,
	// но код и тесты сохранены — вернуть можно одной строкой здесь.
	const scenarioSlices: { scenario: string; stopMode: string }[] = [
		{ scenario: 'ote', stopMode: 'zero' },
		{ scenario: 'ote', stopMode: 'zero200' },
		{ scenario: 'deep', stopMode: 'zero' },
		{ scenario: 'deep', stopMode: 'zero200' },
		{ scenario: 'breaker', stopMode: 'zero' },
		{ scenario: 'breaker161', stopMode: 'zero' },
		// Исследо��ательский A/B: не входит в канонический combo-портфель.
		{ scenario: 'breaker200', stopMode: 'zero' },
	]
	// Волна 2 фильтра режима: срав��ение до/после на идентичных выборках.
	// Строки появляются только когда main подмешал релейбленные исходы
	// (--regime-filter); иначе группы пусты и в вывод не попадают.
	if (outcomes.some((o) => o.scenario.endsWith('Regime'))) {
		scenarioSlices.push(
			{ scenario: 'oteRegime', stopMode: 'zero' },
			{ scenario: 'deepRegime', stopMode: 'zero' },
		)
	}
	// Волна 3 дедупликации (SPEC 7.16): три правила × 4 сценария ядра,
	// суффиксы Cd (cooldown), Op (one-position), Lo (latest-only).
	if (outcomes.some((o) => /Dedup(Cd|Op|Lo)$/.test(o.scenario))) {
		for (const s of ['ote', 'deep', 'breaker', 'breaker161']) {
			for (const suffix of ['DedupCd', 'DedupOp', 'DedupLo']) {
				scenarioSlices.push({ scenario: `${s}${suffix}`, stopMode: 'zero' })
			}
		}
	}
	// Волна 4 (SPEC 7.17): итоговый плейбук — regime + cooldown вместе.
	if (outcomes.some((o) => o.scenario.endsWith('Combo'))) {
		for (const s of ['ote', 'deep', 'breaker', 'breaker161']) {
			scenarioSlices.push({ scenario: `${s}Combo`, stopMode: 'zero' })
		}
	}
	// Волна 5 (SPEC 7.19): fade с инвертированным режимом (*Inv) и
	// инверсия+кулдаун (*Combo). Оригиналы возвращены для сравнения.
	if (outcomes.some((o) => o.scenario.endsWith('Inv'))) {
		scenarioSlices.push(
			{ scenario: 'fade141c', stopMode: 'far' },
			{ scenario: 'fade241nc', stopMode: 'zoneAtr' },
			{ scenario: 'fade141cInv', stopMode: 'far' },
			{ scenario: 'fade241ncInv', stopMode: 'zoneAtr' },
			{ scenario: 'fade141cCombo', stopMode: 'far' },
			{ scenario: 'fade241ncCombo', stopMode: 'zoneAtr' },
		)
	}

	for (const anchor of anchors) {
		for (const trigger of triggers) {
			for (const atr of atrThresholds) {
				const base = outcomes.filter((o) =>
					o.variantMode === anchor &&
					o.trigger === trigger &&
					(o.legAtrRatio == null || o.legAtrRatio >= atr))
				for (const { scenario, stopMode } of scenarioSlices) {
					const group = base.filter((o) => o.scenario === scenario && o.stopMode === stopMode)
					rows.push({
						symbol, timeframe, variant, period, anchor, trigger, atr, scenario, stopMode,
						stats: aggregate(group),
						long: aggregate(group.filter((o) => o.direction === 'long')),
						short: aggregate(group.filter((o) => o.direction === 'short')),
						sweep: aggregate(group.filter((o) => o.oppositeSweptBefore)),
						noSweep: aggregate(group.filter((o) => !o.oppositeSweptBefore)),
					})
				}
			}
		}
	}
	return rows
}

// ---------- Гистограмма досягаемости ----------

/**
 * Агрегат досягаемости по срезу: доли кандидатов, чей ретрейс дошёл до уровня
 * (minRetraceRatio <= X) и чьё расширение достигло уровня (maxExtensionRatio >= X),
 * плюс медианы. Независимо от сценариев входа — «куда цена реально ходит».
 */
interface ReachRow {
	symbol: string
	timeframe: string
	variant: string
	period: string
	anchor: string
	trigger: string
	candidates: number
	/** Доли ретрейса до уровня: 78.6 / 61.8 / 50 / 38.2 / 23.6 / 0 (инвалидация). */
	ret: Record<string, number>
	/** Доли расширения до уровня: 100 / 141 / 161 / 200 / 241 / 261. */
	ext: Record<string, number>
	medianRetrace: number | null
	medianExtension: number | null
	/**
	 * Fade-reach после первого касания 141: n — коснувшихся, pull — доли
	 * отката до уровня (fade-цели), go — доли продолжения до уровня
	 * (fade-риск), medPull — медиана отката после касания.
	 */
	f141: { n: number; pull: Record<string, number>; go: Record<string, number>; medPull: number | null } | null
	/** То же после первого касания 241. */
	f241: { n: number; pull: Record<string, number>; go: Record<string, number>; medPull: number | null } | null
}

const RETRACE_LEVELS = [78.6, 61.8, 50, 38.2, 23.6, 0] as const
const EXTENSION_LEVELS = [100, 141, 161, 200, 241, 261] as const
/** Fade-цели после касания 141: откат до X (fade141 TP-уровни). */
const F141_PULL_LEVELS = [120, 100, 78.6, 61.8, 38.2] as const
/** Продолжение после касания 141 (fade141 SL-уровни). */
const F141_GO_LEVELS = [161, 200, 241] as const
/** Fade-цели после касания 241 (fade241n TP-ур��вни). */
const F241_PULL_LEVELS = [200, 141, 100, 78.6] as const
/** Продолжение после касания 241 (fade241 SL-уровни). */
const F241_GO_LEVELS = [261, 300, 350] as const

/** Агрегат fade-reach по группе: доли отката/продолжения после касания уровня. */
function fadeReachStats(
	records: { pullbackRatio: number; extensionRatio: number }[],
	pullLevels: readonly number[],
	goLevels: readonly number[],
): { n: number; pull: Record<string, number>; go: Record<string, number>; medPull: number | null } | null {
	if (records.length === 0) return null
	const pull: Record<string, number> = {}
	for (const level of pullLevels) {
		pull[String(level)] = records.filter((r) => r.pullbackRatio <= level).length / records.length
	}
	const go: Record<string, number> = {}
	for (const level of goLevels) {
		go[String(level)] = records.filter((r) => r.extensionRatio >= level).length / records.length
	}
	return { n: records.length, pull, go, medPull: median(records.map((r) => r.pullbackRatio)) }
}

function median(values: number[]): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	const lo = sorted[mid - 1]
	const hi = sorted[mid]
	if (hi == null) return null
	return sorted.length % 2 === 0 && lo != null ? (lo + hi) / 2 : hi
}

function sliceReach(symbol: string, timeframe: string, variant: string, period: string, reach: FibReachRecord[]): ReachRow[] {
	const rows: ReachRow[] = []
	for (const anchor of ['local', 'global'] as const) {
		for (const trigger of ['bos', 'choch'] as const) {
			const group = reach.filter((r) => r.variantMode === anchor && r.trigger === trigger)
			if (group.length === 0) continue
			const ret: Record<string, number> = {}
			for (const level of RETRACE_LEVELS) {
				ret[String(level)] = group.filter((r) => r.minRetraceRatio <= level).length / group.length
			}
			const ext: Record<string, number> = {}
			for (const level of EXTENSION_LEVELS) {
				ext[String(level)] = group.filter((r) => r.maxExtensionRatio >= level).length / group.length
			}
			rows.push({
				symbol, timeframe, variant, period, anchor, trigger,
				candidates: group.length,
				ret, ext,
				medianRetrace: median(group.map((r) => r.minRetraceRatio)),
				medianExtension: median(group.map((r) => r.maxExtensionRatio)),
				f141: fadeReachStats(
					group.flatMap((r) => (r.after141 ? [r.after141] : [])),
					F141_PULL_LEVELS, F141_GO_LEVELS,
				),
				f241: fadeReachStats(
					group.flatMap((r) => (r.after241 ? [r.after241] : [])),
					F241_PULL_LEVELS, F241_GO_LEVELS,
				),
			})
		}
	}
	return rows
}

// ---------- Волна 1 фильтра режима: per-outcome CSV (SPEC 7.15) ----------

/**
 * Строка на каждый resolved-исход ядра плейбука с метриками режима,
 * измеренными на createdAtIndex сетапа (look-ahead-free: метрики зависят
 * только от дан��ых до этого индекса). Только диагностика — на отбор
 * сетапов не влияет.
 */
interface RegimeRow {
	symbol: string
	timeframe: string
	period: string
	anchor: string
	trigger: string
	scenario: string
	direction: string
	state: string
	tp1Hit: boolean
	netBe: number | null
	effRatio: number | null
	atrRatio: number | null
	chochShare: number | null
	trendStability: number | null
}

/** Ядро плейбука для диагностики режима: тренд-сценарии, zero-стоп. */
const REGIME_SCENARIOS = new Set(['ote', 'deep', 'breaker', 'breaker161'])

function sliceRegime(
	symbol: string,
	timeframe: string,
	period: string,
	snapshot: import('../../src/models/analysis/AnalysisSnapshot.js').AnalysisSnapshot,
): RegimeRow[] {
	const metrics = computeRegimeMetrics(
		snapshot.candles,
		snapshot.atr,
		snapshot.events,
		snapshot.market.trendHistory,
	)
	const rows: RegimeRow[] = []
	for (const o of snapshot.fibLifecycle.outcomes) {
		if (!REGIME_SCENARIOS.has(o.scenario) || o.stopMode !== 'zero') continue
		if (!o.entered || !(o.tp1Hit || o.state === 'stopped')) continue
		const m = metrics[o.createdAtIndex]
		if (!m) continue
		rows.push({
			symbol,
			timeframe,
			period,
			anchor: o.variantMode,
			trigger: o.trigger,
			scenario: o.scenario,
			direction: o.direction,
			state: o.state,
			tp1Hit: o.tp1Hit,
			netBe: netBeR(o),
			effRatio: m.effRatio,
			atrRatio: m.atrRatio,
			chochShare: m.chochShare,
			trendStability: m.trendStability,
		})
	}
	return rows
}

function regimeToCsv(rows: RegimeRow[]): string {
	const header = [
		'symbol', 'timeframe', 'period', 'anchor', 'trigger', 'scenario', 'direction',
		'state', 'tp1_hit', 'net_be',
		'eff_ratio', 'atr_ratio', 'choch_share', 'trend_stability',
	]
	const fmt = (v: number | null): string => (v == null ? '' : v.toFixed(4))
	const lines = rows.map((r) =>
		[
			r.symbol, r.timeframe, r.period, r.anchor, r.trigger, r.scenario, r.direction,
			r.state, r.tp1Hit ? 1 : 0, fmt(r.netBe),
			fmt(r.effRatio), fmt(r.atrRatio), fmt(r.chochShare), fmt(r.trendStability),
		].join(','),
	)
	return [header.join(','), ...lines].join('\n')
}

function reachToCsv(rows: ReachRow[]): string {
	const header = [
		'symbol', 'timeframe', 'variant', 'period', 'anchor', 'trigger', 'candidates',
		...RETRACE_LEVELS.map((l) => `ret${String(l).replace('.', '')}_pct`),
		...EXTENSION_LEVELS.map((l) => `ext${String(l).replace('.', '')}_pct`),
		'median_retrace', 'median_extension',
		'f141_n',
		...F141_PULL_LEVELS.map((l) => `f141_pull${String(l).replace('.', '')}_pct`),
		...F141_GO_LEVELS.map((l) => `f141_go${l}_pct`),
		'f141_median_pull',
		'f241_n',
		...F241_PULL_LEVELS.map((l) => `f241_pull${String(l).replace('.', '')}_pct`),
		...F241_GO_LEVELS.map((l) => `f241_go${l}_pct`),
		'f241_median_pull',
	]
	const fadeCols = (
		f: { n: number; pull: Record<string, number>; go: Record<string, number>; medPull: number | null } | null,
		pullLevels: readonly number[],
		goLevels: readonly number[],
	) => [
		f?.n ?? 0,
		...pullLevels.map((l) => (f ? (f.pull[String(l)] ?? 0).toFixed(4) : '')),
		...goLevels.map((l) => (f ? (f.go[String(l)] ?? 0).toFixed(4) : '')),
		f?.medPull?.toFixed(1) ?? '',
	]
	const lines = rows.map((r) => [
		r.symbol, r.timeframe, r.variant, r.period, r.anchor, r.trigger, r.candidates,
		...RETRACE_LEVELS.map((l) => (r.ret[String(l)] ?? 0).toFixed(4)),
		...EXTENSION_LEVELS.map((l) => (r.ext[String(l)] ?? 0).toFixed(4)),
		r.medianRetrace?.toFixed(1) ?? '',
		r.medianExtension?.toFixed(1) ?? '',
		...fadeCols(r.f141, F141_PULL_LEVELS, F141_GO_LEVELS),
		...fadeCols(r.f241, F241_PULL_LEVELS, F241_GO_LEVELS),
	].join(','))
	return [header.join(','), ...lines].join('\n')
}

function reachToMarkdown(rows: ReachRow[]): string {
	const header = `| Dataset | Anchor | Trig | N | ≤78.6 | ≤61.8 | ≤50 | ���38.2 | ≤23.6 | ≤0 | ≥141 | ≥200 | ≥241 | medRet | medExt |`
	const sep = `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`
	const pct = (v: number | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)
	const lines = rows.map((r) =>
		`| ${r.symbol} ${r.timeframe} ${r.variant}${r.period === 'full' ? '' : ` ${r.period}`} | ${r.anchor} | ${r.trigger} | ${r.candidates} | ` +
		RETRACE_LEVELS.map((l) => pct(r.ret[String(l)])).join(' | ') + ' | ' +
		[141, 200, 241].map((l) => pct(r.ext[String(l)])).join(' | ') +
		` | ${r.medianRetrace?.toFixed(0) ?? '—'} | ${r.medianExtension?.toFixed(0) ?? '—'} |`)
	return [header, sep, ...lines].join('\n')
}

/** Fade-reach таблица: после касан��я 141/241 — куда откатывает и куда несёт. */
function fadeReachToMarkdown(rows: ReachRow[]): string {
	const header = `| Dataset | Anchor | Trig | 141: N | →120 | →100 | →78.6 | ↑161 | ↑200 | medPull | 241: N | →200 | →141 | →100 | ↑261 | medPull |`
	const sep = `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`
	const pct = (v: number | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)
	const lines = rows.filter((r) => r.f141 || r.f241).map((r) => {
		const a = r.f141
		const b = r.f241
		return `| ${r.symbol} ${r.timeframe} ${r.variant}${r.period === 'full' ? '' : ` ${r.period}`} | ${r.anchor} | ${r.trigger} | ` +
			`${a?.n ?? 0} | ${pct(a?.pull['120'])} | ${pct(a?.pull['100'])} | ${pct(a?.pull['78.6'])} | ${pct(a?.go['161'])} | ${pct(a?.go['200'])} | ${a?.medPull?.toFixed(0) ?? '—'} | ` +
			`${b?.n ?? 0} | ${pct(b?.pull['200'])} | ${pct(b?.pull['141'])} | ${pct(b?.pull['100'])} | ${pct(b?.go['261'])} | ${b?.medPull?.toFixed(0) ?? '—'} |`
	})
	return [header, sep, ...lines].join('\n')
}

// ---------- Вывод ----------

const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const fmtEv = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)

function scenarioLabel(scenario: string, stopMode: string): string {
	const wide = (base: string) =>
		stopMode === 'wide05' ? `${base} (SL 0−0.5ATR)`
		: stopMode === 'wide10' ? `${base} (SL 0−1ATR)`
		: stopMode === 'zero200' ? `${base} (SL 0, TP2 200)`
		: `${base} (SL 0)`
	if (scenario === 'ote') return stopMode === 'tight' ? 'OTE (SL 23.6)' : wide('OTE')
	if (scenario === 'deep') return wide('Deep')
	if (scenario === 'fade141') {
		if (stopMode === 'far') return 'Fade141 (SL 200+0.5ATR)'
		return stopMode === 'zoneAtr' ? 'Fade141 (SL 161+0.5ATR)' : 'Fade141 (SL 161)'
	}
	if (scenario === 'fade241') return stopMode === 'zoneAtr' ? 'Fade241 (SL 261+0.5ATR)' : 'Fade241 (SL 261)'
	if (scenario === 'fade241n') return 'Fade241→141/100 (SL 261)'
	if (scenario === 'fade200') return stopMode === 'zoneAtr' ? 'Fade200 (SL 241+0.5ATR)' : 'Fade200 (SL 241)'
	if (scenario === 'fade141c') return 'Fade141 confirm (SL 200+0.5ATR)'
	if (scenario === 'fade241nc') return 'Fade241→141/100 confirm (SL 261+0.5ATR)'
	// Волна 3: вариации breaker.
	if (scenario === 'breaker161') return 'Breaker cancel>161 (SL 0)'
	if (scenario === 'breaker78') return 'Breaker@78.6 (SL 0)'
	if (scenario === 'breaker' && stopMode === 'tight') return 'Breaker (SL 23.6)'
	// Волна 4: добор второй половины.
	if (scenario === 'oteScale') return 'OTE scale 78.6+50 (SL 0)'
	if (scenario === 'deepScale') return 'Deep scale 38.2+23.6 (SL 0)'
	if (scenario === 'breakerScale') return 'Breaker scale 100+78.6 (SL 0)'
	return 'Breaker (SL 0)'
}

function toMarkdown(rows: ResultRow[], minIn: number): string {
	const lines: string[] = []
	lines.push('| Symbol | TF | Var | Per | Anchor | Trig | ATR | Scenario | In | TP1 | TP2 | SL | EV_full | EV_be | EV_fn | EV_bn | L: In/EVf/EVbe | S: In/EVf/EVbe | Swp: In/EVf/EVbe | NoSwp: In/EVf/EVbe |')
	lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	const dir = (s: SliceStats) => `${s.entered}/${fmtEv(s.evFull)}/${fmtEv(s.evBe)}`
	for (const r of rows) {
		if (r.stats.entered < minIn) continue
		lines.push(
			`| ${r.symbol} | ${r.timeframe} | ${r.variant} | ${r.period} | ${r.anchor} | ${r.trigger.toUpperCase()} | ${r.atr} ` +
			`| ${scenarioLabel(r.scenario, r.stopMode)} | ${r.stats.entered} ` +
			`| ${fmtPct(r.stats.tp1Pct)} | ${fmtPct(r.stats.tp2Pct)} | ${fmtPct(r.stats.slPct)} ` +
			`| ${fmtEv(r.stats.evFull)} | ${fmtEv(r.stats.evBe)} ` +
			`| ${fmtEv(r.stats.evFullNet)} | ${fmtEv(r.stats.evBeNet)} ` +
			`| ${dir(r.long)} | ${dir(r.short)} | ${dir(r.sweep)} | ${dir(r.noSweep)} |`,
		)
	}
	return lines.join('\n')
}

function toCsv(rows: ResultRow[]): string {
	// Новые колонки добавляются строго В КОНЕЦ — старые скрипты анализа CSV
	// по позициям не ломаются.
	const header =
		'symbol,timeframe,variant,period,anchor,trigger,atr,scenario,stop_mode,setups,entered,resolved,tp1_pct,tp2_pct,sl_pct,ev_full,ev_be,' +
		'long_in,long_ev_full,long_ev_be,short_in,short_ev_full,short_ev_be,' +
		'sweep_in,sweep_ev_full,sweep_ev_be,nosweep_in,nosweep_ev_full,nosweep_ev_be,' +
		'ev_full_net,ev_be_net,stop_tp_pct,ext141_pct,ext200_pct,ext241_pct,win_mae_med,win_mae_p90'
	const num = (v: number | null) => (v == null ? '' : v.toFixed(4))
	const body = rows.map((r) =>
		[
			r.symbol, r.timeframe, r.variant, r.period, r.anchor, r.trigger, r.atr, r.scenario, r.stopMode,
			r.stats.setups, r.stats.entered, r.stats.resolved,
			num(r.stats.tp1Pct), num(r.stats.tp2Pct), num(r.stats.slPct),
			num(r.stats.evFull), num(r.stats.evBe),
			r.long.entered, num(r.long.evFull), num(r.long.evBe),
			r.short.entered, num(r.short.evFull), num(r.short.evBe),
			r.sweep.entered, num(r.sweep.evFull), num(r.sweep.evBe),
			r.noSweep.entered, num(r.noSweep.evFull), num(r.noSweep.evBe),
			num(r.stats.evFullNet), num(r.stats.evBeNet), num(r.stats.stopTpPct),
			num(r.stats.ext141Pct), num(r.stats.ext200Pct), num(r.stats.ext241Pct),
			num(r.stats.winMaeMed), num(r.stats.winMaeP90),
		].join(','),
	)
	return [header, ...body].join('\n')
}

/** Топ строк по EV_be среди статистически значимых — быстрый взгляд на лидеров. */
function topLines(rows: ResultRow[], minIn: number, n = 10): string {
	const ranked = rows
		.filter((r) => r.stats.entered >= minIn && r.stats.evBe != null)
		.sort((a, b) => (b.stats.evBe ?? 0) - (a.stats.evBe ?? 0))
		.slice(0, n)
	return ranked
		.map((r, i) =>
			`${String(i + 1).padStart(2)}. ${r.symbol} ${r.timeframe} [${r.variant}${r.period === 'full' ? '' : ` ${r.period}`}] ${r.anchor}/${r.trigger.toUpperCase()}` +
			` ATR${r.atr} ${scenarioLabel(r.scenario, r.stopMode)} → EV_be ${fmtEv(r.stats.evBe)}` +
			` (EV_full ${fmtEv(r.stats.evFull)}, In ${r.stats.entered};` +
			` L ${r.long.entered}/${fmtEv(r.long.evBe)}, S ${r.short.entered}/${fmtEv(r.short.evBe)})`,
		)
		.join('\n')
}

function csvValue(value: unknown): string {
	const text = value == null ? '' : String(value)
	return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function recordsToCsv(rows: Record<string, unknown>[]): string {
	if (!rows.length) return ''
	const keys = Object.keys(rows[0]!)
	return [keys.join(','), ...rows.map((row) => keys.map((key) => csvValue(row[key])).join(','))].join('\n')
}

function portfolioReport(result: ReturnType<typeof runPortfolioBacktest>, unresolved: number): string {
	const s = result.summary
	const pct = (n: number) => `${n.toFixed(2)}%`
	const r = (n: number | null) => n == null ? '—' : `${n.toFixed(2)}R`
	const mc = result.monteCarlo
	return [
		'=== Portfolio (canonical combo: regime → cooldown) ===',
		`Equity: ${s.initialEquity.toFixed(2)} → ${s.finalEquity.toFixed(2)} (${pct(s.netReturnPct)})`,
		`Accepted: ${s.accepted}; capacity rejected: ${s.capacityRejected}; unresolved excluded: ${unresolved}`,
		`Total: ${r(s.totalR)}; EV: ${r(s.expectancyR)}; win rate: ${s.winRate == null ? '—' : pct(s.winRate * 100)}; PF: ${s.profitFactor == null ? '—' : s.profitFactor.toFixed(2)}`,
		`Max DD: ${pct(s.maxDrawdownPct)} / ${s.maxDrawdownAmount.toFixed(2)} / ${r(s.maxDrawdownR)}; losing streak: ${s.maxLosingStreak}`,
		`Max concurrent: ${s.maxConcurrent}; max open risk: ${pct(s.maxOpenRiskPct)}; recovery: ${s.recoveryFactor == null ? '—' : s.recoveryFactor.toFixed(2)}`,
		mc ? `Monte Carlo (${mc.runs}, seed ${mc.seed}): return p05/med/p95 ${pct(mc.finalReturnPct.p05)} / ${pct(mc.finalReturnPct.median)} / ${pct(mc.finalReturnPct.p95)}; DD ${pct(mc.maxDrawdownPct.p05)} / ${pct(mc.maxDrawdownPct.median)} / ${pct(mc.maxDrawdownPct.p95)}` : '',
	].filter(Boolean).join('\n')
}

// ---------- Main ----------

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const allRows: ResultRow[] = []
	const allReach: ReachRow[] = []
	const allRegime: RegimeRow[] = []
	const portfolioTrades: PortfolioTrade[] = []
	let portfolioUnresolved = 0
	// Слой SPEC 7.20: сделки, отрезанные --filters, с именем сработавшего
	// фильтра — для отчёта foregone («резали убыток или прибыль»).
	const portfolioFiltered: { trade: PortfolioTrade; filteredBy: SetupFilterName }[] = []
	const filteredGrids = new Set<string>()
	// Пул-оценка (--eval-filters): каждая строка — одна сделка пула × один
	// фильтр, cut = фильтр её срезал бы. Без портфеля: netR как есть.
	const evalFilterRows: { filter: SetupFilterName; symbol: string; timeframe: string; scenario: string; entryAt: number; cut: boolean; netR: number }[] = []
	// Худшая по дата��етам одновременная экспозиция (сделок одной стратегии
	// и направления открыто одновременно) — до дедупа и после каждого правила.
	const dedupExposure = {
		before: 0,
		after: { 'cooldown': 0, 'one-position': 0, 'latest-only': 0 } as Record<string, number>,
	}
	// Волна 4: экспозиция итогового плейбука (regime + cooldown).
	let comboExposure = 0
	const failures: string[] = []

	console.log(`\nBatch: ${args.symbols.join(', ')} × ${args.timeframes.join(', ')} × ${args.limit} candles (${args.market})${args.untilLabel ? ` until ${args.untilLabel}` : ''}`)
	console.log(`ATR thresholds: ${args.atrThresholds.join(', ')}; min In: ${args.minIn}${args.fixture ? '; FIXTURE MODE' : ''}`)
	console.log(`Detector variants: ${args.variants.map((v) => v.id).join(', ')}${args.split > 1 ? `; time split: ${args.split}` : ''}`)
	if (args.portfolio) console.log(`Portfolio scenarios: ${args.portfolioScenarios.join(', ')}`)
	if (args.portfolio && args.setupFilters.length > 0) console.log(`Setup filters (7.20): ${args.setupFilters.join(', ')}`)
	console.log('')

	for (const symbol of args.symbols) {
		for (const timeframe of args.timeframes) {
			const label = `${symbol} ${timeframe}`
			let candles: Candle[]
			try {
				candles = args.fixture
					? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Candle[])
					: await loadCandles(symbol, timeframe, args.limit, args.market, args.cache, args.untilMs, args.untilLabel)
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				failures.push(`${label}: ${message}`)
				console.log(`  ✗ ${label}: ${message}`)
				continue
			}
		if (candles.length === 0) {
			failures.push(`${label}: 0 candles`)
			continue
		}

		// Контроль окна данных: печатаем фактический диапазон, чтобы прогоны
		// с --until нельзя было спутать с текущим ��ериодом (и наоборот).
		{
			const first = new Date(candles[0]!.timestamp).toISOString().slice(0, 10)
			const last = new Date(candles[candles.length - 1]!.timestamp).toISOString().slice(0, 10)
			console.log(`  ${label}: ${candles.length} candles, ${first} → ${last}`)
			if (args.untilMs !== null && candles[candles.length - 1]!.timestamp >= args.untilMs) {
				failures.push(`${label}: data range violates --until (last candle ${last})`)
				console.log(`  ✗ ${label}: last candle ${last} >= --until — окно нарушено, пропускаю`)
				continue
			}
		}

			// Хронологические отрезки: каждый анализируется независимо,
			// «настоящий» edge обязан быть виден в каждом, не только в сумме.
			const chunks: { period: string; candles: Candle[] }[] = []
			if (args.split <= 1) {
				chunks.push({ period: 'full', candles })
			} else {
				const size = Math.floor(candles.length / args.split)
				for (let i = 0; i < args.split; i++) {
					const end = i === args.split - 1 ? candles.length : (i + 1) * size
					chunks.push({ period: `${i + 1}/${args.split}`, candles: candles.slice(i * size, end) })
				}
			}

			for (const { period, candles: chunk } of chunks) {
				for (const variant of args.variants) {
					const vLabel = `${label} [${variant.id}${period === 'full' ? '' : ` ${period}`}]`
					try {
						const started = Date.now()
						const snapshot = runAnalysis(chunk, {
					bosChoch: variant.config,
					lifecycle: {
						entryExpiryBars: args.entryExpiryBars,
						tradeTimeStopBars: args.tradeTimeStopBars,
					},
				})
						// Волна 2 фильтра режима: релейбленные копии прошедших фильтр
						// исходов (oteRegime/deepRegime) подмешиваются к оригиналам —
						// сравнение до/после в одной сводке. Только базовый конфиг.
						let outcomesForSlicing = snapshot.fibLifecycle.outcomes
						if (args.regimeFilter && variant.id === 'base') {
							const metrics = computeRegimeMetrics(
								snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory,
							)
							const passed = snapshot.fibLifecycle.outcomes
								.filter((o) =>
									DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) &&
									o.stopMode === 'zero' &&
									passesRegimeFilter(o.scenario, metrics[o.createdAtIndex]))
								// Релейбл выходит за союз FibScenario намеренно: синтетические
								// имена живут только внутри сводки раннера, не в пайплайне.
								.map((o) => ({ ...o, scenario: `${o.scenario}Regime` }) as unknown as FibSetupOutcome)
								outcomesForSlicing = [...snapshot.fibLifecycle.outcomes, ...passed]
							}
							// Волна 3 (SPEC 7.16): дедуплицированные копии ядра по трём
							// правилам + учёт максимальной одновременной экспозиции.
							if (args.dedup && variant.id === 'base') {
								const core = snapshot.fibLifecycle.outcomes.filter((o) =>
									['ote', 'deep', 'breaker', 'breaker161'].includes(o.scenario) && o.stopMode === 'zero')
								dedupExposure.before = Math.max(dedupExposure.before, maxConcurrentTrades(core))
								const suffix = { 'cooldown': 'DedupCd', 'one-position': 'DedupOp', 'latest-only': 'DedupLo' } as const
								const mixed: FibSetupOutcome[] = []
								for (const rule of DEDUP_RULES) {
									const surviving = applyDedup(core, rule)
									dedupExposure.after[rule] = Math.max(dedupExposure.after[rule] ?? 0, maxConcurrentTrades(surviving))
									mixed.push(...surviving.map((o) =>
										({ ...o, scenario: `${o.scenario}${suffix[rule]}` }) as unknown as FibSetupOutcome))
								}
								outcomesForSlicing = [...outcomesForSlicing, ...mixed]
							}
							// Волна 4 (SPEC 7.17): совместный эффект принятых фильтров.
							// Порядок: сначала regime (отсекаем плохой режим у ote/deep,
							// breaker не трогаем), затем cooldown по выжившим — как вживую:
							// незаторгованный сетап не занимает слот кулдауна.
							if (args.regimeFilter && args.dedup && variant.id === 'base') {
								const metrics = computeRegimeMetrics(
									snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory,
								)
								const regimePassed = snapshot.fibLifecycle.outcomes.filter((o) =>
									['ote', 'deep', 'breaker', 'breaker161'].includes(o.scenario) &&
									o.stopMode === 'zero' &&
									(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) ||
										passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
								const combo = applyDedup(regimePassed, 'cooldown').map((o) =>
									({ ...o, scenario: `${o.scenario}Combo` }) as unknown as FibSetupOutcome)
									comboExposure = Math.max(comboExposure, maxConcurrentTrades(combo))
									outcomesForSlicing = [...outcomesForSlicing, ...combo]
								}
								// Portfolio всегда использует тот же канонический поря��ок: regime → cooldown.
								// Берём только full/base, иначе split/sweep искусственно дублируют сделки.
								// breaker161/breaker200 — альтернативные правила того же сетапа, не
								// независимые сделки: в канонический портфель входит только breaker.
								if (args.portfolio && variant.id === 'base' && period === 'full') {
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const preFilter = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									// Слой SPEC 7.20: до cooldown, чтобы отрезанный сетап не
									// блокировал кулдауном следующий (его не существует для портфеля).
									let eligible = preFilter
									if (args.setupFilters.length > 0) {
										const filterCtx = buildSetupFilterContext(
											snapshot.candles, snapshot.events, snapshot.fib.candidates,
											snapshot.market.trendHistory, metrics)
										eligible = []
										for (const outcome of preFilter) {
											const failed = firstFailingFilter(outcome, args.setupFilters, filterCtx)
											if (failed == null) { eligible.push(outcome); continue }
											// Foregone-учёт: что бы дала отрезанная сделка (для отчёта
											// «резали убыток или прибыль»). Дедуп по gridKey — как в основном
											// пути, но с symbol|tf: filteredGrids общий для всех датасетов,
											// а candidateId уникален только внутри одного symbol × tf.
											if (!outcome.entered) continue
											const gridKey = `${symbol}|${timeframe}|${outcome.scenario}|${outcome.candidateId}`
											if (filteredGrids.has(gridKey)) continue
											filteredGrids.add(gridKey)
											const trade = outcomeToPortfolioTrade(symbol, timeframe, snapshot.candles, outcome)
											if (trade) portfolioFiltered.push({ trade, filteredBy: failed })
										}
									}
									const combo = applyDedup(eligible, 'cooldown')
									// Одна экономическая позиция на сетку: local/global варианты одной
									// сетки и сценария — это один сетап, а не две независимые сделки.
									const takenGrids = new Set<string>()
									for (const outcome of combo) {
										if (!outcome.entered) continue
										const gridKey = `${outcome.scenario}|${outcome.candidateId}`
										if (takenGrids.has(gridKey)) continue
										takenGrids.add(gridKey)
										const trade = outcomeToPortfolioTrade(symbol, timeframe, snapshot.candles, outcome)
										if (trade) portfolioTrades.push(trade)
										else portfolioUnresolved++
									}
								}
								// Пул-оценка фильтров (--eval-filters): БЕЗ портфеля и БЕЗ
								// кулдауна — каждая сделка пула независима, композиционный
								// рандом исключён. Каждый фильтр оценивается на одном и том же
								// пуле: cut/pass — просто разметка, а не изменение состава.
								if (args.evalFilters && variant.id === 'base' && period === 'full') {
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const pool = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									const filterCtx = buildSetupFilterContext(
										snapshot.candles, snapshot.events, snapshot.fib.candidates,
										snapshot.market.trendHistory, metrics)
									const seenGrids = new Set<string>()
									for (const outcome of pool) {
										if (!outcome.entered) continue
										const gridKey = `${outcome.scenario}|${outcome.candidateId}`
										if (seenGrids.has(gridKey)) continue
										seenGrids.add(gridKey)
										const trade = outcomeToPortfolioTrade(symbol, timeframe, snapshot.candles, outcome)
										if (!trade) continue
										for (const name of SETUP_FILTER_NAMES) {
											const cut = firstFailingFilter(outcome, [name], filterCtx) != null
											evalFilterRows.push({ filter: name, symbol, timeframe, scenario: outcome.scenario, entryAt: trade.entryAt, cut, netR: trade.netR })
										}
									}
								}
							// Волна 5 (SPEC 7.19): fade — зеркальная гипотеза. Deep живёт
							// в импульсе, fade должен жить там, где deep запрещён:
							// *Inv — только сетапы, созданные в сжатии/пиле (инверсия
							// фильтра 7.15), *Combo — инверсия + cooldown.
							if (args.fade && variant.id === 'base') {
								const metrics = computeRegimeMetrics(
									snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory,
								)
								const fades = snapshot.fibLifecycle.outcomes.filter((o) =>
									(o.scenario === 'fade141c' && o.stopMode === 'far') ||
									(o.scenario === 'fade241nc' && o.stopMode === 'zoneAtr'))
								// Инверсия: оставляем то, что фильтр deep ЗАБЛОКИРОВАЛ БЫ.
								const inv = fades.filter((o) => !passesRegimeFilter('deep', metrics[o.createdAtIndex]))
								const invLabeled = inv.map((o) =>
									({ ...o, scenario: `${o.scenario}Inv` }) as unknown as FibSetupOutcome)
								const fadeCombo = applyDedup(inv, 'cooldown').map((o) =>
									({ ...o, scenario: `${o.scenario}Combo` }) as unknown as FibSetupOutcome)
								outcomesForSlicing = [...outcomesForSlicing, ...invLabeled, ...fadeCombo]
							}
							allRows.push(...sliceDataset(symbol, timeframe, variant.id, period, outcomesForSlicing, args.atrThresholds))
						allReach.push(...sliceReach(symbol, timeframe, variant.id, period, snapshot.fibLifecycle.reach))
						// Диагностика режима — только на базовом конфиге детектора,
						// чтобы не плодить дубли исходов при --sweep.
						if (args.regimeCsv && variant.id === 'base') {
							allRegime.push(...sliceRegime(symbol, timeframe, period, snapshot))
						}
						console.log(`  ✓ ${vLabel}: ${chunk.length} candles, ${snapshot.fib.candidates.length} candidates (${((Date.now() - started) / 1000).toFixed(1)}s)`)
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err)
						failures.push(`${vLabel}: ${message}`)
						console.log(`  ✗ ${vLabel}: ${message}`)
					}
				}
			}
		}
	}

	if (allRows.length === 0) {
		console.error('\nNo results. All datasets failed:\n' + failures.map((f) => `  - ${f}`).join('\n'))
		process.exit(1)
	}

	// CSV — всегда полный (без фильтра min-in), фильтрация — забота анал��за.
	mkdirSync(RESULTS_DIR, { recursive: true })
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const untilTag = args.untilLabel ? `-until-${args.untilLabel}` : ''
	const csvPath = args.out ?? join(RESULTS_DIR, `batch-${stamp}${untilTag}.csv`)
	writeFileSync(csvPath, toCsv(allRows))
	const reachCsvPath = join(RESULTS_DIR, `reach-${stamp}${untilTag}.csv`)
	if (allReach.length > 0) writeFileSync(reachCsvPath, reachToCsv(allReach))
	const regimeCsvPath = join(RESULTS_DIR, `regime-${stamp}${untilTag}.csv`)
	if (allRegime.length > 0) writeFileSync(regimeCsvPath, regimeToCsv(allRegime))
	let portfolioFiles: string[] = []
	if (args.portfolio) {
		const result = runPortfolioBacktest(portfolioTrades, {
			initialEquity: args.initialEquity, riskPct: args.riskPct, maxRiskPct: args.maxRiskPct,
			mcRuns: args.mcRuns, seed: args.seed,
		})
		const prefix = join(RESULTS_DIR, `portfolio-${stamp}${untilTag}`)
		const ledgerPath = `${prefix}-ledger.csv`, equityPath = `${prefix}-equity.csv`, monthlyPath = `${prefix}-monthly.csv`, breakdownPath = `${prefix}-breakdown.csv`
		// Отрезанные --filters сделки дописываются в ledger со status=filtered:
		// в одном файле видно и портфель, и что именно отрезал каждый фильтр.
		const filteredRows = portfolioFiltered.map(({ trade, filteredBy }) => ({
			...trade, status: 'filtered', equityBefore: '', equityAfter: '', pnl: '', openRiskPct: '', filteredBy,
		}))
		const ledgerRows = [
			...result.ledger.map((r) => ({ ...r, filteredBy: '' })),
			...filteredRows,
		].sort((a, b) => Number(a.entryAt) - Number(b.entryAt))
		writeFileSync(ledgerPath, recordsToCsv(ledgerRows as unknown as Record<string, unknown>[]))
		writeFileSync(equityPath, recordsToCsv(result.equity as unknown as Record<string, unknown>[]))
		writeFileSync(monthlyPath, recordsToCsv(result.monthly as unknown as Record<string, unknown>[]))
		writeFileSync(breakdownPath, recordsToCsv(result.breakdown as unknown as Record<string, unknown>[]))
		portfolioFiles = [ledgerPath, equityPath, monthlyPath, breakdownPath]
		console.log(`\n${portfolioReport(result, portfolioUnresolved)}\n`)
		if (args.setupFilters.length > 0) {
			// Foregone-сводка: суммарный netR отрезанных сделок по фильтрам.
			// Отрицательный foregone = фильтр резал убыток (хорошо).
			console.log('=== Setup filters (SPEC 7.20) ===')
			console.log(`Active: ${args.setupFilters.join(', ')}`)
			for (const name of args.setupFilters) {
				const cut = portfolioFiltered.filter((f) => f.filteredBy === name)
				const foregone = cut.reduce((sum, f) => sum + f.trade.netR, 0)
				console.log(`  ${name.padEnd(8)}: cut ${String(cut.length).padStart(4)} trades, foregone netR ${foregone >= 0 ? '+' : ''}${foregone.toFixed(2)}`)
			}
			console.log('')
		}
	}

	if (args.evalFilters && evalFilterRows.length > 0) {
		// Пул-оценка: сравнение среднего netR срезанных и пропущенных сделок
		// на ОДНОМ пуле. Хороший фильтр: avgR(cut) заметно ниже avgR(pass).
		const evalCsvPath = join(RESULTS_DIR, `evalfilters-${stamp}${untilTag}.csv`)
		writeFileSync(evalCsvPath, recordsToCsv(evalFilterRows as unknown as Record<string, unknown>[]))
		console.log(`\n=== Filter pool evaluation (SPEC 7.20 iter 2, no portfolio) ===\n`)
		const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`
		const scenarios = [...new Set(evalFilterRows.map((r) => r.scenario))].sort()
		for (const name of SETUP_FILTER_NAMES) {
			const rows = evalFilterRows.filter((r) => r.filter === name)
			const cut = rows.filter((r) => r.cut), pass = rows.filter((r) => !r.cut)
			const avg = (xs: typeof rows) => (xs.length === 0 ? 0 : xs.reduce((s, r) => s + r.netR, 0) / xs.length)
			console.log(`${name}: cut ${cut.length} (avgR ${fmt(avg(cut))}), pass ${pass.length} (avgR ${fmt(avg(pass))}), edge ${fmt(avg(pass) - avg(cut))}`)
			for (const sc of scenarios) {
				const sCut = cut.filter((r) => r.scenario === sc), sPass = pass.filter((r) => r.scenario === sc)
				if (sCut.length === 0 && sPass.length === 0) continue
				console.log(`  ${sc.padEnd(8)}: cut ${String(sCut.length).padStart(4)} (avgR ${fmt(avg(sCut))}), pass ${String(sPass.length).padStart(4)} (avgR ${fmt(avg(sPass))})`)
			}
		}
		console.log(`\nEval CSV (${evalFilterRows.length} rows): ${evalCsvPath}`)
	}

	console.log(`\n=== Top by EV_be (In >= ${args.minIn}) ===\n`)
	console.log(topLines(allRows, args.minIn))
	console.log(`\n=== Full table (In >= ${args.minIn}) ===\n`)
	console.log(toMarkdown(allRows, args.minIn))
	if (allReach.length > 0) {
		console.log(`\n=== Reach histogram (куда доходит цена после события, доля кандидатов) ===\n`)
		console.log(reachToMarkdown(allReach))
		console.log(`\n=== Fade-reach (после касания 141/241: → откат до, ↑ продолжение до) ===\n`)
		console.log(fadeReachToMarkdown(allReach))
	}
	console.log(`\nCSV (all ${allRows.length} rows): ${csvPath}`)
	if (allReach.length > 0) console.log(`Reach CSV (${allReach.length} rows): ${reachCsvPath}`)
	if (allRegime.length > 0) console.log(`Regime CSV (${allRegime.length} rows): ${regimeCsvPath}`)
	if (portfolioFiles.length > 0) console.log(`Portfolio CSV:\n${portfolioFiles.map((p) => `  ${p}`).join('\n')}`)
	if (args.dedup) {
		console.log(`\nMax concurrent same-direction trades (worst dataset):`)
		console.log(`  before dedup:  ${dedupExposure.before}`)
		for (const rule of DEDUP_RULES) console.log(`  ${rule.padEnd(13)}: ${dedupExposure.after[rule]}`)
		if (args.regimeFilter) console.log(`  combo (7.17) : ${comboExposure}`)
	}
	if (failures.length > 0) {
		console.log(`\nFailures:\n` + failures.map((f) => `  - ${f}`).join('\n'))
	}
}

main().catch((err) => {
	console.error('Fatal:', err instanceof Error ? err.message : err)
	process.exit(1)
})
