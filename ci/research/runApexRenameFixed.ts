import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'ci/research/applyApexRename.ts'
let source = readFileSync(path, 'utf8')
const start = source.indexOf("const specPath = join(ROOT, 'SPEC.md')")
const end = source.indexOf('// ---------- 7. FULL GATE BEFORE ANY SOURCE COMMIT ----------')
if (start < 0 || end < 0 || end <= start) throw new Error('не найден SPEC-блок мигратора')
const fixed = [
  "const specPath = join(ROOT, 'SPEC.md')",
  "const marker = '## 16.33 Zonda Apex и Zonda Reversal'",
  "if (!readFileSync(specPath, 'utf8').includes(marker)) appendFileSync(specPath, [",
  "  '',",
  "  '',",
  "  '## 16.33 Zonda Apex и Zonda Reversal — разделение движков и калиброванные полосы (29.07.2026)',",
  "  '',",
  "  'Приватное имя удалено из исполняемого кода и интерфейса. Полосы называются **Zonda Apex**, сигналы — **Zonda Reversal**; это два независимо включаемых слоя и два отдельных блока payload.',",
  "  '',",
  "  '### Apex: apex-1.0-calibrated-log-alma',",
  "  '',",
  "  'По 14 историческим якорям Binance Spot BTC 5m/15m/4h и ETH 1h установлено: mean = ALMA(hlc3, 200, 0.85, 6); границы логарифмические: mean × exp(±k×s), где k=5.6/9.6. Средняя переносится на внешние BTC 15m / ETH 1h с ошибкой 0.024% / 0.269%. Закрытая мера ширины восстановлена устойчивой аппроксимацией s = ALMA(TR/close, 122, 0.625, 3.5); максимальная наблюдаемая cross-symbol ошибка ширины около 4%, поэтому это не объявляется точной формулой вендора.',",
  "  '',",
  "  '### Reversal: reversal-1.0-directional-candle',",
  "  '',",
  "  'Reversal больше не равен касанию полосы. Край Apex взводит ожидание, после чего BUY разрешён только на бычьей свече (close>open), SELL — только на медвежьей (close<open). После сигнала сторона перевзводится возвратом к средней. Это минимальная модель по наблюдениям пользователя; дополнительные фильтры не вводились без данных. Результаты §16.29–16.30 подлежат повторной проверке, потому что прежняя реализация ставила метку непосредственно по касанию края.',",
  "  '',",
  "  '### Совместимость',",
  "  '',",
  "  'Временный GgiZoneEngine.ts удалён после перевода потребителей. SimplifiedConfirmationEngine получил поля apexVetoBars/apexParams, версию simplified-confirmation-0.6-apex-veto и пресеты SIMPLIFIED_APEX_VETO_PRESET / SIMPLIFIED_REVERSAL_VETO_PRESET. Дефолт вето остаётся выключенным; дефолты POI, heatmap и подтверждений не менялись.',",
  "  '',",
  "].join('\\n'))",
  '',
].join('\n')
source = source.slice(0, start) + fixed + source.slice(end)
writeFileSync(path, source)
execFileSync('npx', ['tsx', path], { stdio: 'inherit' })
