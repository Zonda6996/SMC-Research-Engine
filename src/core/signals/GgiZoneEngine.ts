// Временный мост совместимости на период механического переименования потребителей.
// Канонические имена и реализация находятся в ApexEngine.ts. Новому коду запрещено
// импортировать этот файл; он удаляется после перевода server/Simplified/UI.
export {
	APEX_VERSION as GGI_ZONE_ENGINE_VERSION,
	APEX_PARAMS as GGI_ZONE_PARAMS,
	computeApexBands as computeGgiBands,
	detectReversals as detectGgiSignals,
	apexStateAt as ggiStateAt,
} from './ApexEngine.js'
export type {
	ApexParams as GgiZoneParams,
	ApexBand as GgiBand,
	ReversalSignal as GgiSignal,
} from './ApexEngine.js'
