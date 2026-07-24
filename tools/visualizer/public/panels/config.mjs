// panels/config.mjs — панель «Настройки движков»: правки констант LIQUIDITY_POI_CONFIG и
// heatmap-конфига БЕЗ пересборки — сервер принимает переопределения (poiConfig/hmConfig)
// и прогоняет движки с ними. Изменённые значения хранятся в localStorage и подсвечиваются;
// «Пересчитать» перезагружает данные, «Сбросить» возвращает дефолты движков.

import { $, esc } from '../lib/format.mjs'

const KEY = 'smc-engine-config-v1'
const PRESETS_KEY = 'smc-viz-presets-v1'

/** Подписи и подсказки (термин — в скобках пояснение). */
const POI_FIELDS = {
	stackGapAtr: ['Склейка супер-цепи, ATR', 'Пул приклеивается к цепи при разрыве полос ≤ этой доли ATR'],
	shelfProfileBinPct: ['Корзина профиля, доля цены', 'Лог-шаг корзин notional-профиля полки (0.004 = 0.4%)'],
	shelfValleyShare: ['Порог провала, × пика', 'ВЫШЕ — полки режутся чаще (мельче зоны), НИЖЕ — крупнее зоны'],
	shelfValleyMinBins: ['Ширина провала, корзин', 'БОЛЬШЕ — режем реже (крупнее зоны), МЕНЬШЕ — чаще'],
	stackMaxPct: ['Потолок высоты, доля цены', 'Максимальная высота зоны от ближнего края полки (0.08 = 8%)'],
	shelfTopN: ['Топ-N полок стороны', 'Зону рождают только N сильнейших полок стороны'],
	shelfFreshBars: ['Свежесть полки, баров', 'МЕНЬШЕ — зоны раньше «устаревают», БОЛЬШЕ — старые полки живут дольше. «Зона устарела, а полка актуальна» — крути это'],
	shelfMinShare: ['Мин. доля стороны', 'Полка рождает зону при notional ≥ этой доли свежей суммы стороны'],
	shelfNoveltyShare: ['Порог перерождения', 'Полка рождает зону заново при ≥ этой доле нового notional (re-accumulation)'],
	stackKinshipShare: ['Родство стеков', 'Общий notional ≥ этой доли меньшего стека — один объект (близнецы/поколения)'],
	nearTolAtr: ['Допуск near-фитиля, ATR', 'Near = wick невыметенного экстремума в пределах этой доли ATR от края полки'],
	stackConsumedShare: ['Снятие стека, доля', 'Зона отработана, когда снято ≥ этой доли notional полки'],
	dupNearAtr: ['Near-дубль, ATR', 'Зоны одной стороны с near ближе этой доли ATR — дубль'],
	dupOverlapShare: ['Дубль по перекрытию', 'Перекрытие ≥ этой доли меньшей зоны — дубль (при сопоставимой высоте)'],
	dupMaxHeightRatio: ['Гард высоты дубля', 'Перекрытие — дубль только при высоте младшей ≤ × старшей'],
	shelfIdentityShare: ['Идентичность эмиссии', 'Полка считается той же между барами при перекрытии ≥ этой доли'],
	atrPeriod: ['Период ATR', 'Стандартная детекторная константа'],
}
const CONF_FIELDS = {
	attemptIdleBars: ['Смерть по бездействию, баров', 'Столько 15m-баров без структурных событий — попытка умирает (timeout@…). Больше — попытки живут дольше'],
	entryMaxRiskAtr: ['Гард входа, ATR', 'Риск вход→стоп больше этого — вход пропускается. Больше — больше входов, но дальше от стопа'],
	weaknessFailLimit: ['Провалов теста подряд', 'Столько подряд возобновлений БЕЗ объёма — попытка отбраковывается (weakness-failed)'],
	stopQuietBars: ['Проторговка у лоя, баров', 'Тишина у экстремума до остановки. Больше — строже (меньше попыток, качественнее)'],
	reboundMinBars: ['Отскок, баров', 'Минимум баров от остановки до отскока'],
	reboundAtr: ['Мин. отход отскока, ATR', 'Нижняя планка расстояния отскока'],
	rearmAtr: ['Перевзвод касания, ATR', 'Полный отход от зоны, после которого следующее касание = новая попытка'],
	failedProtectionCloses: ['Закрытий за якорем', 'Столько close за якорем подряд — перенос якоря (за far — пробой)'],
	stopLookbehindAtr: ['Стоп за историей, ATR', 'Исторический экстремум глубже свипа в этих пределах — стоп за ним'],
	stopBufferAtr: ['Запас стопа, ATR', 'Отступ стопа за экстремум свипа'],
	tpR: ['Тейк, R', 'Диагностический полный тейк'],
	arrivalVolumeSma: ['SMA объёма прихода', 'Окно средней для пометки «пришли на объёме» (не фильтр)'],
	impulseBars: ['Окно импульса, баров 4h', 'Каузальный ход за столько ЗАКРЫТЫХ баров ТФ зоны на входе — для пометки «против импульса» (пометка, НЕ фильтр)'],
	impulseGatePct: ['Порог импульса, доля', 'Ход против сделки сильнее этой доли (0.10 = 10%) — пометка «против импульса». Такие входы исторически стопятся чаще'],
}
const HM_FIELDS = {
	binPct: ['Бин, доля цены', 'Ширина логарифмического ценового бина heatmap'],
	minRelVolume: ['Порог объёма, ×SMA', 'Ликвидность рождают свечи с объёмом выше этой доли средней'],
	minLifetimeBars: ['Мин. жизнь снятых, баров', 'Снесённые сегменты короче — шум, отбрасываются'],
	minContributions: ['Мин. вкладов', 'Минимальное число вкладов в сегмент'],
	maxClusterBins: ['Кластер, бинов', 'Максимальная высота кластера в бинах'],
	maxGapBars: ['Гэп окна, баров', 'Вклад позже этого гэпа открывает новую полосу'],
	gamma: ['Гамма яркости', 'Кривая ранговой яркости полос'],
	maintenanceMarginRate: ['Maintenance margin', 'Ликвидация срабатывает раньше 1/leverage на эту долю'],
}

