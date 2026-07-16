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
//   --eval-htf    пул-оценка HTF-контекста (SPEC 7.21): разметка того же пула
//                 состоянием старшего ТФ на момент входа — тренд HTF и
//                 premium/discount (dealing range). Пары: 30m→1h+4h, 1h→4h,
//                 4h→1d. HTF агрегируется из LTF-свечей, look-ahead-free
//                 (знание = закрытие подтверждающей HTF-свечи).
//   --eval-takes  пул-оценка лестниц тейков (SPEC 7.22): входы и стопы
//                 канонические, реплеятся только выходы. Лестницы: canon
//                 (50% на 141 + раннер 241), 100+241, 100+141+241,
//                 100+161+241, всё на 100. Один пул для всех лестниц —
//                 чистый эффект менеджмента без композиционного шума.
//   --eval-combo  комбо-оценка (SPEC 7.23): t100-only выходы + фильтры
//                 chop/align на одном пуле. Сравнивает canon, t100-only,
//                 t100+chop, t100+align, t100+chop+align — проверка, что
//                 три подтверждённые находки складываются, а не режут
//                 одни и те же сделки.
//   --eval-entry  пул-оценка моделей входа (SPEC 7.24): косты BingX
//                 (maker 0.02% / taker 0.05%), три модели входа — touch
//                 (лимитка на уровне), closeConfirm (маркет по закрытию
//                 свечи касания), candleConfirm (маркет по закрытию
//                 подтверждающей свечи) + bigbar-фильтр (тело одной свечи
//                 перекрыло входную зону — пропуск). Выходы t100-only.
//                 Статистика упущенных/спасённых с counterfactual.
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
import { fetchCandlesPaginated, aggregateCandles, MAX_CANDLES, TF_MS, type MarketKind } from '../shared/candleFetcher.js'
import { buildHtfContext, htfContextAt } from '../../src/core/analysis/htfContext.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { FibReachRecord, FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'
import { netFullR, netBeR } from '../../src/core/fib/fibCosts.js'
import { computeRegimeMetrics } from '../../src/core/analysis/regimeMetrics.js'
import { passesRegimeFilter, DEFAULT_REGIME_FILTER } from '../../src/core/analysis/regimeFilter.js'
import { applyDedup, maxConcurrentTrades, DEDUP_RULES } from '../../src/core/analysis/dedupFilter.js'
import { outcomeToPortfolioTrade, runPortfolioBacktest, type PortfolioTrade } from '../../src/core/analysis/portfolioBacktest.js'
import { buildSetupFilterContext, firstFailingFilter, SETUP_FILTER_NAMES, type SetupFilterName } from '../../src/core/analysis/setupFilters.js'
import { fillCostR, replayCustomLadder, replayEntryStopTake, replayLadder, replayStopTake, TAKE_LADDERS } from '../../src/core/analysis/takeLadders.js'
import { replayEntryModel, bigbarCovered, BINGX_MAKER_RATE, BINGX_TAKER_RATE, BINGX_SLIP_RATE, type EntryModelId } from '../../src/core/analysis/entryModels.js'

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
	// Dedup соседних уровн��й: выкл / агрессивнее базовых 1.2.
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
	 * По умолчанию полный канон: ote,deep,breaker. Неизвестные им������на — ошибка,
	 * чтобы опечатка не превращалась в молчаливый прогон полного набора.
	 */
	portfolioScenarios: string[]
	/**
	 * Слой диск��ец��онных фильтров (SPEC 7.20): --filters late,align,extreme,chop.
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
	 * не��тличим от перетасовки. Пул-оценка отвечает на единственный честный
	 * вопрос: отличается ли средний netR срезанных сделок от пропущенных.
	 */
	evalFilters: boolean
	/**
	 * Пул-оценка HTF-контекст���� (SPEC 7.21): --eval-htf. Размечает тот же пул
	 * сделок метками старшего ТФ (тренд + premium/discount) без портфельной
	 * симуляции. Пары: 30m → 1h и 4h, 1h → 4h, 4h → 1d. HTF-свечи агрегируются
	 * из уже загруженных LTF — отдельная загрузка не нужна.
	 */
	evalHtf: boolean
	/**
	 * Пул-оценка лестниц тейков (SPEC 7.22): --eval-takes. Входы и стопы
	 * канонические, реплеятся ТОЛЬКО выходы — разные лестницы частичных
	 * фиксаций (canon / 100+241 / 100+141+241 / 100+161+241 / всё на 100)
	 * на одном и том же пуле сделок, без портфельной симуляции.
	 */
	evalTakes: boolean
	/**
	 * Комбинированная пул-оц��нка (SPEC 7.23): --eval-combo. Соединяет три
	 * подтверждённые находки на одном пуле: выходы t100-only (SPEC 7.22) +
	 * фильтры chop и align (SPEC 7.20 iter 2). Каждая сделка размечается
	 * chopCut/alignCut и получает netR для canon- и t100-only-выходов —
	 * сводка сравнивает все комбинации на идентичном составе сделок.
	 */
	evalCombo: boolean
	/**
	 * Пул-оценка моделей входа (SPEC 7.24): --eval-entry. Косты BingX
	 * (maker 0.02% / taker 0.05%), три модели входа (touch / closeConfirm /
	 * candleConfirm), bigbar-фильтр, выходы t100-only. Полная статистика
	 * упущенных/спасённых сделок с counterfactual netR touch-модели.
	 */
	evalEntry: boolean
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
			evalHtf: argv.includes('--eval-htf'),
			evalTakes: argv.includes('--eval-takes'),
			evalCombo: argv.includes('--eval-combo'),
			evalEntry: argv.includes('--eval-entry'),
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
	 * медиана и p90 худшей просад��и в R (maeR отрицателен; −1 = полн��й стоп).
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
	 * если EV пол����жительный только у лонгов — это ставка на бычий режим
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
	// Только ��лейбук (итоги волн 1–4, SPEC 7.10–7.13): ядро ote/deep/breaker
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
	// по позиц��ям не ломаются.
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
	// Пул-оценка HTF (--eval-htf): одна сделка пула × одна пара LTF→HTF.
	// trendAligned/pdAligned = null сериализуются как '' (контекста ещё нет).
	const evalHtfRows: { htf: string; symbol: string; timeframe: string; scenario: string; entryAt: number; direction: string; htfTrend: string; trendAligned: boolean | null; pdZone: string; pdAligned: boolean | null; netR: number }[] = []
	// Пары LTF → старшие ТФ (по выбору пользователя, SPEC 7.21).
	const HTF_PAIRS: Record<string, string[]> = { '30m': ['1h', '4h'], '1h': ['4h'], '4h': ['1d'] }
	// Пул-оценка лестниц тейков (--eval-takes, SPEC 7.22): одна строка =
	// одна сдел��а пула × одна лестница. netR = null (л��стни��а не р����зре��илась
	// до конца данны��) ��сключает сделку из сравнения по ВСЕМ лестницам.
	const evalTakeRows: { ladder: string; symbol: string; timeframe: string; scenario: string; entryAt: number; direction: string; netR: number }[] = []
	// Комбо-оценка (--eval-combo, SPEC 7.23): одна строка = одна сделка пула
	// с метками фильтров и netR обоих вариантов выходов. Комбинации
	// собираются на этапе сводки из одного и того же состава сделок.
	// sameBar = вход и стоп в одной свече (движок консервативно считает
	// мгновенный −1R). Метка диагностическая: исключать такие сделки задним
	// числом — look-ahead (в реале лимитка исполнится и словит стоп), но их
	// доля и суммарный урон говорят, стоит ли переходить на confirmClose-вход.
	const evalComboRows: { symbol: string; timeframe: string; scenario: string; entryAt: number; chopCut: boolean; alignCut: boolean; sameBar: boolean; netRCanon: number; netRT100: number }[] = []
	// Пул-оценка моделей входа (--eval-entry, SPEC 7.24): одна строка =
	// одна сделка пула со статусами/netR всех трёх моделей (косты BingX,
	// выходы t100-only) и меткой bigbar. netR missed-статусов = 0.
	const evalEntryRows: { symbol: string; timeframe: string; scenario: string; entryAt: number; direction: string; bigbar: boolean; chopCut: boolean; alignCut: boolean; dedupCut: boolean; touchStatus: string; touchNetR: number; closeStatus: string; closeNetR: number; confirmStatus: string; confirmNetR: number; exit141R: number | null; exitCanonR: number | null; touchDelayBars: number; tpDistRatio: number | null; fixed1R: number | null; fixed15R: number | null; fixed2R: number | null; fixed3R: number | null; newCanonR: number | null;
		approachAtr: number | null; touchWickFrac: number | null; swingAtr: number | null; reentryR: number | null }[] = []
	// SPEC 7.29: свип стоп×тейк на канон-пуле touch+bigbar. Одна строка =
	// одна сделка, netR по каждой валидной комбинации (ключ "stop|take" в
	// ratio сетки). null = не разрешилась до конца данных; комбинации не на
	// своей стороне от входа отсутствуют в map (для сценария невалидны).
	// v2: стопы 30 и 61.8 — ote-оптимум v1 упёрся в край сетки (стоп 50,
	// тренд ещё рос); тейки 70 и 78.6 — уточнить хребет deep вокруг 61.8.
	// v3: стоп 70 — ote-оптимум v2 СНОВА на краю (61.8, тренд рос 50→61.8);
	// 70 = 8.6% свинга от входа 78.6, ждём слом от костов/шума — надо увидеть
	// обрыв, а не край. Плюс entryAt в строках — разрез H1/H2 по времени.
	const SWEEP_STOPS = [-15, 0, 15, 23.6, 30, 50, 61.8, 70] as const
	const SWEEP_TAKES = [50, 61.8, 70, 78.6, 88.6, 100, 120, 141, 161, 200, 241] as const
	const sweepRows: { symbol: string; timeframe: string; scenario: string; entryAt: number; combos: Map<string, number | null> }[] = []
	// SPEC 7.31: частичные фиксации от новых клеток 7.29 (deep стоп 15,
	// ote стоп 61.8). Схемы с раннером на 141/241 — запрос пользователя
	// «тянуть позицию»; *-full-* — референсы (клетки 7.29 тем же реплеем).
	const PARTIAL_SCHEMES: { id: string; scenario: string; stop: number; steps: { ratio: number; fraction: number }[]; be: boolean }[] = [
		{ id: 'deep-full-61.8 (ref)', scenario: 'deep', stop: 15, steps: [{ ratio: 61.8, fraction: 1 }], be: false },
		{ id: 'deep-50@61.8+50@100 BE', scenario: 'deep', stop: 15, steps: [{ ratio: 61.8, fraction: 0.5 }, { ratio: 100, fraction: 0.5 }], be: true },
		{ id: 'deep-50@61.8+50@100 noBE', scenario: 'deep', stop: 15, steps: [{ ratio: 61.8, fraction: 0.5 }, { ratio: 100, fraction: 0.5 }], be: false },
		{ id: 'deep-50@61.8+50@141 BE', scenario: 'deep', stop: 15, steps: [{ ratio: 61.8, fraction: 0.5 }, { ratio: 141, fraction: 0.5 }], be: true },
		{ id: 'deep-75@61.8+25@241 BE', scenario: 'deep', stop: 15, steps: [{ ratio: 61.8, fraction: 0.75 }, { ratio: 241, fraction: 0.25 }], be: true },
		{ id: 'ote-full-100 (ref)', scenario: 'ote', stop: 61.8, steps: [{ ratio: 100, fraction: 1 }], be: false },
		{ id: 'ote-50@88.6+50@100 BE', scenario: 'ote', stop: 61.8, steps: [{ ratio: 88.6, fraction: 0.5 }, { ratio: 100, fraction: 0.5 }], be: true },
		{ id: 'ote-50@100+50@141 BE', scenario: 'ote', stop: 61.8, steps: [{ ratio: 100, fraction: 0.5 }, { ratio: 141, fraction: 0.5 }], be: true },
		{ id: 'ote-50@100+50@141 noBE', scenario: 'ote', stop: 61.8, steps: [{ ratio: 100, fraction: 0.5 }, { ratio: 141, fraction: 0.5 }], be: false },
		{ id: 'ote-75@100+25@241 BE', scenario: 'ote', stop: 61.8, steps: [{ ratio: 100, fraction: 0.75 }, { ratio: 241, fraction: 0.25 }], be: true },
	]
	const partialRows: { symbol: string; timeframe: string; scenario: string; entryAt: number; results: Map<string, number | null> }[] = []
	// SPEC 7.32: свип уровня входа (вход × стоп × тейк). Universe — ote-сетки
	// канон-пула (78.6 touched + bigbar): deep-сетки — их подмножество.
	// Оговорка: для входов мельче 78.6 (88.6) оценка ПЕССИМИСТИЧНА — сетки,
	// отскочившие от 88.6 без касания 78.6 (чистые победы), вне universe.
	const ENTRY_SWEEP_ENTRIES = [30, 38.2, 50, 61.8, 70.6, 78.6, 88.6] as const
	const ENTRY_SWEEP_STOPS = [-15, 0, 15, 23.6, 38.2, 50, 61.8] as const
	const ENTRY_SWEEP_TAKES = [61.8, 78.6, 88.6, 100, 120, 141] as const
	const entrySweepRows: { symbol: string; timeframe: string; entryAt: number; combos: Map<string, { status: string; netR: number | null }> }[] = []
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
						// исходов (oteRegime/deepRegime) подмешиваются к оригинал��м —
						// сравнение до/после в одной сводке. Только базовый конф��г.
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
							// п��а��илам + учёт максимальной одновременной экспозиции.
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
								// breaker161/breaker200 — альтернативные правила того же ��етапа, не
								// независимые сделки: в канонический портфель входит только breaker.
								if (args.portfolio && variant.id === 'base' && period === 'full') {
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const preFilter = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									// Слой SPEC 7.20: до cooldown, чтобы отрезанный сетап не
									// блокировал кулдауном следующий (его не существует для пор��феля).
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
											// пути, но с symbol|tf: filteredGrids о��щий для всех датасетов,
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
								// Пул-оценка HTF-контекста (SPEC 7.21): тот же пул, что
								// --eval-filters, но метки — состояние старшего ТФ на момент
								// входа (тренд + premium/discount). HTF-свечи агрегируются из
								// LTF-чанка: HTF-состояние строится строго из тех же данных,
								// что видел LTF-прогон, и ни свечой больше.
								if (args.evalHtf && variant.id === 'base' && period === 'full') {
									const htfs = HTF_PAIRS[timeframe] ?? []
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const pool = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									for (const htf of htfs) {
										const htfCandles = aggregateCandles(chunk, timeframe, htf)
										// Слишком мало HTF-свечей = структура не построится,
										// разметка была бы шумом из 'none'.
										if (htfCandles.length < 50) continue
										const htfSnapshot = runAnalysis(htfCandles)
										const htfCtx = buildHtfContext(htfSnapshot, TF_MS[htf]!)
										const seenGrids = new Set<string>()
										for (const outcome of pool) {
											if (!outcome.entered || outcome.entryPrice == null) continue
											const gridKey = `${outcome.scenario}|${outcome.candidateId}`
											if (seenGrids.has(gridKey)) continue
											seenGrids.add(gridKey)
											const trade = outcomeToPortfolioTrade(symbol, timeframe, snapshot.candles, outcome)
											if (!trade) continue
											const labels = htfContextAt(htfCtx, trade.entryAt, outcome.entryPrice, trade.direction)
											evalHtfRows.push({
												htf, symbol, timeframe, scenario: outcome.scenario,
												entryAt: trade.entryAt, direction: trade.direction,
												htfTrend: labels.htfTrend, trendAligned: labels.trendAligned,
												pdZone: labels.pdZone, pdAligned: labels.pdAligned, netR: trade.netR,
											})
										}
									}
								}
								// Пул-оценка лестниц тейков (SPEC 7.22): тот же пул, входы
								// и стопы канонические — реплеятся только выходы. Сделка
								// попадает в сравнение, только если ВСЕ лестницы разрешились
								// (иначе сравнение шло бы на разных пулах).
								if (args.evalTakes && variant.id === 'base' && period === 'full') {
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const pool = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
									const seenGrids = new Set<string>()
									for (const outcome of pool) {
										if (!outcome.entered || outcome.entryIndex == null) continue
										const gridKey = `${outcome.scenario}|${outcome.candidateId}`
										if (seenGrids.has(gridKey)) continue
										seenGrids.add(gridKey)
										const cVariant = candidateById.get(outcome.candidateId)?.variants[outcome.variantMode]
										if (!cVariant) continue
										const levelPrice = (ratio: number): number | null =>
											cVariant.levels.find((l) => l.ratio === ratio)?.price ?? null
										const entryCandle = snapshot.candles[outcome.entryIndex]
										if (!entryCandle) continue
										const results = TAKE_LADDERS.map((ladder) => ({
											ladder: ladder.id,
											netR: replayLadder(snapshot.candles, outcome, levelPrice, ladder),
										}))
										// Пул идентичен по всем лестницам: одна нерешённая — сделка вон.
										if (results.some((r) => r.netR == null)) continue
										for (const r of results) {
											evalTakeRows.push({
												ladder: r.ladder, symbol, timeframe, scenario: outcome.scenario,
												entryAt: entryCandle.timestamp, direction: outcome.direction, netR: r.netR!,
											})
										}
									}
								}
								// Комбо-оценка (SPEC 7.23): t100-only выходы + метки chop/align
								// на одном пуле. Логика пула идентична --eval-takes; сделка
								// включается, только если canon и t100-only оба разрешились.
								if (args.evalCombo && variant.id === 'base' && period === 'full') {
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const pool = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									const filterCtx = buildSetupFilterContext(
										snapshot.candles, snapshot.events, snapshot.fib.candidates,
										snapshot.market.trendHistory, metrics)
									const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
									const canonLadder = TAKE_LADDERS.find((l) => l.id === 'canon')!
									const t100Ladder = TAKE_LADDERS.find((l) => l.id === 't100-only')!
									const seenGrids = new Set<string>()
									for (const outcome of pool) {
										if (!outcome.entered || outcome.entryIndex == null) continue
										const gridKey = `${outcome.scenario}|${outcome.candidateId}`
										if (seenGrids.has(gridKey)) continue
										seenGrids.add(gridKey)
										const cVariant = candidateById.get(outcome.candidateId)?.variants[outcome.variantMode]
										if (!cVariant) continue
										const levelPrice = (ratio: number): number | null =>
											cVariant.levels.find((l) => l.ratio === ratio)?.price ?? null
										const entryCandle = snapshot.candles[outcome.entryIndex]
										if (!entryCandle) continue
										const netRCanon = replayLadder(snapshot.candles, outcome, levelPrice, canonLadder)
										const netRT100 = replayLadder(snapshot.candles, outcome, levelPrice, t100Ladder)
										if (netRCanon == null || netRT100 == null) continue
										evalComboRows.push({
											symbol, timeframe, scenario: outcome.scenario, entryAt: entryCandle.timestamp,
											chopCut: firstFailingFilter(outcome, ['chop'], filterCtx) != null,
											alignCut: firstFailingFilter(outcome, ['align'], filterCtx) != null,
											// Вход и стоп в одном баре: движок ставит stopIndex === entryIndex.
											sameBar: outcome.stopIndex != null && outcome.stopIndex === outcome.entryIndex,
											netRCanon, netRT100,
										})
									}
								}
								// Пул-оценка моделей входа (SPEC 7.24): косты BingX, три модели
								// входа, bigbar-фильтр. Пул тот же, что --eval-takes/--eval-combo.
								// Сделка включается, только если все модели разрешились
								// (missed* — валидное разрешение, unresolved — нет).
								if (args.evalEntry && variant.id === 'base' && period === 'full') {
									const metrics = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
									const pool = snapshot.fibLifecycle.outcomes.filter((o) =>
										args.portfolioScenarios.includes(o.scenario) && o.stopMode === 'zero' &&
										(!DEFAULT_REGIME_FILTER.scenarios.has(o.scenario) || passesRegimeFilter(o.scenario, metrics[o.createdAtIndex])))
									// Метки для финальной комбо-сводки (SPEC 7.25):
									// chop/align — фильтры 7.20; dedup cooldown — 7.16 («одна идея —
									// одна позиция»: серия BOS в одном тренде = один риск, не три).
									const filterCtx = buildSetupFilterContext(
										snapshot.candles, snapshot.events, snapshot.fib.candidates,
										snapshot.market.trendHistory, metrics)
										const dedupSurvivors = new Set(applyDedup(pool, 'cooldown'))
										const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
										// SPEC 7.34: ATR по индексу бара. Точки разрежены — берём
										// последнюю с p.index <= i (точки отсортированы по index).
										const atrAt = (i: number): number | null => {
											let best: number | null = null
											for (const p of snapshot.atr) {
												if (p.index > i) break
												best = p.value
											}
											return best
										}
										// Входные зоны сетки (ratio): ote — 61.8–78.6, deep — 23.6–38.2
										// (пары пользовате��я «78→61», «38→23»).
									const ENTRY_ZONES: Record<string, [number, number]> = { ote: [61.8, 78.6], deep: [23.6, 38.2] }
									const MODELS: EntryModelId[] = ['touch', 'closeConfirm', 'candleConfirm']
									const seenGrids = new Set<string>()
									for (const outcome of pool) {
										if (!outcome.entered || outcome.entryIndex == null) continue
										const gridKey = `${outcome.scenario}|${outcome.candidateId}`
										if (seenGrids.has(gridKey)) continue
										seenGrids.add(gridKey)
										const cVariant = candidateById.get(outcome.candidateId)?.variants[outcome.variantMode]
										if (!cVariant) continue
										const levelPrice = (ratio: number): number | null =>
											cVariant.levels.find((l) => l.ratio === ratio)?.price ?? null
										const tp = levelPrice(100)
										const zone = ENTRY_ZONES[outcome.scenario]
										if (tp == null || zone == null) continue
										const entryCandle = snapshot.candles[outcome.entryIndex]
										if (!entryCandle) continue
										const zoneNearPrice = levelPrice(zone[0])
										const zoneFarPrice = levelPrice(zone[1])
										if (zoneNearPrice == null || zoneFarPrice == null) continue
											const results = MODELS.map((m) => replayEntryModel(snapshot.candles, outcome, tp, m))
											if (results.some((r) => r.status === 'unresolved')) continue
											const [touch, close, confirm] = results
											// SPEC 7.26: схемы выхода на touch-входе, косты BingX
											// (вход/тейк лимиткой maker, стоп/BE рыночный taker+slip).
											// null (не разрешилась до конца данных) исключает сделку
											// из сравнения СХЕМ, но не из сравнения моделей входа.
											const bingxCosts = {
												entryRate: BINGX_MAKER_RATE,
												takeRate: BINGX_MAKER_RATE,
												stopRate: BINGX_TAKER_RATE + BINGX_SLIP_RATE,
											}
											const ladderR = (id: string): number | null => {
												const ladder = TAKE_LADDERS.find((l) => l.id === id)
												if (!ladder) return null
												return replayLadder(snapshot.candles, outcome, levelPrice, ladder, bingxCosts)
											}
											// SPEC 7.28: фиксированный R:R — тейк на k×риск от входа,
											// а не на уровне сетки. Мотивация: sim-тейк ote на 100 —
											// это константа 0.272R (геометрия сетки), а 100/141 —
											// «воздушные» уровни экстремума свинга, где цена
											// разворачивается. Полный выход, без BE. Реплей тот же
											// replayLadder (те же конвенции интрабара и косты BingX).
											const fixedRR = (k: number): number | null => {
												if (outcome.entryPrice == null || outcome.riskSize == null || outcome.riskSize <= 0) return null
												const dir = outcome.direction === 'long' ? 1 : -1
												const tpPrice = outcome.entryPrice + dir * k * outcome.riskSize
												return replayLadder(snapshot.candles, outcome, () => tpPrice,
													{ id: `fixed-${k}`, steps: [{ ratio: 0, fraction: 1 }] }, bingxCosts)
											}
										evalEntryRows.push({
											symbol, timeframe, scenario: outcome.scenario,
											entryAt: entryCandle.timestamp, direction: outcome.direction,
											// +1: свеча касания входит в окно — пользовательский кейс
											// «��дна свеча от 100 до 78» — это чаще всего она сама.
											bigbar: bigbarCovered(snapshot.candles, outcome.createdAtIndex, outcome.entryIndex + 1, zoneNearPrice, zoneFarPrice),
											chopCut: firstFailingFilter(outcome, ['chop'], filterCtx) != null,
											alignCut: firstFailingFilter(outcome, ['align'], filterCtx) != null,
											dedupCut: !dedupSurvivors.has(outcome),
												touchStatus: touch!.status, touchNetR: touch!.netR ?? 0,
												closeStatus: close!.status, closeNetR: close!.netR ?? 0,
												confirmStatus: confirm!.status, confirmNetR: confirm!.netR ?? 0,
													exit141R: ladderR('t141-only'),
													exitCanonR: ladderR('canon'),
													// SPEC 7.27: свежесть касания — баров от создания сетки
													// до касания уровня (entryIndex канона = бар касания).
													touchDelayBars: outcome.entryIndex - outcome.createdAtIndex,
													// SPEC 7.27: близость тейка — |tp − entry| / |entry − stop|.
													// Всё известно на момент выставления лимитки (плановые
													// уровни сетки), заглядывания в будущее нет.
													tpDistRatio: outcome.entryPrice != null && outcome.riskSize != null && outcome.riskSize > 0
														? Math.abs(tp - outcome.entryPrice) / outcome.riskSize
														: null,
													fixed1R: fixedRR(1),
													fixed15R: fixedRR(1.5),
													fixed2R: fixedRR(2),
													fixed3R: fixedRR(3),
													// SPEC 7.33: netR сделки по НОВОМУ канону (клетки 7.29:
													// deep стоп 15 × тейк 61.8, ote стоп 61.8 × тейк 100).
													// Тот же replayStopTake, что в свипе — прогон должен
													// воспроизвести цифры 7.29 (контроль корректности).
													newCanonR: (() => {
														const p0 = levelPrice(0)
														if (p0 == null || outcome.entryPrice == null) return null
														const at = (ratio: number): number => p0 + (ratio / 100) * (tp - p0)
														return outcome.scenario === 'deep'
															? replayStopTake(snapshot.candles, outcome, at(15), at(61.8), bingxCosts)
															: replayStopTake(snapshot.candles, outcome, at(61.8), at(100), bingxCosts)
													})(),
													// SPEC 7.34 идея #2: скорость подхода к зоне. Путь цены
													// за 3 бара ДО касания / ATR — spike (импульс в зону)
													// vs drift (сползание). Всё до бара входа, без будущего.
													approachAtr: (() => {
														const a = atrAt(outcome.entryIndex)
														const c1 = snapshot.candles[outcome.entryIndex - 1]
														const c4 = snapshot.candles[outcome.entryIndex - 4]
														if (a == null || a <= 0 || !c1 || !c4) return null
														return Math.abs(c1.close - c4.close) / a
													})(),
													// SPEC 7.34 идея #2b: доля отвергающего фитиля свечи
													// касания (для long — нижний хвост). Известна на закрытии
													// бара входа; для touch-модели это диагностика пост-факт.
													touchWickFrac: (() => {
														const c = entryCandle
														const range = c.high - c.low
														if (range <= 0) return null
														return outcome.direction === 'long'
															? (Math.min(c.open, c.close) - c.low) / range
															: (c.high - Math.max(c.open, c.close)) / range
													})(),
													// SPEC 7.34 идея #3: высота свинга в ATR на момент
													// создания сетки — ��икро-шум vs гигант.
													swingAtr: (() => {
														const p0 = levelPrice(0)
														const a = atrAt(outcome.createdAtIndex)
														if (p0 == null || a == null || a <= 0) return null
														return Math.abs(tp - p0) / a
													})(),
													// SPEC 7.34 идея #5: реэнтри после стоп-аута новой клетки.
													// Если первый трейд клетки взял стоп — одна повторная
													// попытка: филл при возврате цены к уровню входа (для
													// long: high >= entry после стопа), отмена при уходе за
													// уровень 0 (структура сломана). Конфликты в баре филла —
													// стоп первым (пессимистично, конвенция проекта).
													reentryR: (() => {
														const p0 = levelPrice(0)
														if (p0 == null || outcome.entryPrice == null) return null
														const at = (ratio: number): number => p0 + (ratio / 100) * (tp - p0)
														const stopPrice = outcome.scenario === 'deep' ? at(15) : at(61.8)
														const tpPrice = outcome.scenario === 'deep' ? at(61.8) : at(100)
														const entry = outcome.entryPrice
														const long = outcome.direction === 'long'
														if (long ? stopPrice >= entry : stopPrice <= entry) return null
														const risk = Math.abs(entry - stopPrice)
														if (risk <= 0) return null
														// 1) исход первого трейда: ищем бар стопа.
														let stopIdx = -1
														for (let i = outcome.entryIndex!; i < snapshot.candles.length; i++) {
															const c = snapshot.candles[i]!
															if (long ? c.low <= stopPrice : c.high >= stopPrice) { stopIdx = i; break }
															if (long ? c.high >= tpPrice : c.low <= tpPrice) return null // тейк — реэнтри не нужен
														}
														if (stopIdx < 0) return null
														// 2) ждём возврата к входу; отмена за уровнем 0.
														let fillIdx = -1
														for (let i = stopIdx + 1; i < snapshot.candles.length; i++) {
															const c = snapshot.candles[i]!
															if (long ? c.low <= p0 : c.high >= p0) return null // структура сломана
															if (long ? c.high >= entry : c.low <= entry) { fillIdx = i; break }
														}
														if (fillIdx < 0) return null
														// 3) реплей второй попытки, стоп первым в конфликте.
														let net = -fillCostR(entry, bingxCosts.entryRate, 1, risk)
														for (let i = fillIdx; i < snapshot.candles.length; i++) {
															const c = snapshot.candles[i]!
															if (long ? c.low <= stopPrice : c.high >= stopPrice)
																return net - 1 - fillCostR(stopPrice, bingxCosts.stopRate, 1, risk)
															if (long ? c.high >= tpPrice : c.low <= tpPrice)
																return net + Math.abs(tpPrice - entry) / risk - fillCostR(tpPrice, bingxCosts.takeRate, 1, risk)
														}
														return null
													})(),
												})
											// SPEC 7.29: свип стоп×тейк. Уровни сетки линейны по
											// ratio — произвольный ratio интерполируется через 0/100.
											// Только touch-вход, прошедший bigbar (канон-пул);
											// невалидные для сценария комбинации (стоп/тейк не на
											// своей стороне от entryPrice) replayStopTake вернёт null
											// и они не попадают в map.
											const lastRow = evalEntryRows[evalEntryRows.length - 1]!
											if (lastRow.touchStatus === 'entered' && !lastRow.bigbar) {
												const p0 = levelPrice(0)
												if (p0 != null) {
													const priceAt = (ratio: number): number => p0 + (ratio / 100) * (tp - p0)
													const combos = new Map<string, number | null>()
													for (const sr of SWEEP_STOPS) {
														for (const tr of SWEEP_TAKES) {
															const netR = replayStopTake(snapshot.candles, outcome, priceAt(sr), priceAt(tr), bingxCosts)
															// Невалидная сторона отсеивается внутри replayStopTake
															// возвратом null ДО реплея — но нам надо отличить
															// «невалидно» от «не разрешилось». Проверяем сторону тут.
															const long = outcome.direction === 'long'
															const e = outcome.entryPrice!
															const stopOk = long ? priceAt(sr) < e : priceAt(sr) > e
															const tpOk = long ? priceAt(tr) > e : priceAt(tr) < e
															if (stopOk && tpOk) combos.set(`${sr}|${tr}`, netR)
														}
													}
													sweepRows.push({ symbol, timeframe, scenario: outcome.scenario, entryAt: lastRow.entryAt, combos })
													// SPEC 7.31: частичные лестницы от новых клеток
													// (вход канонический, стоп/тейки — уровни свипа).
													const partialResults = new Map<string, number | null>()
													for (const sch of PARTIAL_SCHEMES) {
														if (sch.scenario !== outcome.scenario) continue
														partialResults.set(sch.id, replayCustomLadder(
															snapshot.candles, outcome, priceAt(sch.stop),
															sch.steps.map((s) => ({ price: priceAt(s.ratio), fraction: s.fraction })),
															sch.be, bingxCosts))
													}
													partialRows.push({ symbol, timeframe, scenario: outcome.scenario, entryAt: lastRow.entryAt, results: partialResults })
													// SPEC 7.32: свип уровня входа. Только ote-сетки
													// (universe: 78.6 touched; deep — подмножество,
													// дубли сеток не нужны). Семантика отмены:
													// - уровни ≥78.6 лежат НА ПУТИ ретрейса к 78.6 —
													//   филл в universe гарантирован, отмена не нужна
													//   (сканируем с создания сетки; отмену от 100 тут
													//   ставить нельзя — на баре создания цена ещё у
													//   экстремума и high >= p100 тривиально);
													// - уровни глубже 78.6: лимитка с бара канонического
													//   касания (цена уже на 78.6), отмена при возврате
													//   в 100 до филла — зеркало missed-tp канона.
													if (outcome.scenario === 'ote') {
														const long = outcome.direction === 'long'
														const noCancel = long ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
														const entryCombos = new Map<string, { status: string; netR: number | null }>()
														for (const el of ENTRY_SWEEP_ENTRIES) {
															const onPath = el >= 78.6
															const fromIndex = onPath ? outcome.createdAtIndex : outcome.entryIndex!
															const cancelPrice = onPath ? noCancel : priceAt(100)
															for (const sr of ENTRY_SWEEP_STOPS) {
																if (sr >= el) continue
																for (const trr of ENTRY_SWEEP_TAKES) {
																	if (trr <= el) continue
																	entryCombos.set(`${el}|${sr}|${trr}`, replayEntryStopTake(
																		snapshot.candles, fromIndex, outcome.direction,
																		priceAt(el), priceAt(sr), priceAt(trr), cancelPrice, bingxCosts))
																}
															}
														}
														entrySweepRows.push({ symbol, timeframe, entryAt: lastRow.entryAt, combos: entryCombos })
													}
												}
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
		// в одном файле видно и портфель, и что и��енно отрезал каждый фильтр.
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

	console.log(`\n=== Top by EV_be (In >= ${args.minIn}) ===\n`)
	console.log(topLines(allRows, args.minIn))
	console.log(`\n=== Full table (In >= ${args.minIn}) ===\n`)
	console.log(toMarkdown(allRows, args.minIn))
	if (allReach.length > 0) {
		console.log(`\n=== Reach histogram (куда доходит цена после события, доля кан��идатов) ===\n`)
		console.log(reachToMarkdown(allReach))
		console.log(`\n=== Fade-reach (после касания 141/241: → отк��т до, ↑ продолжение до) ===\n`)
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

	// Пул-оценка фильтров — ПОСЛЕДНИЙ блок вывода: большие таблицы выше
	// вытесняют его за буфер консоли (см. отчёт пользователя 15.07.2026).
	// Сводка дубл����руется в .txt рядом с CSV — потерять её невозможно.
	if (args.evalFilters && evalFilterRows.length > 0) {
		const evalCsvPath = join(RESULTS_DIR, `evalfilters-${stamp}${untilTag}.csv`)
		writeFileSync(evalCsvPath, recordsToCsv(evalFilterRows as unknown as Record<string, unknown>[]))
		const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`
		const scenarios = [...new Set(evalFilterRows.map((r) => r.scenario))].sort()
		const lines: string[] = ['=== Filter pool evaluation (SPEC 7.20 iter 2, no portfolio) ===', '']
		for (const name of SETUP_FILTER_NAMES) {
			const rows = evalFilterRows.filter((r) => r.filter === name)
			const cut = rows.filter((r) => r.cut), pass = rows.filter((r) => !r.cut)
			const avg = (xs: typeof rows) => (xs.length === 0 ? 0 : xs.reduce((s, r) => s + r.netR, 0) / xs.length)
			lines.push(`${name}: cut ${cut.length} (avgR ${fmt(avg(cut))}), pass ${pass.length} (avgR ${fmt(avg(pass))}), edge ${fmt(avg(pass) - avg(cut))}`)
			for (const sc of scenarios) {
				const sCut = cut.filter((r) => r.scenario === sc), sPass = pass.filter((r) => r.scenario === sc)
				if (sCut.length === 0 && sPass.length === 0) continue
				lines.push(`  ${sc.padEnd(8)}: cut ${String(sCut.length).padStart(4)} (avgR ${fmt(avg(sCut))}), pass ${String(sPass.length).padStart(4)} (avgR ${fmt(avg(sPass))})`)
			}
		}
		const summary = lines.join('\n')
		const evalTxtPath = join(RESULTS_DIR, `evalfilters-${stamp}${untilTag}.txt`)
		writeFileSync(evalTxtPath, summary + '\n')
		console.log(`\n${summary}`)
		console.log(`\nEval CSV (${evalFilterRows.length} rows): ${evalCsvPath}`)
		console.log(`Eval summary TXT: ${evalTxtPath}`)
	}

	// Пул-оценка HTF-контекста (SPEC 7.21) — тоже последним блоком + дубль
	// в txt: большие таблицы выше вытесняют вывод за буфер консоли.
	if (args.evalHtf && evalHtfRows.length > 0) {
		const csvRows = evalHtfRows.map((r) => ({
			...r,
			trendAligned: r.trendAligned == null ? '' : String(r.trendAligned),
			pdAligned: r.pdAligned == null ? '' : String(r.pdAligned),
		}))
		const htfCsvPath = join(RESULTS_DIR, `evalhtf-${stamp}${untilTag}.csv`)
		writeFileSync(htfCsvPath, recordsToCsv(csvRows as unknown as Record<string, unknown>[]))
		const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`
		const avg = (xs: { netR: number }[]) => (xs.length === 0 ? 0 : xs.reduce((s, r) => s + r.netR, 0) / xs.length)
		const lines: string[] = ['=== HTF context pool evaluation (SPEC 7.21, no portfolio) ===', '']
		const pairs = [...new Set(evalHtfRows.map((r) => `${r.timeframe}->${r.htf}`))].sort()
		for (const pair of pairs) {
			const [ltf, htf] = pair.split('->')
			const rows = evalHtfRows.filter((r) => r.timeframe === ltf && r.htf === htf)
			lines.push(`--- ${pair} (${rows.length} trades) ---`)
			const tAligned = rows.filter((r) => r.trendAligned === true)
			const tAgainst = rows.filter((r) => r.trendAligned === false)
			const tNone = rows.filter((r) => r.trendAligned == null)
			lines.push(`trend : aligned ${String(tAligned.length).padStart(5)} (avgR ${fmt(avg(tAligned))}), against ${String(tAgainst.length).padStart(5)} (avgR ${fmt(avg(tAgainst))}), none ${tNone.length} (avgR ${fmt(avg(tNone))}), edge ${fmt(avg(tAligned) - avg(tAgainst))}`)
			const pAligned = rows.filter((r) => r.pdAligned === true)
			const pAgainst = rows.filter((r) => r.pdAligned === false)
			lines.push(`p/d   : aligned ${String(pAligned.length).padStart(5)} (avgR ${fmt(avg(pAligned))}), against ${String(pAgainst.length).padStart(5)} (avgR ${fmt(avg(pAgainst))}), edge ${fmt(avg(pAligned) - avg(pAgainst))}`)
			const both = rows.filter((r) => r.trendAligned === true && r.pdAligned === true)
			const neither = rows.filter((r) => r.trendAligned === false && r.pdAligned === false)
			lines.push(`both  : aligned ${String(both.length).padStart(5)} (avgR ${fmt(avg(both))}), against ${String(neither.length).padStart(5)} (avgR ${fmt(avg(neither))}), edge ${fmt(avg(both) - avg(neither))}`)
			for (const sc of [...new Set(rows.map((r) => r.scenario))].sort()) {
				const s = rows.filter((r) => r.scenario === sc)
				const sa = s.filter((r) => r.trendAligned === true), sg = s.filter((r) => r.trendAligned === false)
				lines.push(`  ${sc.padEnd(8)}: trend aligned ${String(sa.length).padStart(4)} (avgR ${fmt(avg(sa))}) vs against ${String(sg.length).padStart(4)} (avgR ${fmt(avg(sg))})`)
			}
			lines.push('')
		}
		const summary = lines.join('\n')
		const htfTxtPath = join(RESULTS_DIR, `evalhtf-${stamp}${untilTag}.txt`)
		writeFileSync(htfTxtPath, summary + '\n')
		console.log(`\n${summary}`)
		console.log(`HTF eval CSV (${evalHtfRows.length} rows): ${htfCsvPath}`)
		console.log(`HTF eval summary TXT: ${htfTxtPath}`)
	}

	// Пул-оценка лестниц тейков (SPEC 7.22) — последним блоком + дубль в txt
	// (большие таблицы выше вытесняют вывод за буфер консоли). Один и тот же
	// пул сделок для всех лестниц: сравнение — чистый эффект менеджмента.
	if (args.evalTakes && evalTakeRows.length > 0) {
		const takesCsvPath = join(RESULTS_DIR, `evaltakes-${stamp}${untilTag}.csv`)
		writeFileSync(takesCsvPath, recordsToCsv(evalTakeRows as unknown as Record<string, unknown>[]))
		const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`
		const avg = (xs: { netR: number }[]) => (xs.length === 0 ? 0 : xs.reduce((s, r) => s + r.netR, 0) / xs.length)
		const sum = (xs: { netR: number }[]) => xs.reduce((s, r) => s + r.netR, 0)
		const ladderIds = TAKE_LADDERS.map((l) => l.id)
		const scenarios = [...new Set(evalTakeRows.map((r) => r.scenario))].sort()
		const poolSize = evalTakeRows.length / ladderIds.length
		const lines: string[] = [`=== Take ladder pool evaluation (SPEC 7.22, no portfolio, ${poolSize} trades) ===`, '']
		for (const id of ladderIds) {
			const rows = evalTakeRows.filter((r) => r.ladder === id)
			const wins = rows.filter((r) => r.netR > 0)
			lines.push(`${id.padEnd(14)}: totalR ${fmt(sum(rows))}, avgR ${fmt(avg(rows))}, WR ${rows.length ? ((100 * wins.length) / rows.length).toFixed(1) : '0.0'}%`)
			for (const sc of scenarios) {
				const s = rows.filter((r) => r.scenario === sc)
				if (s.length === 0) continue
				lines.push(`  ${sc.padEnd(8)}: ${String(s.length).padStart(5)} trades, totalR ${fmt(sum(s))}, avgR ${fmt(avg(s))}`)
			}
		}
		const summary = lines.join('\n')
		const takesTxtPath = join(RESULTS_DIR, `evaltakes-${stamp}${untilTag}.txt`)
		writeFileSync(takesTxtPath, summary + '\n')
		console.log(`\n${summary}`)
		console.log(`\nTakes eval CSV (${evalTakeRows.length} rows): ${takesCsvPath}`)
		console.log(`Takes eval summary TXT: ${takesTxtPath}`)
	}

	// Комбо-оценка (SPEC 7.23) — последним блоком + дубль в txt. Все
	// комбинации считаются из одного состава сделок: фильтр = подмножество.
	if (args.evalCombo && evalComboRows.length > 0) {
		const comboCsvPath = join(RESULTS_DIR, `evalcombo-${stamp}${untilTag}.csv`)
		writeFileSync(comboCsvPath, recordsToCsv(evalComboRows as unknown as Record<string, unknown>[]))
		const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`
		type ComboRow = (typeof evalComboRows)[number]
		const combos: { name: string; keep: (r: ComboRow) => boolean; exits: 'canon' | 't100' }[] = [
			{ name: 'canon (baseline)', keep: () => true, exits: 'canon' },
			{ name: 't100-only', keep: () => true, exits: 't100' },
			{ name: 't100 + chop', keep: (r) => !r.chopCut, exits: 't100' },
			{ name: 't100 + align', keep: (r) => !r.alignCut, exits: 't100' },
			{ name: 't100 + chop + align', keep: (r) => !r.chopCut && !r.alignCut, exits: 't100' },
		]
		const lines: string[] = [`=== Combo pool evaluation (SPEC 7.23, no portfolio, pool ${evalComboRows.length} trades) ===`, '']
		// Диагности��а same-bar (вход и стоп в одной свече = консервативный −1R).
		// НЕ фильтр: исключение задним числом — look-ahead. Показывает масштаб
		// проблемы и потенциал перехода на confirmClose-вход.
		const sameBarRows = evalComboRows.filter((r) => r.sameBar)
		const sameBarTotal = sameBarRows.reduce((s, r) => s + r.netRT100, 0)
		lines.push(`same-bar entry+stop: ${sameBarRows.length} trades (${((100 * sameBarRows.length) / evalComboRows.length).toFixed(1)}% of pool), totalR ${fmt(sameBarTotal)} (t100 exits)`, '')
		const scenarios = [...new Set(evalComboRows.map((r) => r.scenario))].sort()
		for (const combo of combos) {
			const kept = evalComboRows.filter(combo.keep)
			const netR = (r: ComboRow) => (combo.exits === 'canon' ? r.netRCanon : r.netRT100)
			const total = kept.reduce((s, r) => s + netR(r), 0)
			const wins = kept.filter((r) => netR(r) > 0)
			lines.push(`${combo.name.padEnd(20)}: ${String(kept.length).padStart(5)} trades, totalR ${fmt(total)}, avgR ${fmt(kept.length ? total / kept.length : 0)}, WR ${kept.length ? ((100 * wins.length) / kept.length).toFixed(1) : '0.0'}%`)
			for (const sc of scenarios) {
				const s = kept.filter((r) => r.scenario === sc)
				if (s.length === 0) continue
				const sTotal = s.reduce((sum, r) => sum + netR(r), 0)
				lines.push(`  ${sc.padEnd(8)}: ${String(s.length).padStart(5)} trades, totalR ${fmt(sTotal)}, avgR ${fmt(sTotal / s.length)}`)
			}
		}
		const summary = lines.join('\n')
		const comboTxtPath = join(RESULTS_DIR, `evalcombo-${stamp}${untilTag}.txt`)
		writeFileSync(comboTxtPath, summary + '\n')
		console.log(`\n${summary}`)
		console.log(`\nCombo eval CSV (${evalComboRows.length} rows): ${comboCsvPath}`)
		console.log(`Combo eval summary TXT: ${comboTxtPath}`)
	}

	// Пул-оценка моделей входа (SPEC 7.24) — последним блоком + дубль в txt.
	// Косты BingX (maker 0.02 / taker 0.05), выходы t100-only. Сводка
	// отвечает: сколько упустили (missed-tp), сколько спасли (missed-stop),
	// что дал bigbar — с counterfactual netR touch-модели по каждой группе.
	if (args.evalEntry && evalEntryRows.length > 0) {
		const entryCsvPath = join(RESULTS_DIR, `evalentry-${stamp}${untilTag}.csv`)
		writeFileSync(entryCsvPath, recordsToCsv(evalEntryRows as unknown as Record<string, unknown>[]))
		const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`
		type Row = (typeof evalEntryRows)[number]
		const models: { name: string; status: (r: Row) => string; netR: (r: Row) => number }[] = [
			{ name: 'touch (limit, BingX)', status: (r) => r.touchStatus, netR: (r) => r.touchNetR },
			{ name: 'closeConfirm', status: (r) => r.closeStatus, netR: (r) => r.closeNetR },
			{ name: 'candleConfirm', status: (r) => r.confirmStatus, netR: (r) => r.confirmNetR },
		]
		const lines: string[] = [`=== Entry model pool evaluation (SPEC 7.24, BingX costs, t100 exits, pool ${evalEntryRows.length} trades) ===`, '']
		const scenarios = [...new Set(evalEntryRows.map((r) => r.scenario))].sort()
		for (const bigbarOn of [false, true]) {
			const rows = bigbarOn ? evalEntryRows.filter((r) => !r.bigbar) : evalEntryRows
			lines.push(bigbarOn
				? `--- with bigbar filter (cut ${evalEntryRows.length - rows.length} setups) ---`
				: `--- no bigbar filter ---`)
			for (const m of models) {
				const entered = rows.filter((r) => m.status(r) === 'entered')
				const total = entered.reduce((s, r) => s + m.netR(r), 0)
				const wins = entered.filter((r) => m.netR(r) > 0)
				const missedStop = rows.filter((r) => m.status(r) === 'missed-stop')
				const missedTp = rows.filter((r) => m.status(r) === 'missed-tp')
				const missedExp = rows.filter((r) => m.status(r) === 'missed-expired')
				// Counterfactual: netR touch-модели у пропущенных сделок.
				const cf = (xs: Row[]) => xs.reduce((s, r) => s + r.touchNetR, 0)
				lines.push(`${m.name.padEnd(22)}: entered ${String(entered.length).padStart(5)}, totalR ${fmt(total)}, avgR ${fmt(entered.length ? total / entered.length : 0)}, WR ${entered.length ? ((100 * wins.length) / entered.length).toFixed(1) : '0.0'}%`)
				if (missedStop.length + missedTp.length + missedExp.length > 0) {
					lines.push(`${''.padEnd(22)}  saved-stop ${missedStop.length} (touch cf ${fmt(cf(missedStop))}), missed-tp ${missedTp.length} (touch cf ${fmt(cf(missedTp))}), expired ${missedExp.length} (touch cf ${fmt(cf(missedExp))})`)
				}
				for (const sc of scenarios) {
					const s = entered.filter((r) => r.scenario === sc)
					if (s.length === 0) continue
					const sTotal = s.reduce((sum, r) => sum + m.netR(r), 0)
					lines.push(`  ${sc.padEnd(8)}: ${String(s.length).padStart(5)} entered, totalR ${fmt(sTotal)}, avgR ${fmt(sTotal / s.length)}`)
				}
			}
			lines.push('')
		}
		// Bigbar сам по себе: counterfactual срезанных сетапов (touch netR).
		const cut = evalEntryRows.filter((r) => r.bigbar)
		lines.push(`bigbar cut ${cut.length} setups (${((100 * cut.length) / evalEntryRows.length).toFixed(1)}% of pool), touch counterfactual totalR ${fmt(cut.reduce((s, r) => s + r.touchNetR, 0))} (positive = резал прибыльные)`)
		// Финальная комбо-сводка (SPEC 7.25): складываются ли находки.
		// Все комбинации на touch-модели (лимитка) — победителе базового
		// сравнения. dedup cooldown = «одна идея — одна позиция»: серия BOS
		// в одном тренде считается одним риском — это ближе к торгуемой
		// реальности, чем сырой пул.
		lines.push('', '=== Final combos (touch entries, t100 exits, BingX costs) ===')
		type ERow = (typeof evalEntryRows)[number]
		const finalCombos: { name: string; keep: (r: ERow) => boolean }[] = [
			{ name: 'touch (raw pool)', keep: () => true },
			{ name: '+ bigbar', keep: (r) => !r.bigbar },
			{ name: '+ bigbar + chop', keep: (r) => !r.bigbar && !r.chopCut },
			{ name: '+ bigbar + align', keep: (r) => !r.bigbar && !r.alignCut },
			{ name: '+ bigbar + dedup', keep: (r) => !r.bigbar && !r.dedupCut },
			{ name: '+ bigbar + align + dedup', keep: (r) => !r.bigbar && !r.alignCut && !r.dedupCut },
		]
		for (const combo of finalCombos) {
			const kept = evalEntryRows.filter(combo.keep)
			const total = kept.reduce((s, r) => s + r.touchNetR, 0)
			const wins = kept.filter((r) => r.touchNetR > 0)
			lines.push(`${combo.name.padEnd(26)}: ${String(kept.length).padStart(5)} trades, totalR ${fmt(total)}, avgR ${fmt(kept.length ? total / kept.length : 0)}, WR ${kept.length ? ((100 * wins.length) / kept.length).toFixed(1) : '0.0'}%`)
			for (const sc of scenarios) {
				const s = kept.filter((r) => r.scenario === sc)
				if (s.length === 0) continue
				const sTotal = s.reduce((sum, r) => sum + r.touchNetR, 0)
				lines.push(`  ${sc.padEnd(8)}: ${String(s.length).padStart(5)} trades, totalR ${fmt(sTotal)}, avgR ${fmt(sTotal / s.length)}`)
			}
		}
		// SPEC 7.26: схемы выхода на каноне (touch + bigbar). Сравнение
		// только на сделках, где ВСЕ три схемы разрешились (t100 разрешён
		// по построению пула; t141/canon могли не разрешиться до конц��
		// данных) — иначе схемы сравнивались бы на разных множествах.
		lines.push('', '=== Exit schemes on canon pool (touch + bigbar, BingX costs) ===')
		const exitPool = evalEntryRows.filter((r) => !r.bigbar && r.exit141R != null && r.exitCanonR != null)
		const exitSchemes: { name: string; netR: (r: ERow) => number }[] = [
			{ name: 'full @100 (t100, canon)', netR: (r) => r.touchNetR },
			{ name: 'full @141', netR: (r) => r.exit141R ?? 0 },
			{ name: '50% @141 + 50% @241 (BE)', netR: (r) => r.exitCanonR ?? 0 },
		]
		lines.push(`pool: ${exitPool.length} trades (all three schemes resolved)`)
		for (const scheme of exitSchemes) {
			const total = exitPool.reduce((s, r) => s + scheme.netR(r), 0)
			const wins = exitPool.filter((r) => scheme.netR(r) > 0)
			lines.push(`${scheme.name.padEnd(26)}: totalR ${fmt(total)}, avgR ${fmt(exitPool.length ? total / exitPool.length : 0)}, WR ${exitPool.length ? ((100 * wins.length) / exitPool.length).toFixed(1) : '0.0'}%`)
			for (const sc of scenarios) {
				const s = exitPool.filter((r) => r.scenario === sc)
				if (s.length === 0) continue
				const sTotal = s.reduce((sum, r) => sum + scheme.netR(r), 0)
				lines.push(`  ${sc.padEnd(8)}: ${String(s.length).padStart(5)} trades, totalR ${fmt(sTotal)}, avgR ${fmt(sTotal / s.length)}`)
			}
		}
			// SPEC 7.28: фиксированные R:R против сеточного t100 (запрос
			// пользователя: тейк ote на 100 = 0.272R — «так никто не торгует»;
			// проверяем тейк на k×риск). Пул — только сделки, где ВСЕ схемы
			// разрешились, иначе сравнение на разных множествах.
			lines.push('', '=== Fixed R:R exits vs grid t100 (SPEC 7.28, canon pool: touch + bigbar, BingX costs) ===')
			const fixedPool = evalEntryRows.filter((r) => !r.bigbar &&
				r.fixed1R != null && r.fixed15R != null && r.fixed2R != null && r.fixed3R != null)
			const fixedSchemes: { name: string; netR: (r: ERow) => number }[] = [
				{ name: 'grid t100 (canon)', netR: (r) => r.touchNetR },
				{ name: 'fixed 1:1', netR: (r) => r.fixed1R ?? 0 },
				{ name: 'fixed 1:1.5', netR: (r) => r.fixed15R ?? 0 },
				{ name: 'fixed 1:2', netR: (r) => r.fixed2R ?? 0 },
				{ name: 'fixed 1:3', netR: (r) => r.fixed3R ?? 0 },
			]
			lines.push(`pool: ${fixedPool.length} trades (all fixed schemes resolved)`)
			for (const scheme of fixedSchemes) {
				const total = fixedPool.reduce((s, r) => s + scheme.netR(r), 0)
				const wins = fixedPool.filter((r) => scheme.netR(r) > 0)
				lines.push(`${scheme.name.padEnd(26)}: totalR ${fmt(total)}, avgR ${fmt(fixedPool.length ? total / fixedPool.length : 0)}, WR ${fixedPool.length ? ((100 * wins.length) / fixedPool.length).toFixed(1) : '0.0'}%`)
				for (const sc of scenarios) {
					const s = fixedPool.filter((r) => r.scenario === sc)
					if (s.length === 0) continue
					const sTotal = s.reduce((sum, r) => sum + scheme.netR(r), 0)
					const sWins = s.filter((r) => scheme.netR(r) > 0)
					lines.push(`  ${sc.padEnd(8)}: ${String(s.length).padStart(5)} trades, totalR ${fmt(sTotal)}, avgR ${fmt(sTotal / s.length)}, WR ${((100 * sWins.length) / s.length).toFixed(1)}%`)
				}
			}
			// SPEC 7.29: свип стоп×тейк — карта «где лучшее соотношение».
			// Пул per scenario: сделки, где ВСЕ валидные комбинации сценария
			// разрешились (иначе сравнение на разных множествах). Решение
			// потом принимается по ПЛАТО соседних клеток, не по пику
			// одиночной клетки (свип = data mining, пик = подгонка).
			// v2: колонка group = 'all' | таймфрейм | символ — разрез по активам
			// обязателен д��я проверки робастности плато.
			const sweepCsvRows: string[] = ['scenario,group,stopRatio,takeRatio,n,totalR,avgR,wr']
			for (const scenario of scenarios) {
				const scRows = sweepRows.filter((r) => r.scenario === scenario)
				if (scRows.length === 0) continue
				// Валидные комбинации сценария = ключи первой строки.
				const comboKeys = [...(scRows[0]?.combos.keys() ?? [])]
				const resolved = scRows.filter((r) => comboKeys.every((k) => r.combos.get(k) != null))
				lines.push('', `=== Stop x Take sweep (SPEC 7.29): ${scenario}, canon pool touch+bigbar, full exits, BingX costs ===`)
				lines.push(`pool: ${resolved.length} trades (of ${scRows.length}; all valid combos resolved), cells: avgR (WR%)`)
				const stops = [...new Set(comboKeys.map((k) => k.split('|')[0]))]
				const takes = [...new Set(comboKeys.map((k) => k.split('|')[1]))]
				lines.push(['stop\\take', ...takes].map((s) => String(s).padStart(9)).join(' '))
				for (const sr of stops) {
					const cells = [String(sr).padStart(9)]
					for (const tr of takes) {
						const key = `${sr}|${tr}`
						if (!comboKeys.includes(key)) { cells.push('—'.padStart(9)); continue }
						const vals = resolved.map((r) => r.combos.get(key)!)
						const total = vals.reduce((a, b) => a + b, 0)
						const wr = vals.length ? (100 * vals.filter((v) => v > 0).length) / vals.length : 0
						cells.push(`${(total / (vals.length || 1)).toFixed(3)}(${wr.toFixed(0)})`.padStart(9))
						// CSV: сводка all + per-TF + per-symbol + H1/H2 (первая и
						// вторая половина периода по медиане entryAt) — проверка
						// робастности плато по всем осям, включая время.
						const groups: [string, typeof resolved][] = [['all', resolved]]
						for (const tf of new Set(resolved.map((r) => r.timeframe))) groups.push([tf, resolved.filter((r) => r.timeframe === tf)])
						for (const sym of new Set(resolved.map((r) => r.symbol))) groups.push([sym, resolved.filter((r) => r.symbol === sym)])
						const sortedAt = resolved.map((r) => r.entryAt).sort((a, b) => a - b)
						const midAt = sortedAt[Math.floor(sortedAt.length / 2)] ?? 0
						groups.push(['H1', resolved.filter((r) => r.entryAt < midAt)])
						groups.push(['H2', resolved.filter((r) => r.entryAt >= midAt)])
						for (const [gName, g] of groups) {
							const gv = g.map((r) => r.combos.get(key)!)
							const gt = gv.reduce((a, b) => a + b, 0)
							const gw = gv.length ? (100 * gv.filter((v) => v > 0).length) / gv.length : 0
							sweepCsvRows.push(`${scenario},${gName},${sr},${tr},${gv.length},${gt.toFixed(3)},${(gt / (gv.length || 1)).toFixed(4)},${gw.toFixed(1)}`)
						}
					}
					lines.push(cells.join(' '))
				}
			}
			const sweepCsvPath = join(RESULTS_DIR, `sweep-${stamp}${untilTag}.csv`)
			writeFileSync(sweepCsvPath, sweepCsvRows.join('\n'))
			// SPEC 7.31: частичные фиксации от новых клеток. Пул per scenario:
			// все схемы сценария разрешились. H1/H2 — медиана entryAt пула.
			const partialCsvRows: string[] = ['scheme,scenario,group,n,totalR,avgR,wr']
			lines.push('', '=== Partial exits from 7.29 cells (SPEC 7.31, canon pool touch+bigbar, BingX costs) ===')
			for (const scenario of scenarios) {
				const scRows = partialRows.filter((r) => r.scenario === scenario)
				const ids = PARTIAL_SCHEMES.filter((s) => s.scenario === scenario).map((s) => s.id)
				if (scRows.length === 0 || ids.length === 0) continue
				const resolved = scRows.filter((r) => ids.every((id) => r.results.get(id) != null))
				const sortedAt = resolved.map((r) => r.entryAt).sort((a, b) => a - b)
				const midAt = sortedAt[Math.floor(sortedAt.length / 2)] ?? 0
				lines.push(`--- ${scenario}: ${resolved.length} trades (of ${scRows.length}) ---`)
				for (const id of ids) {
					const stat = (g: typeof resolved): { n: number; total: number; wr: number } => {
						const vals = g.map((r) => r.results.get(id)!)
						const total = vals.reduce((a, b) => a + b, 0)
						return { n: vals.length, total, wr: vals.length ? (100 * vals.filter((v) => v > 0).length) / vals.length : 0 }
					}
					const all = stat(resolved)
					const h1 = stat(resolved.filter((r) => r.entryAt < midAt))
					const h2 = stat(resolved.filter((r) => r.entryAt >= midAt))
					lines.push(`${id.padEnd(28)}: totalR ${fmt(all.total)}, avgR ${fmt(all.n ? all.total / all.n : 0)}, WR ${all.wr.toFixed(1)}% | H1 ${fmt(h1.n ? h1.total / h1.n : 0)} / H2 ${fmt(h2.n ? h2.total / h2.n : 0)}`)
					const groups: [string, typeof resolved][] = [['all', resolved], ['H1', resolved.filter((r) => r.entryAt < midAt)], ['H2', resolved.filter((r) => r.entryAt >= midAt)]]
					for (const tf of new Set(resolved.map((r) => r.timeframe))) groups.push([tf, resolved.filter((r) => r.timeframe === tf)])
					for (const sym of new Set(resolved.map((r) => r.symbol))) groups.push([sym, resolved.filter((r) => r.symbol === sym)])
					for (const [gName, g] of groups) {
						const s = stat(g)
						partialCsvRows.push(`${id},${scenario},${gName},${s.n},${s.total.toFixed(3)},${(s.n ? s.total / s.n : 0).toFixed(4)},${s.wr.toFixed(1)}`)
					}
				}
			}
			writeFileSync(join(RESULTS_DIR, `partials-${stamp}${untilTag}.csv`), partialCsvRows.join('\n'))
			// SPEC 7.32: свип уровня входа. Пулы клеток различаются по
			// построению (филлы разные) — required-all-resolved невозможен;
			// unresolved исключаются per cell. totalR — по universe.
			const entryCsvRows: string[] = ['entry,stop,take,group,n,totalR,avgR,wr']
			lines.push('', '=== Entry level sweep (SPEC 7.32, universe: ote grids touch+bigbar, full exits, BingX costs) ===')
			lines.push(`universe: ${entrySweepRows.length} grids; NOTE: entries shallower than 78.6 are pessimistic (grids bouncing before 78.6 not in universe)`)
			const entrySortedAt = entrySweepRows.map((r) => r.entryAt).sort((a, b) => a - b)
			const entryMidAt = entrySortedAt[Math.floor(entrySortedAt.length / 2)] ?? 0
			const allEntryKeys = [...new Set(entrySweepRows.flatMap((r) => [...r.combos.keys()]))]
			type CellStat = { key: string; n: number; missed: number; total: number; wr: number }
			const cellStats: CellStat[] = []
			for (const key of allEntryKeys) {
				const groups: [string, typeof entrySweepRows][] = [['all', entrySweepRows], ['H1', entrySweepRows.filter((r) => r.entryAt < entryMidAt)], ['H2', entrySweepRows.filter((r) => r.entryAt >= entryMidAt)]]
				for (const tf of new Set(entrySweepRows.map((r) => r.timeframe))) groups.push([tf, entrySweepRows.filter((r) => r.timeframe === tf)])
				for (const sym of new Set(entrySweepRows.map((r) => r.symbol))) groups.push([sym, entrySweepRows.filter((r) => r.symbol === sym)])
				for (const [gName, g] of groups) {
					const cells = g.map((r) => r.combos.get(key)).filter((c): c is { status: string; netR: number | null } => c != null)
					const entered = cells.filter((c) => c.status === 'entered' && c.netR != null)
					const missed = cells.filter((c) => c.status === 'missed').length
					const total = entered.reduce((a, c) => a + c.netR!, 0)
					const wr = entered.length ? (100 * entered.filter((c) => c.netR! > 0).length) / entered.length : 0
					const [el, sr, trr] = key.split('|')
					entryCsvRows.push(`${el},${sr},${trr},${gName},${entered.length},${total.toFixed(3)},${(entered.length ? total / entered.length : 0).toFixed(4)},${wr.toFixed(1)}`)
					if (gName === 'all') cellStats.push({ key, n: entered.length, missed, total, wr })
				}
			}
			writeFileSync(join(RESULTS_DIR, `entrysweep-${stamp}${untilTag}.csv`), entryCsvRows.join('\n'))
			// txt: филл-статистика по уровням входа + топ-10 клеток по totalR.
			for (const el of ENTRY_SWEEP_ENTRIES) {
				const anyKey = cellStats.find((c) => c.key.startsWith(`${el}|`))
				if (anyKey) lines.push(`entry ${String(el).padEnd(5)}: fills ${anyKey.n}, missed ${anyKey.missed}`)
			}
			lines.push('top cells by totalR (entry|stop|take):')
			for (const c of [...cellStats].sort((a, b) => b.total - a.total).slice(0, 10)) {
				lines.push(`  ${c.key.padEnd(16)}: n ${String(c.n).padStart(5)}, totalR ${fmt(c.total)}, avgR ${fmt(c.n ? c.total / c.n : 0)}, WR ${c.wr.toFixed(1)}%`)
			}
			// SPEC 7.27: идеи фильтров «свежесть касания» и «близость тейка».
			// Только диагностика (бакеты на каноне touch + bigbar, netR t100):
			// сначала смотрим, есть ли монотон��ая зависимость avgR от параметра,
			// порог вводим отдельным решением — защита от подгонки.
			const canonPool = evalEntryRows.filter((r) => !r.bigbar)
			const bucketReport = (
				title: string,
				buckets: { label: string; match: (r: ERow) => boolean }[],
			) => {
				lines.push('', title)
				for (const b of buckets) {
					const g = canonPool.filter(b.match)
					if (g.length === 0) { lines.push(`${b.label.padEnd(14)}: 0 trades`); continue }
					const total = g.reduce((s, r) => s + r.touchNetR, 0)
					const wins = g.filter((r) => r.touchNetR > 0)
					const parts = [`${b.label.padEnd(14)}: ${String(g.length).padStart(5)} trades, totalR ${fmt(total)}, avgR ${fmt(total / g.length)}, WR ${((100 * wins.length) / g.length).toFixed(1)}%`]
					for (const sc of scenarios) {
						const s = g.filter((r) => r.scenario === sc)
						if (s.length === 0) continue
						const sTotal = s.reduce((sum, r) => sum + r.touchNetR, 0)
						parts.push(`  [${sc} ${s.length}: avgR ${fmt(sTotal / s.length)}]`)
					}
					lines.push(parts.join(''))
				}
			}
			bucketReport('=== Touch freshness (SPEC 7.27): bars from grid creation to zone touch (canon pool: touch + bigbar) ===', [
				{ label: '0-1 bars', match: (r) => r.touchDelayBars <= 1 },
				{ label: '2-3 bars', match: (r) => r.touchDelayBars >= 2 && r.touchDelayBars <= 3 },
				{ label: '4-7 bars', match: (r) => r.touchDelayBars >= 4 && r.touchDelayBars <= 7 },
				{ label: '8-15 bars', match: (r) => r.touchDelayBars >= 8 && r.touchDelayBars <= 15 },
				{ label: '16-31 bars', match: (r) => r.touchDelayBars >= 16 && r.touchDelayBars <= 31 },
				{ label: '32+ bars', match: (r) => r.touchDelayBars >= 32 },
			])
			bucketReport('=== Take proximity (SPEC 7.27): |tp-entry| / |entry-stop| at limit placement (canon pool: touch + bigbar) ===', [
				{ label: '< 0.50', match: (r) => r.tpDistRatio != null && r.tpDistRatio < 0.5 },
				{ label: '0.50-0.75', match: (r) => r.tpDistRatio != null && r.tpDistRatio >= 0.5 && r.tpDistRatio < 0.75 },
				{ label: '0.75-1.00', match: (r) => r.tpDistRatio != null && r.tpDistRatio >= 0.75 && r.tpDistRatio < 1.0 },
				{ label: '1.00-1.50', match: (r) => r.tpDistRatio != null && r.tpDistRatio >= 1.0 && r.tpDistRatio < 1.5 },
				{ label: '1.50-2.50', match: (r) => r.tpDistRatio != null && r.tpDistRatio >= 1.5 && r.tpDistRatio < 2.5 },
				{ label: '2.50+', match: (r) => r.tpDistRatio != null && r.tpDistRatio >= 2.5 },
			])
			// SPEC 7.33: новый канон per-trade + сайзинг по свежести + сессии.
			const ncPool = evalEntryRows.filter((r) => r.touchStatus === 'entered' && !r.bigbar && r.newCanonR != null)
			const ncStat = (g: typeof ncPool): { n: number; total: number; wr: number } => {
				const vals = g.map((r) => r.newCanonR!)
				const total = vals.reduce((a, b) => a + b, 0)
				return { n: g.length, total, wr: g.length ? (100 * vals.filter((v) => v > 0).length) / g.length : 0 }
			}
			lines.push('', '=== New canon per-trade check (SPEC 7.33: deep 15x61.8, ote 61.8x100) — must match 7.29 ===')
			for (const sc of scenarios) {
				const s = ncStat(ncPool.filter((r) => r.scenario === sc))
				lines.push(`${sc.padEnd(6)}: ${s.n} trades, totalR ${fmt(s.total)}, avgR ${fmt(s.n ? s.total / s.n : 0)}, WR ${s.wr.toFixed(1)}%`)
			}
			// Сайзинг по свежести: риск-множитель по touchDelayBars. Метрики:
			// totalR (взвеш.) и R НА ЕДИНИЦУ РИСКА = sum(m*r)/sum(m) — главная:
			// показывает качество аллокации, а не просто рост общего риска.
			lines.push('', '=== Freshness sizing simulation (SPEC 7.33, newCanonR, canon pool) ===')
			const sizingVariants: { name: string; mult: (d: number) => number }[] = [
				{ name: 'flat 1.0 (baseline)', mult: () => 1 },
				{ name: 'mild 1.5/1.0/0.7', mult: (d) => (d <= 3 ? 1.5 : d <= 15 ? 1.0 : 0.7) },
				{ name: 'strong 2.0/1.0/0.5', mult: (d) => (d <= 3 ? 2.0 : d <= 15 ? 1.0 : 0.5) },
			]
			for (const v of sizingVariants) {
				let total = 0
				let riskSum = 0
				for (const r of ncPool) {
					const m = v.mult(r.touchDelayBars)
					total += m * r.newCanonR!
					riskSum += m
				}
				lines.push(`${v.name.padEnd(22)}: totalR ${fmt(total)}, risk units ${riskSum.toFixed(0)}, R/unit ${fmt(riskSum ? total / riskSum : 0)}`)
			}
			// Сессионные окна: бакеты по часу суток UTC на newCanonR.
			// Только диагностика — фильтр вводим лишь при стабильно
			// убыточном окне (проверka H1/H2 обязательна перед решением).
			lines.push('', '=== Session windows (SPEC 7.33, newCanonR, canon pool, UTC) ===')
			const hourOf = (r: (typeof ncPool)[number]): number => new Date(r.entryAt).getUTCHours()
			lines.push('-- 3h blocks --')
			for (let h = 0; h < 24; h += 3) {
				const g = ncPool.filter((r) => hourOf(r) >= h && hourOf(r) < h + 3)
				const s = ncStat(g)
				lines.push(`${String(h).padStart(2, '0')}-${String(h + 2).padStart(2, '0')}h: ${String(s.n).padStart(5)} trades, totalR ${fmt(s.total)}, avgR ${fmt(s.n ? s.total / s.n : 0)}, WR ${s.wr.toFixed(1)}%`)
			}
			lines.push('-- funding-relative (hours since last 00/08/16 UTC funding) --')
			for (const [label, match] of [
				['0-1h after', (h: number) => h % 8 <= 1],
				['2-4h after', (h: number) => h % 8 >= 2 && h % 8 <= 4],
				['5-7h after', (h: number) => h % 8 >= 5],
			] as const) {
				const g = ncPool.filter((r) => match(hourOf(r)))
				const s = ncStat(g)
				lines.push(`${label.padEnd(11)}: ${String(s.n).padStart(5)} trades, totalR ${fmt(s.total)}, avgR ${fmt(s.n ? s.total / s.n : 0)}, WR ${s.wr.toFixed(1)}%`)
			}
			// SPEC 7.34, идеи #2/#3: квартильные бакеты newCanonR по фичам,
			// известным на входе. Квартили per scenario (масштабы deep/ote
			// различаются). Решение по каждой фиче — только при монотонном
			// градиенте на обеих половинах периода (как freshness в 7.27).
			lines.push('', '=== Feature buckets on newCanonR (SPEC 7.34, canon pool, quartiles per scenario) ===')
			const features: { name: string; get: (r: (typeof ncPool)[number]) => number | null }[] = [
				{ name: 'approachAtr (3-bar path to zone / ATR)', get: (r) => r.approachAtr },
				{ name: 'touchWickFrac (rejection wick share)', get: (r) => r.touchWickFrac },
				{ name: 'swingAtr (swing height / ATR)', get: (r) => r.swingAtr },
			]
			for (const sc of scenarios) {
				const scPool = ncPool.filter((r) => r.scenario === sc)
				if (scPool.length === 0) continue
				lines.push(`--- ${sc} (${scPool.length} trades) ---`)
				for (const f of features) {
					const withVal = scPool.filter((r) => f.get(r) != null)
					if (withVal.length < 20) { lines.push(`${f.name}: too few values (${withVal.length})`); continue }
					const sorted = withVal.map((r) => f.get(r)!).sort((a, b) => a - b)
					const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
					const edges = [q(0.25), q(0.5), q(0.75)]
					lines.push(`${f.name} [q25 ${edges[0]!.toFixed(2)} | q50 ${edges[1]!.toFixed(2)} | q75 ${edges[2]!.toFixed(2)}]:`)
					const sortedAt = withVal.map((r) => r.entryAt).sort((a, b) => a - b)
					const midAt = sortedAt[Math.floor(sortedAt.length / 2)] ?? 0
					for (let b = 0; b < 4; b++) {
						const lo = b === 0 ? Number.NEGATIVE_INFINITY : edges[b - 1]!
						const hi = b === 3 ? Number.POSITIVE_INFINITY : edges[b]!
						const g = withVal.filter((r) => { const v = f.get(r)!; return v >= lo && v < hi })
						const s = ncStat(g)
						const gh1 = ncStat(g.filter((r) => r.entryAt < midAt))
						const gh2 = ncStat(g.filter((r) => r.entryAt >= midAt))
						lines.push(`  Q${b + 1}: ${String(s.n).padStart(5)} trades, avgR ${fmt(s.n ? s.total / s.n : 0)}, WR ${s.wr.toFixed(1)}% | H1 ${fmt(gh1.n ? gh1.total / gh1.n : 0)} / H2 ${fmt(gh2.n ? gh2.total / gh2.n : 0)}`)
					}
				}
			}
			// SPEC 7.34, идея #5: реэнтри после стоп-аута новой клетки.
			// reentryR != null — вторая попытка состоялась и разрешилась.
			// Система = канон + реэнтри: totalR добавкой (риск-юнит тот же).
			lines.push('', '=== Re-entry after stop-out (SPEC 7.34, new canon cells) ===')
			for (const sc of scenarios) {
				const scPool = ncPool.filter((r) => r.scenario === sc)
				const stopped = scPool.filter((r) => r.newCanonR! < 0)
				const reentered = scPool.filter((r) => r.reentryR != null)
				const reTotal = reentered.reduce((a, r) => a + r.reentryR!, 0)
				const reWr = reentered.length ? (100 * reentered.filter((r) => r.reentryR! > 0).length) / reentered.length : 0
				const baseTotal = scPool.reduce((a, r) => a + r.newCanonR!, 0)
				const sortedAt = scPool.map((r) => r.entryAt).sort((a, b) => a - b)
				const midAt = sortedAt[Math.floor(sortedAt.length / 2)] ?? 0
				const reH1 = reentered.filter((r) => r.entryAt < midAt)
				const reH2 = reentered.filter((r) => r.entryAt >= midAt)
				const avgH = (g: typeof reentered): number => (g.length ? g.reduce((a, r) => a + r.reentryR!, 0) / g.length : 0)
				lines.push(`${sc.padEnd(6)}: stopped ${stopped.length}, re-entered ${reentered.length}, re avgR ${fmt(reentered.length ? reTotal / reentered.length : 0)}, re WR ${reWr.toFixed(1)}% | H1 ${fmt(avgH(reH1))} / H2 ${fmt(avgH(reH2))}`)
				lines.push(`       system: canon ${fmt(baseTotal)} -> canon+reentry ${fmt(baseTotal + reTotal)} (${fmt(reTotal)})`)
			}
			// SPEC 7.35: комбинированный сайзинг-стек. Два вопроса:
			// (1) независимы ли слои (freshness × swingAtr) — кросс-матрица
			//     2×2: если градиент по каждой оси сохраняется внутри строк
			//     и столбцов, фичи несут разную информацию;
			// (2) складываются ли слои в стек — R/unit комбинаций против
			//     одиночных слоёв. Пороги swingAtr — медиана per scenario
			//     (в бою вычислима онлайн по прошлым сеткам, не заглядывание:
			//     здесь оценка сверху, боевая версия — скользящая медиана).
			lines.push('', '=== Sizing stack: layer independence + combined simulation (SPEC 7.35) ===')
			const swingMedianBySc = new Map<string, number>()
			for (const sc of scenarios) {
				const vals = ncPool.filter((r) => r.scenario === sc && r.swingAtr != null).map((r) => r.swingAtr!).sort((a, b) => a - b)
				if (vals.length > 0) swingMedianBySc.set(sc, vals[Math.floor(vals.length / 2)]!)
			}
			const isFresh = (r: (typeof ncPool)[number]): boolean => r.touchDelayBars <= 3
			const isCompact = (r: (typeof ncPool)[number]): boolean | null => {
				const med = swingMedianBySc.get(r.scenario)
				return r.swingAtr == null || med == null ? null : r.swingAtr <= med
			}
			const isUsSession = (r: (typeof ncPool)[number]): boolean => {
				const h = new Date(r.entryAt).getUTCHours()
				return h >= 15 && h < 20
			}
			// (1) кросс-матрица freshness × swingAtr per scenario, с H1/H2.
			const xPool = ncPool.filter((r) => isCompact(r) != null)
			for (const sc of scenarios) {
				const scPool = xPool.filter((r) => r.scenario === sc)
				if (scPool.length === 0) continue
				const sortedAt = scPool.map((r) => r.entryAt).sort((a, b) => a - b)
				const midAt = sortedAt[Math.floor(sortedAt.length / 2)] ?? 0
				lines.push(`-- ${sc}: freshness x swing cross-matrix (median swingAtr ${swingMedianBySc.get(sc)?.toFixed(2)}) --`)
				for (const [fLabel, fMatch] of [['fresh(<=3)', true], ['stale(>3) ', false]] as const) {
					for (const [cLabel, cMatch] of [['compact', true], ['wide   ', false]] as const) {
						const g = scPool.filter((r) => isFresh(r) === fMatch && isCompact(r) === cMatch)
						const s = ncStat(g)
						const h1 = ncStat(g.filter((r) => r.entryAt < midAt))
						const h2 = ncStat(g.filter((r) => r.entryAt >= midAt))
						lines.push(`  ${fLabel} x ${cLabel}: ${String(s.n).padStart(5)} trades, avgR ${fmt(s.n ? s.total / s.n : 0)}, WR ${s.wr.toFixed(1)}% | H1 ${fmt(h1.n ? h1.total / h1.n : 0)} / H2 ${fmt(h2.n ? h2.total / h2.n : 0)}`)
					}
				}
			}
			// (2) симуляция стеков: R/unit = sum(m·r)/sum(m); нормировка на
			// риск-бюджет неявная (метрика инвариантна к масштабу множителей).
			const freshMult = (r: (typeof xPool)[number]): number => (r.touchDelayBars <= 3 ? 2.0 : r.touchDelayBars <= 15 ? 1.0 : 0.5)
			const swingMult = (r: (typeof xPool)[number]): number => (isCompact(r) ? 1.4 : 0.7)
			const sessMult = (r: (typeof xPool)[number]): number => (isUsSession(r) ? 1.2 : 1.0)
			const stacks: { name: string; mult: (r: (typeof xPool)[number]) => number }[] = [
				{ name: 'flat (baseline)', mult: () => 1 },
				{ name: 'freshness only', mult: freshMult },
				{ name: 'swing only', mult: swingMult },
				{ name: 'session only', mult: sessMult },
				{ name: 'fresh x swing', mult: (r) => freshMult(r) * swingMult(r) },
				{ name: 'fresh x swing x sess', mult: (r) => freshMult(r) * swingMult(r) * sessMult(r) },
			]
			lines.push('-- stack simulation (pool with swingAtr, R per risk unit) --')
			const sortedAtAll = xPool.map((r) => r.entryAt).sort((a, b) => a - b)
			const midAtAll = sortedAtAll[Math.floor(sortedAtAll.length / 2)] ?? 0
			for (const st of stacks) {
				const calc = (g: typeof xPool): number => {
					let total = 0
					let riskSum = 0
					for (const r of g) { const m = st.mult(r); total += m * r.newCanonR!; riskSum += m }
					return riskSum ? total / riskSum : 0
				}
				lines.push(`${st.name.padEnd(21)}: R/unit ${fmt(calc(xPool))} | H1 ${fmt(calc(xPool.filter((r) => r.entryAt < midAtAll)))} / H2 ${fmt(calc(xPool.filter((r) => r.entryAt >= midAtAll)))}`)
			}
			const summary = lines.join('\n')
			const entryTxtPath = join(RESULTS_DIR, `evalentry-${stamp}${untilTag}.txt`)
		writeFileSync(entryTxtPath, summary + '\n')
		console.log(`\n${summary}`)
		console.log(`\nEntry eval CSV (${evalEntryRows.length} rows): ${entryCsvPath}`)
		console.log(`Entry eval summary TXT: ${entryTxtPath}`)
	}
}

main().catch((err) => {
	console.error('Fatal:', err instanceof Error ? err.message : err)
	process.exit(1)
})