let defaults = { poi: null, heatmap: null }

function stored() {
	try { return JSON.parse(localStorage.getItem(KEY) || '{"poi":{},"hm":{},"conf":{}}') } catch { return { poi: {}, hm: {}, conf: {} } }
}
function save(x) { localStorage.setItem(KEY, JSON.stringify(x)) }

/** Действующие переопределения (только отличные от дефолтов значения). */
export function engineOverrides() {
	const st = stored()
	const pick = (over, defs) => {
		const out = {}
		for (const [k, v] of Object.entries(over || {})) {
			if (!defs || typeof defs[k] !== 'number') { out[k] = v; continue }
			if (Number.isFinite(v) && v !== defs[k]) out[k] = v
		}
		return out
	}
	return { poi: pick(st.poi, defaults.poi), hm: pick(st.hm, defaults.heatmap), conf: pick(st.conf, defaults.confirmation) }
}

function fieldRow(engine, key, label, hint, def, cur) {
	const changed = cur != null && cur !== def
	return `<label class="cfg-row${changed ? ' changed' : ''}" title="${esc(hint)}">
		<span class="cfg-label">${esc(label)}</span>
		<input class="input cfg-input" type="number" step="any" data-engine="${engine}" data-key="${esc(key)}"
			value="${cur ?? def}" data-default="${def}" />
	</label>`
}

export function renderConfigPanel() {
	const box = $('cfgFields')
	if (!defaults.poi) { box.innerHTML = '<div class="empty">Загрузите данные — подтянутся текущие константы движков</div>'; return }
	const st = stored()
	const group = (title, engine, fields, defs, over) => `<div class="cfg-group"><div class="cfg-group-title">${title}</div>${Object.entries(fields)
		.filter(([k]) => typeof defs[k] === 'number')
		.map(([k, [label, hint]]) => fieldRow(engine, k, label, hint, defs[k], over?.[k])).join('')}</div>`
	box.innerHTML = group('Зоны · LIQUIDITY_POI_CONFIG', 'poi', POI_FIELDS, defaults.poi, st.poi)
		+ (defaults.confirmation ? group('Подтверждение · POI_CONFIRMATION_CONFIG', 'conf', CONF_FIELDS, defaults.confirmation, st.conf) : '')
		+ group('Heatmap · ликвидации', 'hm', HM_FIELDS, defaults.heatmap, st.hm)
	box.querySelectorAll('.cfg-input').forEach((inp) => {
		inp.onchange = () => {
			const st2 = stored()
			const eng = inp.dataset.engine, key = inp.dataset.key
			const v = Number(inp.value)
			const def = Number(inp.dataset.default)
			st2[eng] ??= {}
			if (!Number.isFinite(v) || v === def) delete st2[eng][key]
			else st2[eng][key] = v
			save(st2)
			inp.closest('.cfg-row').classList.toggle('changed', Number.isFinite(v) && v !== def)
			updateBadge()
		}
	})
	updateBadge()
}

function updateBadge() {
	const ov = engineOverrides()
	const n = Object.keys(ov.poi).length + Object.keys(ov.hm).length + Object.keys(ov.conf).length
	const b = $('cfgBadge')
	b.textContent = n ? `изменено: ${n}` : ''
	b.style.display = n ? '' : 'none'
}

export function setEngineDefaults(d) {
	if (d?.poi) defaults = d
	renderConfigPanel()
}

// ---- Пресеты вьюера (фильтры + конфиги движков) ----

function collectUiState() {
	const ids = ['poiDirection', 'poiLifecycle', 'poiPriority', 'poiMinStack', 'hmSide', 'hmMinWeight', 'hmGroup', 'hmAge', 'limit']
	const checks = ['poiActiveOnly', 'poiLiqOnly', 'hmShowSwept', 'showEvents', 'showProtected']
	const out = { fields: {}, checks: {}, engine: stored() }
	for (const id of ids) out.fields[id] = $(id)?.value
	for (const id of checks) out.checks[id] = $(id)?.checked
	return out
}
function applyUiState(p) {
	for (const [id, v] of Object.entries(p.fields || {})) if ($(id) != null && v != null) $(id).value = v
	for (const [id, v] of Object.entries(p.checks || {})) if ($(id) != null && v != null) $(id).checked = v
	if (p.engine) save(p.engine)
	renderConfigPanel()
}
export function savePreset(name) {
	const all = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}')
	all[name] = collectUiState()
	localStorage.setItem(PRESETS_KEY, JSON.stringify(all))
}
export function listPresets() { return Object.keys(JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}')) }
export function applyPreset(name) {
	const all = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}')
	if (all[name]) applyUiState(all[name])
}

export function wireConfigPanel() {
	$('cfgApply').onclick = () => document.dispatchEvent(new CustomEvent('viz:reload'))
	$('cfgReset').onclick = () => { save({ poi: {}, hm: {} }); renderConfigPanel() }
	$('presetSave').onclick = () => {
		const name = prompt('Имя пресета (фильтры + конфиги движков):', 'мой пресет')
		if (name) { savePreset(name); refreshPresetList() }
	}
	$('presetApply').onchange = () => {
		if ($('presetApply').value) { applyPreset($('presetApply').value); document.dispatchEvent(new CustomEvent('viz:redraw')) }
	}
	refreshPresetList()
}
export function refreshPresetList() {
	const sel = $('presetApply')
	sel.innerHTML = '<option value="">Пресет…</option>' + listPresets().map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
}
